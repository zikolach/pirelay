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
    maxInboundImageBytes: 10 * 1024 * 1024,
    maxOutboundImageBytes: 10 * 1024 * 1024,
    maxLatestImages: 4,
    allowedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
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

  it("parses Telegram photos, image documents, and unsupported document metadata", async () => {
    const config = await createRuntimeConfig();
    config.maxInboundImageBytes = 600;
    const client = new TelegramApiClient(config);
    (client as any).api = {
      getUpdates: vi.fn(async () => [{
        update_id: 1,
        message: {
          message_id: 10,
          caption: "inspect this screenshot",
          chat: { id: 123, type: "private" },
          from: { id: 7, username: "owner" },
          photo: [
            { file_id: "small", file_unique_id: "u-small", width: 100, height: 100, file_size: 100 },
            { file_id: "too-large", file_unique_id: "u-large", width: 1000, height: 1000, file_size: 1000 },
            { file_id: "best", file_unique_id: "u-best", width: 500, height: 500, file_size: 500 },
          ],
        },
      }, {
        update_id: 2,
        message: {
          message_id: 11,
          caption: "original image",
          chat: { id: 123, type: "private" },
          from: { id: 7, username: "owner" },
          document: { file_id: "doc-image", file_unique_id: "u-doc", file_name: "screen.png", mime_type: "image/png", file_size: 400 },
        },
      }, {
        update_id: 3,
        message: {
          message_id: 12,
          chat: { id: 123, type: "private" },
          from: { id: 7, username: "owner" },
          document: { file_id: "pdf", file_unique_id: "u-pdf", file_name: "notes.pdf", mime_type: "application/pdf", file_size: 400 },
        },
      }]),
    };

    const updates = await client.getUpdates(undefined);

    expect(updates[0]).toMatchObject({ text: "inspect this screenshot", images: [{ kind: "photo", fileId: "best", mimeType: "image/jpeg", supported: true }] });
    expect(updates[1]).toMatchObject({ text: "original image", images: [{ kind: "document", fileId: "doc-image", fileName: "screen.png", mimeType: "image/png", supported: true }] });
    expect(updates[2]).toMatchObject({ text: "", images: [{ kind: "document", fileId: "pdf", mimeType: "application/pdf", supported: false }] });
  });

  it("downloads authorized Telegram images and sends latest images as documents", async () => {
    const client = new TelegramApiClient(await createRuntimeConfig());
    const documents: any[] = [];
    (client as any).api = {
      getFile: vi.fn(async () => ({ file_path: "photos/file.jpg", file_size: 3 })),
      sendDocument: vi.fn(async (...args: any[]) => documents.push(args)),
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));

    const downloaded = await client.downloadImage({
      kind: "photo",
      fileId: "photo-file",
      mimeType: "image/jpeg",
      fileSize: 3,
      supported: true,
    });

    expect(downloaded.image).toEqual({ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "image/jpeg" });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/file/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/photos/file.jpg"));

    await client.sendImageDocument(123, {
      id: "turn-1-1",
      turnId: "turn-1",
      fileName: "latest.png",
      mimeType: "image/png",
      data: Buffer.from([4, 5, 6]).toString("base64"),
      byteSize: 3,
    }, "Latest image");

    expect(documents[0]?.[0]).toBe(123);
    expect(documents[0]?.[1].filename).toBe("latest.png");
    expect(documents[0]?.[2]).toEqual({ caption: "Latest image" });
    expect(Buffer.from(await documents[0]?.[1].toRaw())).toEqual(Buffer.from([4, 5, 6]));
  });
});
