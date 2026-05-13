import { open, realpath, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { ChannelOutboundFile } from "./channel-adapter.js";
import { isAllowedImageMimeType, safeTelegramFilename } from "./utils.js";

export type RelayOutboundFileKind = "document" | "image";

export type RelayFileLoadResult =
  | { ok: true; kind: RelayOutboundFileKind; file: ChannelOutboundFile; relativePath: string }
  | { ok: false; error: string };

export interface RelayFileLoadOptions {
  workspaceRoot: string;
  maxDocumentBytes?: number;
  maxImageBytes: number;
  allowedImageMimeTypes: string[];
}

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".xml": "application/xml",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".jsx": "text/javascript",
  ".py": "text/x-python",
  ".sh": "application/x-sh",
};

export async function loadWorkspaceOutboundFile(requestedPath: string, options: RelayFileLoadOptions): Promise<RelayFileLoadResult> {
  const normalizedRequest = requestedPath.trim().replace(/^\.\//, "");
  const rejected = validateRelativeWorkspaceFilePath(normalizedRequest);
  if (rejected) return { ok: false, error: rejected };

  const workspaceRoot = await realpath(options.workspaceRoot);
  const absolutePath = resolve(workspaceRoot, normalizedRequest);
  let realFilePath: string;
  try {
    realFilePath = await realpath(absolutePath);
  } catch {
    return { ok: false, error: `File not found: ${normalizedRequest}` };
  }
  if (!isPathInside(workspaceRoot, realFilePath)) {
    return { ok: false, error: "Refusing to send files outside the current workspace." };
  }

  let info;
  try {
    info = await stat(realFilePath);
  } catch {
    return { ok: false, error: `File not found: ${normalizedRequest}` };
  }
  if (!info.isFile()) return { ok: false, error: "Refusing to send directories or non-file paths." };

  const imageMimeType = await detectImageMimeTypeFromFile(realFilePath);
  const extensionMimeType = documentMimeTypeForPath(realFilePath);
  const kind: RelayOutboundFileKind = imageMimeType ? "image" : "document";
  const limit = kind === "image" ? options.maxImageBytes : options.maxDocumentBytes;
  if (typeof limit === "number" && info.size > limit) {
    return { ok: false, error: `${kind === "image" ? "Image" : "Document"} file is too large (${info.size} bytes; limit ${limit} bytes).` };
  }

  const bytes = await readFile(realFilePath);

  if (kind === "image") {
    const mimeType = imageMimeType;
    if (!mimeType || !isAllowedImageMimeType(mimeType, options.allowedImageMimeTypes)) {
      return { ok: false, error: `Unsupported image file. Accepted image formats: ${options.allowedImageMimeTypes.join(", ")}.` };
    }
    return {
      ok: true,
      kind,
      relativePath: normalizedRequest,
      file: {
        fileName: safeFileName(basename(realFilePath), mimeType),
        mimeType,
        data: bytes,
        byteSize: bytes.byteLength,
      },
    };
  }

  if (!extensionMimeType) {
    return { ok: false, error: "Unsupported file type. Send text/Markdown/JSON/YAML/source files or supported images." };
  }
  if (looksBinary(bytes)) {
    return { ok: false, error: "Unsupported binary document. Send text-like documents or supported images." };
  }

  return {
    ok: true,
    kind,
    relativePath: normalizedRequest,
    file: {
      fileName: safeFileName(basename(realFilePath), extensionMimeType),
      mimeType: extensionMimeType,
      data: bytes,
      byteSize: bytes.byteLength,
    },
  };
}

export function validateRelativeWorkspaceFilePath(path: string): string | undefined {
  if (!path) return "Usage: /relay send-file <telegram|discord|slack|messenger:instance|all> <relative-path> [caption]";
  if (isAbsolute(path)) return "Use a relative workspace file path, not an absolute path.";
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.split(/[\\/]+/).includes("..")) {
    return "Refusing to send paths with traversal segments.";
  }
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith(".") && segment !== ".")) {
    return "Refusing to send hidden workspace paths.";
  }
  return undefined;
}

function documentMimeTypeForPath(path: string): string | undefined {
  return DOCUMENT_MIME_BY_EXTENSION[extname(path).toLowerCase()];
}

function safeFileName(name: string, mimeType: string): string {
  const extension = extname(name).replace(/^\./, "") || mimeType.split("/").pop() || "txt";
  const stem = basename(name, extname(name));
  return safeTelegramFilename(stem, extension);
}

function isPathInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function detectImageMimeTypeFromFile(path: string): Promise<string | undefined> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(16);
    const result = await handle.read(header, 0, header.length, 0);
    return detectImageMimeType(header.subarray(0, result.bytesRead));
  } finally {
    await handle.close();
  }
}

function detectImageMimeType(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  return undefined;
}

function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0);
}
