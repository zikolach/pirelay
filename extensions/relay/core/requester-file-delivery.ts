import type { ChannelAdapter, ChannelAdapterKind, ChannelOutboundFile, ChannelRouteAddress } from "./channel-adapter.js";
import { loadWorkspaceOutboundFile, type RelayOutboundFileKind } from "./file-delivery.js";
import type { SessionRoute } from "./types.js";

export type RelayFileDeliverySource = "local-command" | "remote-command" | "assistant-tool";

export interface RelayFileDeliveryRequester {
  channel: ChannelAdapterKind;
  instanceId: string;
  conversationId: string;
  userId: string;
  sessionKey: string;
  safeLabel: string;
  threadId?: string;
  conversationKind?: string;
  messageId?: string;
  createdAt: number;
}

export interface RelayRequesterFileDeliveryOptions {
  route: SessionRoute;
  requester: RelayFileDeliveryRequester;
  adapter: ChannelAdapter;
  workspaceRoot: string;
  relativePath: string;
  caption?: string;
  source: RelayFileDeliverySource;
  maxDocumentBytes?: number;
  maxImageBytes?: number;
  allowedImageMimeTypes?: string[];
}

export type RelayRequesterFileDeliveryResult =
  | { ok: true; kind: RelayOutboundFileKind; relativePath: string; fileName: string; byteSize?: number; targetLabel: string; source: RelayFileDeliverySource }
  | { ok: false; code: "stale-requester" | "validation-failed" | "unsupported-capability" | "upload-failed"; error: string; relativePath?: string; targetLabel: string; source: RelayFileDeliverySource };

export interface ParsedRemoteSendFileRequest {
  relativePath: string;
  caption?: string;
}

export function parseRemoteSendFileArgs(args: string): ParsedRemoteSendFileRequest | undefined {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const relativePath = parts[0];
  if (!relativePath) return undefined;
  const maybeTarget = relativePath.toLowerCase();
  if (maybeTarget === "all" || maybeTarget === "telegram" || maybeTarget === "discord" || maybeTarget === "slack" || /^(telegram|discord|slack):/.test(maybeTarget)) {
    return undefined;
  }
  return { relativePath, caption: parts.slice(1).join(" ").trim() || undefined };
}

export function requesterAddress(requester: RelayFileDeliveryRequester): ChannelRouteAddress {
  return {
    channel: requester.channel,
    conversationId: requester.conversationId,
    userId: requester.userId,
    ...(requester.threadId ? { threadTs: requester.threadId } : {}),
  } as ChannelRouteAddress;
}

export function requesterContextIsCurrent(route: SessionRoute, requester: RelayFileDeliveryRequester): boolean {
  if (requester.sessionKey !== route.sessionKey) return false;
  const current = route.remoteRequester;
  if (!current) return true;
  return current.sessionKey === requester.sessionKey
    && current.channel === requester.channel
    && current.instanceId === requester.instanceId
    && current.conversationId === requester.conversationId
    && current.userId === requester.userId
    && current.threadId === requester.threadId;
}

export async function deliverWorkspaceFileToRequester(options: RelayRequesterFileDeliveryOptions): Promise<RelayRequesterFileDeliveryResult> {
  const targetLabel = options.requester.safeLabel;
  if (!requesterContextIsCurrent(options.route, options.requester)) {
    return {
      ok: false,
      code: "stale-requester",
      error: "File delivery requester context is no longer current. Ask from the paired messenger conversation again.",
      targetLabel,
      source: options.source,
    };
  }

  const loaded = await loadWorkspaceOutboundFile(options.relativePath, {
    workspaceRoot: options.workspaceRoot,
    maxDocumentBytes: options.maxDocumentBytes ?? options.adapter.capabilities.maxDocumentBytes,
    maxImageBytes: options.maxImageBytes ?? options.adapter.capabilities.maxImageBytes ?? Number.MAX_SAFE_INTEGER,
    allowedImageMimeTypes: options.allowedImageMimeTypes ?? options.adapter.capabilities.supportedImageMimeTypes,
  });
  if (!loaded.ok) {
    return { ok: false, code: "validation-failed", error: loaded.error, relativePath: options.relativePath, targetLabel, source: options.source };
  }

  if (loaded.kind === "document" && !options.adapter.capabilities.documents) {
    return { ok: false, code: "unsupported-capability", error: `${options.adapter.displayName} file delivery is not available for documents.`, relativePath: loaded.relativePath, targetLabel, source: options.source };
  }
  if (loaded.kind === "image" && !options.adapter.capabilities.images) {
    return { ok: false, code: "unsupported-capability", error: `${options.adapter.displayName} file delivery is not available for images.`, relativePath: loaded.relativePath, targetLabel, source: options.source };
  }

  try {
    await sendLoadedFile(options.adapter, options.requester, loaded.file, loaded.kind, options.caption ?? `PiRelay file: ${loaded.relativePath}`);
  } catch (error) {
    return {
      ok: false,
      code: "upload-failed",
      error: safeDeliveryError(error),
      relativePath: loaded.relativePath,
      targetLabel,
      source: options.source,
    };
  }

  return { ok: true, kind: loaded.kind, relativePath: loaded.relativePath, fileName: loaded.file.fileName, byteSize: loaded.file.byteSize, targetLabel, source: options.source };
}

export function formatRequesterFileDeliveryResult(result: RelayRequesterFileDeliveryResult): string {
  if (result.ok) {
    const size = typeof result.byteSize === "number" ? ` (${result.byteSize} bytes)` : "";
    return `Delivered ${result.relativePath} to ${result.targetLabel} as ${result.fileName}${size}.`;
  }
  return `Could not deliver${result.relativePath ? ` ${result.relativePath}` : ""} to ${result.targetLabel}: ${result.error}`;
}

async function sendLoadedFile(adapter: ChannelAdapter, requester: RelayFileDeliveryRequester, file: ChannelOutboundFile, kind: RelayOutboundFileKind, caption: string): Promise<void> {
  const address = requesterAddress(requester);
  if (kind === "image") await adapter.sendImage(address, file, { caption });
  else await adapter.sendDocument(address, file, { caption });
}

function safeDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, "[redacted]")
    .replace(/xapp-[A-Za-z0-9-]+/g, "[redacted]")
    .replace(/https:\/\/hooks\.slack(?:-gov)?\.com\/[^\s"']+/g, "[redacted]")
    .replace(/https:\/\/[^\s"']*slack[^\s"']*/gi, "[redacted]");
}
