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
    for (const chunk of chunks) await adapter.sendText(address, chunk);
    return "messages";
  }
  if (adapter.capabilities.documents) {
    await adapter.sendDocument(address, finalOutputMarkdownFile(route, text), { caption: options.caption ?? "Latest assistant output" });
    return "document";
  }
  await adapter.sendText(address, `The latest assistant output is too large to send as chat messages, and ${adapter.displayName} document delivery is unavailable.`);
  return "unavailable";
}
