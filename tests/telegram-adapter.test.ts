import { describe, expect, it, vi } from "vitest";
import { TelegramChannelAdapter, telegramCapabilities, telegramMentionedBotUsernames, telegramMessageSharedRoomAddressing, telegramUpdateToChannelEvent, toTelegramKeyboard, type TelegramApiOperations } from "../extensions/relay/adapters/telegram/adapter.js";
import type { TelegramTunnelConfig } from "../extensions/relay/core/types.js";

function config(): TelegramTunnelConfig {
  return {
    botToken: "token",
    stateDir: "/tmp/pi-telegram-test",
    pairingExpiryMs: 300_000,
    busyDeliveryMode: "followUp",
    allowUserIds: [],
    summaryMode: "deterministic",
    maxTelegramMessageChars: 1234,
    sendRetryCount: 1,
    sendRetryBaseMs: 1,
    pollingTimeoutSeconds: 1,
    redactionPatterns: [],
    maxInboundImageBytes: 100,
    maxOutboundImageBytes: 200,
    maxLatestImages: 2,
    allowedImageMimeTypes: ["image/png"],
  };
}

describe("telegram channel adapter", () => {
  it("declares Telegram transport capabilities from tunnel config", () => {
    expect(telegramCapabilities(config())).toMatchObject({
      inlineButtons: true,
      callbacks: true,
      maxTextChars: 1234,
      maxDocumentBytes: undefined,
      maxImageBytes: 200,
      supportedImageMimeTypes: ["image/png"],
      sharedRooms: expect.objectContaining({ ordinaryText: false, mentions: true, replies: true }),
    });
  });

  it("converts Telegram messages and callbacks into channel events", () => {
    const message = telegramUpdateToChannelEvent({
      kind: "message",
      updateId: 10,
      messageId: 20,
      text: "hello",
      images: [{ kind: "photo", fileId: "file-1", mimeType: "image/jpeg", supported: true }],
      chat: { id: 30, type: "private" },
      user: { id: 40, username: "owner", firstName: "Own" },
    });
    expect(message).toMatchObject({
      kind: "message",
      channel: "telegram",
      updateId: "10",
      messageId: "20",
      text: "hello",
      conversation: { id: "30", kind: "private" },
      sender: { userId: "40", username: "owner" },
      attachments: [{ id: "file-1", kind: "image" }],
    });

    const callback = telegramUpdateToChannelEvent({
      kind: "callback",
      updateId: 11,
      callbackQueryId: "cb-1",
      messageId: 21,
      data: "act:1",
      chat: { id: 30, type: "private" },
      user: { id: 40 },
    });
    expect(callback).toMatchObject({ kind: "action", actionId: "cb-1", actionData: "act:1", messageId: "21" });

    const channelPost = telegramUpdateToChannelEvent({
      kind: "message",
      updateId: 12,
      messageId: 22,
      text: "announcement",
      chat: { id: 31, type: "channel" },
      user: { id: 41 },
    });
    expect(channelPost).toMatchObject({ conversation: { kind: "channel" } });
  });

  it("normalizes Telegram shared-room mentions", () => {
    expect(telegramMentionedBotUsernames("hi @PiLaptopBot and @PiDesktopBot")).toEqual(["PiLaptopBot", "PiDesktopBot"]);
    expect(telegramMessageSharedRoomAddressing("hi @PiLaptopBot", "PiLaptopBot")).toEqual({ kind: "local" });
    expect(telegramMessageSharedRoomAddressing("hi @PiDesktopBot", "PiLaptopBot")).toEqual({ kind: "remote", selector: "PiDesktopBot" });
    expect(telegramMessageSharedRoomAddressing("hi @PiLaptopBot @PiDesktopBot", "PiLaptopBot")).toEqual({ kind: "ambiguous", reason: "multiple bot mentions" });
    expect(telegramMessageSharedRoomAddressing("hi", "PiLaptopBot")).toEqual({ kind: "none" });
  });

  it("maps outbound payloads to Telegram API operations", async () => {
    const sent: string[] = [];
    const api: TelegramApiOperations = {
      getUpdates: vi.fn(async () => []),
      sendPlainTextWithKeyboard: vi.fn(async (_chatId, text) => { sent.push(`text:${text}`); }),
      sendDocumentData: vi.fn(async (_chatId, filename, data, caption) => { sent.push(`doc:${filename}:${data.byteLength}:${caption ?? ""}`); }),
      answerCallbackQuery: vi.fn(async (id, text, alert) => { sent.push(`answer:${id}:${text ?? ""}:${alert ? "alert" : "silent"}`); }),
      sendChatAction: vi.fn(async (_chatId, action) => { sent.push(`activity:${action ?? "typing"}`); }),
    };
    const adapter = new TelegramChannelAdapter(config(), api);
    const address = { channel: "telegram", conversationId: "30", userId: "40" };

    await adapter.send({ kind: "text", address, text: "hello", buttons: [[{ label: "OK", actionData: "ok" }]] });
    await adapter.send({ kind: "document", address, file: { fileName: "out.md", mimeType: "text/markdown", data: Buffer.from("abc") }, caption: "cap" });
    await adapter.send({ kind: "document", address, file: { fileName: "base64.bin", mimeType: "application/octet-stream", data: Buffer.from("xyz").toString("base64") } });
    await adapter.send({ kind: "activity", address, activity: "typing" });
    await adapter.send({ kind: "activity", address, activity: "uploading" });
    await adapter.send({ kind: "activity", address, activity: "recording" });
    await adapter.send({ kind: "action-answer", channel: "telegram", actionId: "cb-1", text: "done", alert: true });

    expect(api.sendPlainTextWithKeyboard).toHaveBeenCalledWith(30, "hello", [[{ text: "OK", callbackData: "ok" }]]);
    expect(sent).toEqual(["text:hello", "doc:out.md:3:cap", "doc:base64.bin:3:", "activity:typing", "activity:upload_document", "activity:record_video", "answer:cb-1:done:alert"]);
  });

  it("rejects invalid Telegram adapter outbound identifiers and file encodings", async () => {
    const api: TelegramApiOperations = {
      getUpdates: vi.fn(async () => []),
      sendPlainTextWithKeyboard: vi.fn(async () => undefined),
      sendDocumentData: vi.fn(async () => undefined),
      answerCallbackQuery: vi.fn(async () => undefined),
      sendChatAction: vi.fn(async () => undefined),
    };
    const adapter = new TelegramChannelAdapter(config(), api);
    const invalidAddress = { channel: "telegram", conversationId: "not-a-number", userId: "40" };
    const decimalAddress = { channel: "telegram", conversationId: "30.5", userId: "40" };
    const validAddress = { channel: "telegram", conversationId: "30", userId: "40" };

    await expect(adapter.send({ kind: "text", address: invalidAddress, text: "hello" })).rejects.toThrow("Invalid Telegram chat id: not-a-number");
    await expect(adapter.send({ kind: "text", address: decimalAddress, text: "hello" })).rejects.toThrow("Invalid Telegram chat id: 30.5");
    await expect(adapter.send({ kind: "document", address: validAddress, file: { fileName: "plain.txt", mimeType: "text/plain", data: "hello" } })).rejects.toThrow("base64-encoded");
  });

  it("retries updates when a handler fails before advancing offset", async () => {
    vi.useFakeTimers();
    try {
      const update = { kind: "message" as const, updateId: 5, messageId: 2, text: "retry", chat: { id: 3, type: "private" }, user: { id: 4 } };
      const api: TelegramApiOperations = {
        getUpdates: vi.fn(async () => [update]),
        sendPlainTextWithKeyboard: vi.fn(async () => undefined),
        sendDocumentData: vi.fn(async () => undefined),
        answerCallbackQuery: vi.fn(async () => undefined),
        sendChatAction: vi.fn(async () => undefined),
      };
      const adapter = new TelegramChannelAdapter(config(), api);
      const handler = vi.fn()
        .mockRejectedValueOnce(new Error("handler failed"))
        .mockImplementationOnce(async () => { await adapter.stopPolling(); });
      const polling = adapter.startPolling(handler);

      await vi.advanceTimersByTimeAsync(1_500);
      await polling;

      expect(api.getUpdates).toHaveBeenNthCalledWith(1, undefined);
      expect(api.getUpdates).toHaveBeenNthCalledWith(2, undefined);
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps polling after transient update errors", async () => {
    vi.useFakeTimers();
    try {
      const api: TelegramApiOperations = {
        getUpdates: vi.fn()
          .mockRejectedValueOnce(new Error("temporary"))
          .mockResolvedValueOnce([{ kind: "message", updateId: 1, messageId: 2, text: "ok", chat: { id: 3, type: "private" }, user: { id: 4 } }]),
        sendPlainTextWithKeyboard: vi.fn(async () => undefined),
        sendDocumentData: vi.fn(async () => undefined),
        answerCallbackQuery: vi.fn(async () => undefined),
        sendChatAction: vi.fn(async () => undefined),
      };
      const adapter = new TelegramChannelAdapter(config(), api);
      const handler = vi.fn(async () => { await adapter.stopPolling(); });
      const polling = adapter.startPolling(handler);

      await vi.advanceTimersByTimeAsync(1_500);
      await polling;

      expect(api.getUpdates).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("converts channel button layout to Telegram inline keyboard", () => {
    expect(toTelegramKeyboard([[{ label: "One", actionData: "1" }]])).toEqual([[{ text: "One", callbackData: "1" }]]);
  });
});
