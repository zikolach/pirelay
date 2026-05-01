import { describe, expect, it } from "vitest";
import { createRelayPipeline } from "../extensions/telegram-tunnel/relay-middleware.js";
import { commandIntentFromPipeline, createTelegramRelayEvent, telegramActionFromPipelineResult, telegramActionMiddleware, telegramCommandMiddleware, telegramMediaMiddleware } from "../extensions/telegram-tunnel/relay-telegram-middleware.js";
import type { TelegramInboundCallback, TelegramInboundMessage } from "../extensions/telegram-tunnel/types.js";

const message: TelegramInboundMessage = {
  kind: "message",
  updateId: 1,
  messageId: 2,
  text: "/status now",
  chat: { id: 10, type: "private" },
  user: { id: 20, username: "owner" },
};

const callback: TelegramInboundCallback = {
  kind: "callback",
  updateId: 3,
  callbackQueryId: "cb-1",
  messageId: 4,
  data: "full:turn-1:chat",
  chat: { id: 10, type: "private" },
  user: { id: 20 },
};

describe("telegram relay middleware bridge", () => {
  it("creates normalized relay events from Telegram messages", () => {
    const event = createTelegramRelayEvent(message, { authorized: true });
    expect(event).toMatchObject({
      id: "telegram:1",
      channel: "telegram",
      authorized: true,
      inbound: { kind: "message", text: "/status now" },
      identity: { userId: "20", username: "owner" },
      adapter: { channel: "telegram" },
    });
  });

  it("resolves slash commands as middleware intents without injecting them", async () => {
    const result = await createRelayPipeline([telegramCommandMiddleware()]).run(createTelegramRelayEvent(message, { authorized: true }));
    expect(result).toMatchObject({
      kind: "continue",
      intent: { type: "command", command: "status", args: "now", safety: "safe" },
    });
    expect(commandIntentFromPipeline(result)).toEqual({ command: "status", args: "now" });
  });

  it("resolves Telegram callbacks as internal middleware actions", async () => {
    const result = await createRelayPipeline([telegramActionMiddleware()]).run(createTelegramRelayEvent(callback, { authorized: true }));
    expect(result).toMatchObject({ kind: "internal-action", action: { type: "custom", safety: "safe", metadata: { telegramAction: { kind: "full-chat" } } } });
    expect(telegramActionFromPipelineResult(result)).toMatchObject({ kind: "full-chat", turnId: "turn-1" });
  });

  it("rejects malformed Telegram action metadata from pipeline results", () => {
    expect(telegramActionFromPipelineResult({
      kind: "internal-action",
      action: { type: "custom", safety: "safe", metadata: { telegramAction: { kind: "answer-option", turnId: "turn-1" } } },
    })).toBeUndefined();
    expect(telegramActionFromPipelineResult({
      kind: "internal-action",
      action: { type: "custom", safety: "safe", metadata: { telegramAction: { kind: "full-chat", turnId: 123 } } },
    })).toBeUndefined();
  });

  it("keeps unauthorized command parsing available before media download", async () => {
    const result = await createRelayPipeline([telegramMediaMiddleware(), telegramCommandMiddleware()]).run(createTelegramRelayEvent(message, { authorized: false }));
    expect(result).toMatchObject({ kind: "continue", intent: { type: "command", command: "status" } });
  });

  it("annotates media before download while preserving authorization boundary", async () => {
    const withMedia: TelegramInboundMessage = {
      ...message,
      text: "look",
      images: [{ kind: "photo", fileId: "file-1", mimeType: "image/jpeg", supported: true }],
    };
    const result = await createRelayPipeline([telegramMediaMiddleware()]).run(createTelegramRelayEvent(withMedia, { authorized: true }));
    expect(result).toMatchObject({ kind: "continue", event: { media: [{ id: "file-1", safety: "media-download" }] } });
  });
});
