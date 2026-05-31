import type { ChannelAdapter, ChannelAdapterMetadata, ChannelOutboundFile, ChannelRouteAddress } from "./channel-adapter.js";
import { channelTextChunks } from "./channel-adapter.js";
import type { SessionRoute } from "./types.js";
import { safeTelegramFilename } from "./utils.js";

export const DEFAULT_FINAL_OUTPUT_MAX_MESSAGE_CHUNKS = 5;

export type FinalOutputDeliveryPlan =
  | { kind: "messages"; chunks: string[]; differsFromFullOutput: false }
  | { kind: "document"; fileName: string; buildFile: () => ChannelOutboundFile; differsFromFullOutput: true }
  | { kind: "unavailable"; message: string; differsFromFullOutput: true };

export interface FinalOutputDeliveryOptions {
  maxMessageChunks?: number;
  prepareText?: (text: string) => string;
}

export function finalOutputMarkdownFileName(route: Pick<SessionRoute, "sessionId" | "notification">): string {
  const turnId = route.notification.lastTurnId ?? "latest";
  return safeTelegramFilename(`pi-output-${route.sessionId}-${turnId}`, "md");
}

export function finalOutputMarkdownFile(route: Pick<SessionRoute, "sessionId" | "notification">, text: string): ChannelOutboundFile {
  const data = Buffer.from(text, "utf8");
  return {
    fileName: finalOutputMarkdownFileName(route),
    mimeType: "text/markdown",
    data,
    byteSize: data.byteLength,
  };
}

export function planFinalOutputDelivery(
  adapter: Pick<ChannelAdapterMetadata, "capabilities" | "displayName">,
  route: Pick<SessionRoute, "sessionId" | "notification">,
  text: string,
  options: FinalOutputDeliveryOptions = {},
): FinalOutputDeliveryPlan {
  const maxMessageChunks = options.maxMessageChunks ?? DEFAULT_FINAL_OUTPUT_MAX_MESSAGE_CHUNKS;
  const messageText = options.prepareText ? options.prepareText(text) : text;
  const chunks = channelTextChunks(adapter, messageText);
  if (chunks.length <= maxMessageChunks) {
    return { kind: "messages", chunks, differsFromFullOutput: false };
  }
  if (adapter.capabilities.documents) {
    return {
      kind: "document",
      fileName: finalOutputMarkdownFileName(route),
      buildFile: () => finalOutputMarkdownFile(route, text),
      differsFromFullOutput: true,
    };
  }
  return {
    kind: "unavailable",
    message: `The latest assistant output is too large to send as chat messages, and ${adapter.displayName} document delivery is unavailable.`,
    differsFromFullOutput: true,
  };
}

export function formatPreservingExcerpt(text: string, maxChars: number): string {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  if (normalized.length <= maxChars) return normalized;
  const limit = Math.max(1, maxChars - 1);
  const paragraphBoundary = lastBoundaryBefore(normalized, /\n{2,}/g, limit, 0.4);
  const lineBoundary = paragraphBoundary > 0 ? paragraphBoundary : lastBoundaryBefore(normalized, /\n/g, limit, 0.5);
  const spaceBoundary = lineBoundary > 0 ? lineBoundary : normalized.lastIndexOf(" ", limit);
  const splitAt = spaceBoundary > limit * 0.5 ? spaceBoundary : limit;
  return `${normalized.slice(0, splitAt).trimEnd()}…`;
}

export async function sendFinalOutputWithFallback(
  adapter: ChannelAdapter,
  address: ChannelRouteAddress,
  route: SessionRoute,
  text: string,
  options: FinalOutputDeliveryOptions & { caption?: string } = {},
): Promise<"messages" | "document" | "unavailable"> {
  const plan = planFinalOutputDelivery(adapter, route, text, options);
  if (plan.kind === "messages") {
    for (const chunk of plan.chunks) await adapter.sendText(address, chunk);
    return "messages";
  }
  if (plan.kind === "document") {
    const file = plan.buildFile();
    const maxDocumentBytes = adapter.capabilities.maxDocumentBytes;
    const byteSize = outboundFileByteSize(file);
    if (maxDocumentBytes !== undefined && byteSize > maxDocumentBytes) {
      await adapter.sendText(address, documentTooLargeMessage(adapter, byteSize, maxDocumentBytes));
      return "unavailable";
    }
    await adapter.sendDocument(address, file, { caption: options.caption ?? "Latest assistant output" });
    return "document";
  }
  await adapter.sendText(address, plan.message);
  return "unavailable";
}

function outboundFileByteSize(file: ChannelOutboundFile): number {
  if (file.byteSize !== undefined) return file.byteSize;
  if (typeof file.data === "string") return Buffer.byteLength(file.data, "utf8");
  return file.data.byteLength;
}

function documentTooLargeMessage(adapter: Pick<ChannelAdapterMetadata, "displayName">, byteSize: number, maxDocumentBytes: number): string {
  return `The latest assistant output is too large to send as chat messages, and the generated Markdown document (${formatByteSize(byteSize)}) exceeds ${adapter.displayName}'s document size limit (${formatByteSize(maxDocumentBytes)}).`;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${formatByteValue(kib)} KiB`;
  return `${formatByteValue(kib / 1024)} MiB`;
}

function formatByteValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function lastBoundaryBefore(text: string, pattern: RegExp, maxChars: number, minimumRatio: number): number {
  let boundary = -1;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || match.index > maxChars) break;
    boundary = match.index + match[0].length;
  }
  return boundary > maxChars * minimumRatio ? boundary : -1;
}
