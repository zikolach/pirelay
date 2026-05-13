import type { ChannelAdapter, ChannelOutboundFile, ChannelRouteAddress } from "./channel-adapter.js";
import { channelTextChunks } from "./channel-adapter.js";
import type { ProgressMode, SessionRoute } from "./types.js";
import { safeTelegramFilename } from "./utils.js";

export const DEFAULT_FINAL_OUTPUT_MAX_MESSAGE_CHUNKS = 5;

export function shouldSendFullFinalOutput(mode: ProgressMode): boolean {
  return mode !== "quiet";
}

export function finalOutputMarkdownFile(route: Pick<SessionRoute, "sessionId" | "notification">, text: string): ChannelOutboundFile {
  const turnId = route.notification.lastTurnId ?? "latest";
  return {
    fileName: safeTelegramFilename(`pi-output-${route.sessionId}-${turnId}`, "md"),
    mimeType: "text/markdown",
    data: Buffer.from(text, "utf8"),
    byteSize: Buffer.byteLength(text, "utf8"),
  };
}

export async function sendFinalOutputWithFallback(
  adapter: ChannelAdapter,
  address: ChannelRouteAddress,
  route: SessionRoute,
  text: string,
  options: { maxMessageChunks?: number; caption?: string } = {},
): Promise<"messages" | "document" | "unavailable"> {
  const maxMessageChunks = options.maxMessageChunks ?? DEFAULT_FINAL_OUTPUT_MAX_MESSAGE_CHUNKS;
  const chunks = channelTextChunks(adapter, text);
  if (chunks.length <= maxMessageChunks) {
    await adapter.sendText(address, text);
    return "messages";
  }
  if (adapter.capabilities.documents) {
    await adapter.sendDocument(address, finalOutputMarkdownFile(route, text), { caption: options.caption ?? "Latest assistant output" });
    return "document";
  }
  await adapter.sendText(address, `The latest assistant output is too large to send as chat messages, and ${adapter.displayName} document delivery is unavailable.`);
  return "unavailable";
}

export function paragraphAwareTextChunks(text: string, maxChars: number): string[] {
  const limit = Math.max(1, maxChars);
  if (text.length <= limit) return [text];
  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }
    chunks.push(...splitLongParagraph(paragraph, limit));
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

function splitLongParagraph(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf("\n", maxChars);
    if (splitAt < maxChars * 0.5) splitAt = remaining.lastIndexOf(" ", maxChars);
    if (splitAt < maxChars * 0.5) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
