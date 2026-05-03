import { createHash, randomBytes, randomInt } from "node:crypto";
import { realpath, stat, readFile } from "node:fs/promises";
import { basename, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { ImageFileLoadResult, LatestTurnImage, LatestTurnImageFileCandidate } from "./types.js";
import type { DeliveryMode, ParsedTelegramCommand, TelegramBindingMetadata, TelegramOutboundChunk, TelegramUserSummary } from "./types.js";

const DEFAULT_REDACTION_PATTERNS = [
  String.raw`\b\d{8,}:[A-Za-z0-9_-]{20,}\b`,
  String.raw`\b(?:sk|rk|pk)_[A-Za-z0-9]{16,}\b`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{16,}\b`,
  String.raw`(?:API[_-]?KEY|Api[_-]?Key|api[_-]?key|TOKEN|Token|token|SECRET|Secret|secret|PASSWORD|Password|password)\s*[:=]\s*[^\s]+`,
];

export function getDefaultRedactionPatterns(): string[] {
  return [...DEFAULT_REDACTION_PATTERNS];
}

export function sessionKeyOf(sessionId: string, sessionFile?: string): string {
  return `${sessionId}:${sessionFile ?? "memory"}`;
}

export const MAX_SESSION_LABEL_LENGTH = 48;

export function normalizeSessionLabel(label: string | undefined | null, fallback = "Pi session"): string {
  const normalized = String(label ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  const bounded = normalized.length > MAX_SESSION_LABEL_LENGTH
    ? `${normalized.slice(0, MAX_SESSION_LABEL_LENGTH - 1).trimEnd()}…`
    : normalized;
  return bounded || fallback;
}

export function deriveSessionLabel(input: {
  explicitLabel?: string | null;
  sessionName?: string | null;
  cwd?: string | null;
  sessionFile?: string;
  sessionId: string;
}): string {
  const explicit = normalizeSessionLabel(input.explicitLabel, "");
  if (explicit) return explicit;

  const sessionName = normalizeSessionLabel(input.sessionName, "");
  if (sessionName) return sessionName;

  const cwdBase = input.cwd ? normalizeSessionLabel(basename(input.cwd), "") : "";
  if (cwdBase) return cwdBase;

  const fileBase = input.sessionFile ? normalizeSessionLabel(basename(input.sessionFile), "") : "";
  if (fileBase) return fileBase;

  return normalizeSessionLabel(`session-${input.sessionId.slice(0, 8)}`);
}

export function sessionLabelOf(sessionId: string, sessionFile?: string, sessionName?: string | null): string {
  return deriveSessionLabel({ sessionId, sessionFile, sessionName });
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPairingNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function createPairingPin(): string {
  const value = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return `${value.slice(0, 3)}-${value.slice(3)}`;
}

export function createTurnId(): string {
  return randomBytes(8).toString("hex");
}

export function redactSecret(value: string, patterns: string[], replacement = "[redacted]"): string {
  let output = value;
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "gm");
      output = output.replace(regex, replacement);
    } catch {
      // Ignore invalid user-supplied patterns.
    }
  }
  return output;
}

export function maskNonce(nonce: string): string {
  if (nonce.length <= 10) return "••••";
  return `${nonce.slice(0, 4)}…${nonce.slice(-4)}`;
}

export function getTelegramUserLabel(user: TelegramUserSummary): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (user.username) return `@${user.username}${name ? ` (${name})` : ""}`;
  if (name) return `${name} (${user.id})`;
  return `Telegram user ${user.id}`;
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.slice(1).split("@")[0]?.toLowerCase();
  if (!command) return undefined;
  return { command, args: rest.join(" ").trim() };
}

export function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

export function extractTextContent(content: AssistantMessage["content"] | string | (TextContent | { type: string })[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts.join("\n").trim();
}

export function extractFinalAssistantText(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (isAssistantMessage(message)) {
      const text = extractTextContent(message.content);
      if (text) return text;
    }
  }
  return undefined;
}

export function summarizeTextDeterministically(text: string, maxLength = 320): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function statusLineForBinding(binding?: TelegramBindingMetadata): string {
  if (!binding) return "not paired";
  const paused = binding.paused ? ", paused" : "";
  return `${binding.sessionLabel} ↔ ${binding.chatId}/${binding.userId}${paused}`;
}

export function resolveBusyDeliveryMode(mode: DeliveryMode | undefined, busy: boolean): DeliveryMode | undefined {
  if (!busy) return undefined;
  return mode ?? "followUp";
}

export function chunkTelegramText(text: string, maxChars: number): TelegramOutboundChunk[] {
  const safe = text.replace(/\r\n/g, "\n");
  if (safe.length <= maxChars) {
    return [{ text: safe, index: 1, total: 1 }];
  }

  const chunks: string[] = [];
  let remaining = safe;

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf("\n", maxChars);
    if (splitAt < maxChars * 0.5) {
      splitAt = remaining.lastIndexOf(" ", maxChars);
    }
    if (splitAt < maxChars * 0.5) {
      splitAt = maxChars;
    }
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);

  return chunks.map((chunk, index) => ({
    text: chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n${chunk}` : chunk,
    index: index + 1,
    total: chunks.length,
  }));
}

export function formatModelId(model: Model<any> | undefined): string | undefined {
  if (!model) return undefined;
  return `${model.provider}/${model.id}`;
}

export function safeTelegramFilename(baseName: string, extension: string): string {
  const safeBase = baseName
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "pi-output";
  const safeExtension = extension.replace(/^\.+/, "") || "txt";
  return `${safeBase}.${safeExtension}`;
}

export function normalizeImageMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  return normalized || undefined;
}

export function isAllowedImageMimeType(mimeType: string | undefined, allowedMimeTypes: string[]): boolean {
  const normalized = normalizeImageMimeType(mimeType);
  if (!normalized) return false;
  return allowedMimeTypes.map((value) => normalizeImageMimeType(value)).includes(normalized);
}

export function imageMimeTypeToExtension(mimeType: string): string {
  switch (normalizeImageMimeType(mimeType)) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "img";
  }
}

export function safeTelegramImageFilename(baseName: string | undefined, mimeType: string, fallbackBase = "pi-image"): string {
  const extension = imageMimeTypeToExtension(mimeType);
  const withoutExtension = basename(baseName ?? fallbackBase).replace(/\.[a-z0-9]+$/i, "") || fallbackBase;
  return safeTelegramFilename(withoutExtension, extension);
}

export function base64ByteLength(data: string): number {
  return Buffer.byteLength(data, "base64");
}

export function modelSupportsImages(model: Model<any> | undefined): boolean {
  return Boolean(model?.input?.includes("image"));
}

export function buildImagePromptContent(text: string, images: ImageContent[]): string | (TextContent | ImageContent)[] {
  if (images.length === 0) return text;
  return [{ type: "text", text }, ...images];
}

export function extractImageContent(content: unknown): ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part): part is ImageContent => {
    if (!part || typeof part !== "object") return false;
    const block = part as { type?: unknown; data?: unknown; mimeType?: unknown };
    return block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string";
  });
}

export function latestImageFromContent(
  image: ImageContent,
  options: { turnId: string; index: number; fileName?: string },
): LatestTurnImage {
  return {
    id: `${options.turnId}-${options.index + 1}`,
    turnId: options.turnId,
    fileName: safeTelegramImageFilename(options.fileName, image.mimeType, `pi-image-${options.index + 1}`),
    mimeType: normalizeImageMimeType(image.mimeType) ?? image.mimeType,
    data: image.data,
    byteSize: base64ByteLength(image.data),
  };
}

export function extractLocalImagePaths(text: string): string[] {
  const candidates = new Set<string>();
  const extension = String.raw`(?:png|jpe?g|webp)`;
  const patterns = [
    new RegExp(String.raw`\`([^\`]+?\.${extension})\``, "gi"),
    new RegExp(String.raw`\[[^\]]*\]\(([^)]+?\.${extension})(?:\s+"[^"]*")?\)`, "gi"),
    new RegExp(String.raw`((?:\.?\.?\/)?[A-Za-z0-9_@+~.-][^\s\`"'<>]*?\.${extension})`, "gi"),
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (!raw) continue;
      const cleaned = cleanImagePathCandidate(raw);
      if (!cleaned) continue;
      candidates.add(cleaned);
    }
  }
  return [...candidates];
}

function cleanImagePathCandidate(raw: string): string | undefined {
  const decoded = raw.trim().replace(/^<|>$/g, "").replace(/^file:\/\//i, "");
  const withoutQuery = decoded.split(/[?#]/)[0]?.trim() ?? "";
  const cleaned = withoutQuery.replace(/[),.;:!?]+$/g, "");
  if (!cleaned) return undefined;
  if (cleaned.includes("](") || cleaned.includes("[")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) return undefined;
  return cleaned;
}

export function latestImageFileCandidatesFromText(
  texts: string[],
  options: { turnId: string; maxCount: number },
): LatestTurnImageFileCandidate[] {
  const paths = new Set<string>();
  for (const text of texts) {
    for (const path of extractLocalImagePaths(text)) paths.add(path);
  }
  return [...paths].slice(0, Math.max(0, options.maxCount)).map((path, index) => ({
    id: `${options.turnId}-file-${index + 1}`,
    turnId: options.turnId,
    path,
  }));
}

export async function loadWorkspaceImageFile(
  requestedPath: string,
  options: {
    workspaceRoot: string;
    turnId: string;
    index: number;
    maxBytes: number;
    allowedMimeTypes: string[];
  },
): Promise<ImageFileLoadResult> {
  const normalizedRequest = requestedPath.trim().replace(/^\.\//, "");
  const rejected = validateRelativeImagePath(normalizedRequest);
  if (rejected) return { ok: false, error: rejected };

  const workspaceRoot = await realpath(options.workspaceRoot);
  const absolutePath = resolve(workspaceRoot, normalizedRequest);
  let realImagePath: string;
  try {
    realImagePath = await realpath(absolutePath);
  } catch {
    return { ok: false, error: `Image file not found: ${normalizedRequest}` };
  }
  if (!isPathInside(workspaceRoot, realImagePath)) {
    return { ok: false, error: "Refusing to send image paths outside the current workspace." };
  }

  let info;
  try {
    info = await stat(realImagePath);
  } catch {
    return { ok: false, error: `Image file not found: ${normalizedRequest}` };
  }
  if (!info.isFile()) return { ok: false, error: "Refusing to send non-file image paths." };
  if (info.size > options.maxBytes) {
    return { ok: false, error: `Image file is too large for Telegram delivery (${info.size} bytes; limit ${options.maxBytes} bytes).` };
  }

  const bytes = await readFile(realImagePath);
  if (bytes.byteLength > options.maxBytes) {
    return { ok: false, error: `Image file is too large for Telegram delivery (${bytes.byteLength} bytes; limit ${options.maxBytes} bytes).` };
  }
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType || !isAllowedImageMimeType(mimeType, options.allowedMimeTypes)) {
    return { ok: false, error: `Unsupported or invalid image file. Accepted image formats: ${options.allowedMimeTypes.join(", ")}.` };
  }

  return {
    ok: true,
    image: {
      id: `${options.turnId}-file-${options.index + 1}`,
      turnId: options.turnId,
      fileName: safeTelegramImageFilename(basename(realImagePath), mimeType, `pi-image-file-${options.index + 1}`),
      mimeType,
      data: bytes.toString("base64"),
      byteSize: bytes.byteLength,
    },
  };
}

function validateRelativeImagePath(path: string): string | undefined {
  if (!path) return "Usage: /send-image <relative-image-path>";
  if (isAbsolute(path)) return "Use a relative workspace image path, not an absolute path.";
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.split(/[\\/]+/).includes("..")) {
    return "Refusing to send paths with traversal segments.";
  }
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith(".") && segment !== ".")) {
    return "Refusing to send hidden workspace paths.";
  }
  if (!/\.(?:png|jpe?g|webp)$/i.test(normalized)) {
    return "Only PNG, JPEG, and WebP image paths can be sent.";
  }
  return undefined;
}

function isPathInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function detectImageMimeType(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toIsoNow(): string {
  return new Date().toISOString();
}
