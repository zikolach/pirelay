import { describe, expect, it, vi } from "vitest";
import { appendTestTelegramOutbox, testTelegramOutboxPathFromEnv } from "../extensions/relay/broker/test-telegram-outbox.js";

describe("testTelegramOutboxPathFromEnv", () => {
  it("enables the outbox only when broker polling is explicitly skipped", () => {
    expect(testTelegramOutboxPathFromEnv({
      PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH: "/tmp/outbox.jsonl",
      TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
    })).toBe("/tmp/outbox.jsonl");

    expect(testTelegramOutboxPathFromEnv({
      PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH: "/tmp/outbox.jsonl",
    })).toBeUndefined();
  });
});

describe("appendTestTelegramOutbox", () => {
  it("appends test Telegram events when an outbox path is configured", async () => {
    const appendFile = vi.fn(async () => undefined);

    await expect(appendTestTelegramOutbox(
      { method: "sendMessage", chatId: 123, text: "hello" },
      { outboxPath: "/tmp/outbox.jsonl", appendFile },
    )).resolves.toBe(true);

    expect(appendFile).toHaveBeenCalledWith(
      "/tmp/outbox.jsonl",
      `${JSON.stringify({ method: "sendMessage", chatId: 123, text: "hello" })}\n`,
      { mode: 0o600 },
    );
  });

  it("fails open when the test outbox cannot be written", async () => {
    const appendFile = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    const recordDiagnostic = vi.fn();

    await expect(appendTestTelegramOutbox(
      { method: "sendMessage", chatId: 123, text: "hello" },
      { outboxPath: "/tmp/outbox.jsonl", appendFile, recordDiagnostic },
    )).resolves.toBe(false);

    expect(recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      component: "broker",
      event: "test_telegram_outbox",
      outcome: "error",
      severity: "warning",
      details: { error: "EACCES: permission denied" },
    }));
  });
});
