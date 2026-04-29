import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramApiClient, toTelegramReplyMarkup } from "../extensions/telegram-tunnel/telegram-api.js";
import type { TelegramTunnelConfig } from "../extensions/telegram-tunnel/types.js";

const tempDirs: string[] = [];

async function createRuntimeConfig(): Promise<TelegramTunnelConfig> {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-telegram-api-"));
  tempDirs.push(stateDir);
  return {
    botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    configPath: join(stateDir, "config.json"),
    stateDir,
    pairingExpiryMs: 300_000,
    busyDeliveryMode: "followUp",
    allowUserIds: [],
    summaryMode: "deterministic",
    maxTelegramMessageChars: 20,
    sendRetryCount: 1,
    sendRetryBaseMs: 1,
    pollingTimeoutSeconds: 1,
    redactionPatterns: [String.raw`token=\S+`],
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("TelegramApiClient button and document payloads", () => {
  it("maps internal inline keyboards to Telegram reply markup", () => {
    expect(toTelegramReplyMarkup([[{ text: "Show", callbackData: "full:t:chat" }]])).toEqual({
      inline_keyboard: [[{ text: "Show", callback_data: "full:t:chat" }]],
    });
  });

  it("attaches reply markup to the last text chunk only", async () => {
    const client = new TelegramApiClient(await createRuntimeConfig());
    const sent: any[] = [];
    (client as any).api = {
      sendMessage: vi.fn(async (...args: any[]) => sent.push(args)),
    };

    await client.sendPlainTextWithKeyboard(123, "first line\nsecond line\nthird line", [[{ text: "Show", callbackData: "full:t:chat" }]]);

    expect(sent.length).toBeGreaterThan(1);
    expect(sent[0]?.[2]).toBeUndefined();
    expect(sent.at(-1)?.[2]).toEqual({
      reply_markup: { inline_keyboard: [[{ text: "Show", callback_data: "full:t:chat" }]] },
    });
  });

  it("formats and redacts chat text before chunking", async () => {
    const config = await createRuntimeConfig();
    config.maxTelegramMessageChars = 3900;
    const client = new TelegramApiClient(config);
    const sent: any[] = [];
    (client as any).api = {
      sendMessage: vi.fn(async (...args: any[]) => sent.push(args)),
    };

    await client.sendPlainText(123, [
      "| Key | Value |",
      "| --- | --- |",
      "| secret | token=abc123 |",
    ].join("\n"));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.[1]).toContain("```");
    expect(sent[0]?.[1]).toContain("secret | [redacted]");
    expect(sent[0]?.[1]).not.toContain("token=abc123");
  });

  it("redacts Markdown documents before upload", async () => {
    const client = new TelegramApiClient(await createRuntimeConfig());
    const documents: any[] = [];
    (client as any).api = {
      sendDocument: vi.fn(async (...args: any[]) => documents.push(args)),
    };

    await client.sendMarkdownDocument(123, "pi-output.md", [
      "| Key | Value |",
      "| --- | --- |",
      "| secret | token=abc123 |",
    ].join("\n"), "Latest assistant output");

    expect(documents[0]?.[0]).toBe(123);
    expect(documents[0]?.[1].filename).toBe("pi-output.md");
    expect(documents[0]?.[2]).toEqual({ caption: "Latest assistant output" });
    const raw = Buffer.from(await documents[0]?.[1].toRaw()).toString("utf8");
    expect(raw).toContain("| Key | Value |");
    expect(raw).toContain("| secret | [redacted] |");
    expect(raw).not.toContain("```");
  });
});
