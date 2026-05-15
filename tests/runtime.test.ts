import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractStructuredAnswerMetadata } from "../extensions/relay/core/guided-answer.js";
import { buildAnswerCustomCallbackData, buildAnswerOptionCallbackData, buildDashboardCallbackData, buildFullChatCallbackData, buildFullMarkdownCallbackData, buildFullOutputKeyboard, buildLatestImagesCallbackData, buildLatestImagesKeyboard, parseTelegramActionCallbackData, sessionDashboardRef } from "../extensions/relay/adapters/telegram/actions.js";
import { createProgressActivity } from "../extensions/relay/notifications/progress.js";
import { InProcessTunnelRuntime, sendSessionNotification } from "../extensions/relay/adapters/telegram/runtime.js";
import { routeUnavailableError } from "../extensions/relay/core/route-actions.js";
import { TunnelStateStore } from "../extensions/relay/state/tunnel-store.js";
import type { SessionRoute, TelegramBindingMetadata, TelegramPromptContent, TelegramTunnelConfig, TunnelRuntime } from "../extensions/relay/core/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createRuntimeConfig(): Promise<TelegramTunnelConfig> {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-telegram-runtime-"));
  tempDirs.push(stateDir);
  return {
    botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    configPath: join(stateDir, "config.json"),
    stateDir,
    pairingExpiryMs: 300_000,
    busyDeliveryMode: "followUp",
    allowUserIds: [],
    summaryMode: "deterministic",
    maxTelegramMessageChars: 3900,
    sendRetryCount: 1,
    sendRetryBaseMs: 1,
    pollingTimeoutSeconds: 1,
    redactionPatterns: [],
    maxInboundImageBytes: 10 * 1024 * 1024,
    maxOutboundImageBytes: 10 * 1024 * 1024,
    maxLatestImages: 4,
    allowedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  };
}

function createRoute(binding: TelegramBindingMetadata, idle = true, promptLocalConfirmation: SessionRoute["actions"]["promptLocalConfirmation"] = async () => true) {
  const deliveries: Array<{ text: TelegramPromptContent; deliverAs?: "followUp" | "steer" }> = [];
  const outbound: string[] = [];
  let currentIdle = idle;

  const route: SessionRoute = {
    sessionKey: binding.sessionKey,
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    sessionLabel: binding.sessionLabel,
    binding,
    lastActivityAt: Date.now(),
    notification: { lastStatus: "idle" },
    actions: {
      context: {
        ui: {
          notify: () => undefined,
          select: async () => undefined,
          confirm: async () => true,
          input: async () => undefined,
          onTerminalInput: () => () => undefined,
          setStatus: () => undefined,
          setWorkingMessage: () => undefined,
          setWidget: () => undefined,
          setFooter: () => undefined,
          setHeader: () => undefined,
          setTitle: () => undefined,
          custom: async () => undefined as never,
          pasteToEditor: () => undefined,
          setEditorText: () => undefined,
          getEditorText: () => "",
          editor: async () => undefined,
          setEditorComponent: () => undefined,
        },
        hasUI: false,
        cwd: process.cwd(),
        sessionManager: {
          getSessionId: () => binding.sessionId,
          getSessionFile: () => binding.sessionFile,
          getSessionName: () => binding.sessionLabel,
        },
        modelRegistry: {} as never,
        model: undefined,
        isIdle: () => currentIdle,
        abort: () => outbound.push("abort"),
        hasPendingMessages: () => false,
        shutdown: () => undefined,
        getContextUsage: () => undefined,
        compact: ({ onComplete }: { onComplete?: () => void } = {}) => onComplete?.(),
        getSystemPrompt: () => "",
      } as never,
      getModel: () => undefined,
      sendUserMessage: (text, options) => {
        deliveries.push({ text, deliverAs: options?.deliverAs });
      },
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "Image file not found." }),
      appendAudit: (message) => outbound.push(`audit:${message}`),
      persistBinding: () => undefined,
      promptLocalConfirmation,
      abort: () => outbound.push("abort"),
      compact: async () => {
        outbound.push("compact");
      },
    },
  };

  return {
    route,
    deliveries,
    outbound,
    setIdle(value: boolean) {
      currentIdle = value;
    },
  };
}

describe("InProcessTunnelRuntime", () => {
  it("loads setup before starting the polling loop", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const getMe = vi.fn(async () => ({ id: 123456, is_bot: true, first_name: "PiRelay", username: "pirelay_bot" }));
    (runtime as any).api = {
      getMe,
      getUpdates: vi.fn(async () => []),
      sendPlainText: async () => undefined,
    };
    (runtime as any).pollLoop = vi.fn(async () => undefined);

    await runtime.start();
    await runtime.stop();

    expect(getMe).toHaveBeenCalledTimes(1);
    expect((await store.getSetup())?.botId).toBe(123456);
  });

  it("registers Telegram command menu after setup and continues when registration fails", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const setBotCommands = vi.fn(async (_commands: Array<{ command: string; description: string }>) => undefined);
    (runtime as any).api = {
      getMe: vi.fn(async () => ({ id: 123456, is_bot: true, first_name: "PiRelay", username: "pirelay_bot" })),
      getUpdates: vi.fn(async () => []),
      sendPlainText: async () => undefined,
      setBotCommands,
    };
    (runtime as any).pollLoop = vi.fn(async () => undefined);

    await runtime.start();
    await runtime.stop();

    expect(setBotCommands).toHaveBeenCalledTimes(1);
    expect(setBotCommands.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "status" }),
      expect.objectContaining({ command: "sendfile" }),
      expect.objectContaining({ command: "sendimage" }),
    ]));

    const failing = new InProcessTunnelRuntime(config, store);
    (failing as any).api = {
      getMe: vi.fn(async () => ({ id: 123456, is_bot: true, first_name: "PiRelay", username: "pirelay_bot" })),
      getUpdates: vi.fn(async () => []),
      sendPlainText: async () => undefined,
      setBotCommands: vi.fn(async () => { throw new Error("botTOKEN should be redacted"); }),
    };
    (failing as any).pollLoop = vi.fn(async () => undefined);
    await expect(failing.start()).resolves.toBeUndefined();
    await failing.stop();
  });

  it("loads setup before filtering local bot-authored messages", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const sent: string[] = [];
    const getMe = vi.fn(async () => ({ id: 123456, is_bot: true, first_name: "PiRelay", username: "pirelay_bot" }));
    (runtime as any).api = {
      getMe,
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({
      updateId: 1,
      messageId: 1,
      text: "hello from myself",
      chat: { id: 777, type: "group" },
      user: { id: 123456, username: "pirelay_bot", isBot: true },
    });

    expect(getMe).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    expect((await store.getSetup())?.botId).toBe(123456);
  });

  it("can trust a Telegram pairing user for future confirmations", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-pair:/tmp/session-pair.jsonl",
      sessionId: "session-pair",
      sessionFile: "/tmp/session-pair.jsonl",
      sessionLabel: "pairing-docs",
      chatId: 100,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const promptLocalConfirmation = vi.fn(async () => "trust" as const);
    const { route } = createRoute(binding, true, promptLocalConfirmation);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };
    const first = await store.createPendingPairing({ channel: "telegram", sessionId: route.sessionId, sessionFile: route.sessionFile, sessionLabel: route.sessionLabel, expiryMs: 60_000 });

    await (runtime as any).processInbound({
      updateId: 100,
      messageId: 100,
      text: `/start ${first.nonce}`,
      chat: { id: 100, type: "private" },
      user: { id: 42, username: "owner", firstName: "Owner" },
    });

    expect(promptLocalConfirmation).toHaveBeenCalledTimes(1);
    expect(await store.getTrustedRelayUser("telegram", "42")).toMatchObject({ channel: "telegram", userId: "42", trustedBySessionLabel: "pairing-docs" });

    const second = await store.createPendingPairing({ channel: "telegram", sessionId: route.sessionId, sessionFile: route.sessionFile, sessionLabel: route.sessionLabel, expiryMs: 60_000 });
    await (runtime as any).processInbound({
      updateId: 101,
      messageId: 101,
      text: `/start ${second.nonce}`,
      chat: { id: 100, type: "private" },
      user: { id: 42, username: "owner", firstName: "Owner" },
    });

    expect(promptLocalConfirmation).toHaveBeenCalledTimes(1);
    expect(sent.filter((message) => message.includes("Connected to Pi session pairing-docs"))).toHaveLength(2);
  });

  it("rejects unauthorized Telegram users before any Pi injection", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-1:/tmp/session-1.jsonl",
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
      sessionLabel: "session-1.jsonl",
      chatId: 123,
      userId: 1,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);

    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await (runtime as any).processInbound({
      updateId: 1,
      messageId: 1,
      text: "/status",
      chat: { id: 123, type: "private" },
      user: { id: 2, username: "intruder" },
    });

    expect(deliveries).toHaveLength(0);
    expect(sent[0]).toContain("Unauthorized");
  });

  it("routes idle Telegram text as a normal Pi prompt with typing activity", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-2:/tmp/session-2.jsonl",
      sessionId: "session-2",
      sessionFile: "/tmp/session-2.jsonl",
      sessionLabel: "session-2.jsonl",
      chatId: 555,
      userId: 7,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const actions: Array<{ chatId: number; action: string }> = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendChatAction: async (chatId: number, action: string) => actions.push({ chatId, action }),
    };

    await (runtime as any).processInbound({
      updateId: 2,
      messageId: 2,
      text: "please summarize the branch",
      chat: { id: 555, type: "private" },
      user: { id: 7, username: "owner" },
    });

    expect(deliveries).toEqual([{ text: "please summarize the branch", deliverAs: undefined }]);
    expect(actions).toEqual([{ chatId: 555, action: "typing" }]);
    expect(sent).not.toContain("Prompt delivered to Pi.");
  });

  it("handles relay-prefixed Telegram commands instead of prompting Pi", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-relay-prefix:/tmp/session-relay-prefix.jsonl",
      sessionId: "session-relay-prefix",
      sessionFile: "/tmp/session-relay-prefix.jsonl",
      sessionLabel: "session-relay-prefix.jsonl",
      chatId: 556,
      userId: 8,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await (runtime as any).processInbound({
      updateId: 22,
      messageId: 22,
      text: "relay progress quiet",
      chat: { id: 556, type: "private" },
      user: { id: 8, username: "owner" },
    });

    expect(deliveries).toHaveLength(0);
    expect(route.binding?.progressMode).toBe("quiet");
    expect(sent.at(-1)).toContain("Progress notifications set to quiet.");
  });

  it("routes busy Telegram text using configured follow-up delivery", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-3:/tmp/session-3.jsonl",
      sessionId: "session-3",
      sessionFile: "/tmp/session-3.jsonl",
      sessionLabel: "session-3.jsonl",
      chatId: 777,
      userId: 9,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, false);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const actions: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendChatAction: async (_chatId: number, action: string) => actions.push(action),
    };

    await (runtime as any).processInbound({
      updateId: 3,
      messageId: 3,
      text: "continue with the test cleanup",
      chat: { id: 777, type: "private" },
      user: { id: 9, username: "owner" },
    });

    expect(deliveries).toEqual([{ text: "continue with the test cleanup", deliverAs: "followUp" }]);
    expect(actions).toEqual(["typing"]);
    expect(sent).toEqual(["Pi is busy; your message was queued as followUp."]);
  });

  it("routes authorized Telegram images as multimodal Pi prompts after authorization", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-image:/tmp/session-image.jsonl",
      sessionId: "session-image",
      sessionFile: "/tmp/session-image.jsonl",
      sessionLabel: "session-image.jsonl",
      chatId: 881,
      userId: 31,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.actions.getModel = () => ({ input: ["text", "image"] }) as never;
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const image = { type: "image" as const, data: Buffer.from("img").toString("base64"), mimeType: "image/jpeg" };
    const downloads: string[] = [];
    (runtime as any).api = {
      downloadImage: async (reference: any) => {
        downloads.push(reference.fileId);
        return { image, fileName: "photo.jpg", fileSize: 3, source: reference };
      },
      sendPlainText: async () => undefined,
      sendChatAction: async () => undefined,
    };

    await (runtime as any).processInbound({
      updateId: 21,
      messageId: 21,
      text: "what is broken here?",
      images: [{ kind: "photo", fileId: "photo-1", mimeType: "image/jpeg", supported: true }],
      chat: { id: 881, type: "private" },
      user: { id: 31, username: "owner" },
    });

    expect(downloads).toEqual(["photo-1"]);
    expect(deliveries).toEqual([{ text: [{ type: "text", text: "what is broken here?" }, image], deliverAs: undefined }]);
  });

  it("routes image-only Telegram albums as a single multimodal Pi prompt", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-image-album:/tmp/session-image-album.jsonl",
      sessionId: "session-image-album",
      sessionFile: "/tmp/session-image-album.jsonl",
      sessionLabel: "session-image-album.jsonl",
      chatId: 881,
      userId: 31,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.actions.getModel = () => ({ input: ["text", "image"] }) as never;
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const downloads: string[] = [];
    (runtime as any).api = {
      downloadImage: async (reference: any) => {
        downloads.push(reference.fileId);
        return {
          image: { type: "image" as const, data: Buffer.from(reference.fileId).toString("base64"), mimeType: "image/jpeg" },
          fileName: `${reference.fileId}.jpg`,
          fileSize: 3,
          source: reference,
        };
      },
      sendPlainText: async () => undefined,
      sendChatAction: async () => undefined,
    };

    await (runtime as any).processInbound({
      updateId: 24,
      messageId: 24,
      text: "",
      images: [
        { kind: "photo", fileId: "photo-a", mimeType: "image/jpeg", supported: true },
        { kind: "photo", fileId: "photo-b", mimeType: "image/jpeg", supported: true },
      ],
      chat: { id: 881, type: "private" },
      user: { id: 31, username: "owner" },
    });

    expect(downloads).toEqual(["photo-a", "photo-b"]);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.text).toMatchObject([
      { type: "text", text: "Please inspect the attached images." },
      { type: "image", mimeType: "image/jpeg" },
      { type: "image", mimeType: "image/jpeg" },
    ]);
  });

  it("does not download unauthorized Telegram images", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-image-auth:/tmp/session-image-auth.jsonl",
      sessionId: "session-image-auth",
      sessionFile: "/tmp/session-image-auth.jsonl",
      sessionLabel: "session-image-auth.jsonl",
      chatId: 882,
      userId: 32,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.actions.getModel = () => ({ input: ["text", "image"] }) as never;
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const downloadImage = vi.fn(async () => undefined);
    (runtime as any).api = {
      downloadImage,
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({
      updateId: 22,
      messageId: 22,
      text: "",
      images: [{ kind: "photo", fileId: "photo-unauthorized", mimeType: "image/jpeg", supported: true }],
      chat: { id: 882, type: "private" },
      user: { id: 999, username: "intruder" },
    });

    expect(downloadImage).not.toHaveBeenCalled();
    expect(deliveries).toEqual([]);
    expect(sent[0]).toContain("Unauthorized");
  });

  it("rejects image prompts when the current model is not image-capable", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-image-model:/tmp/session-image-model.jsonl",
      sessionId: "session-image-model",
      sessionFile: "/tmp/session-image-model.jsonl",
      sessionLabel: "session-image-model.jsonl",
      chatId: 883,
      userId: 33,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.actions.getModel = () => ({ input: ["text"] }) as never;
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const downloadImage = vi.fn(async () => undefined);
    (runtime as any).api = {
      downloadImage,
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({
      updateId: 23,
      messageId: 23,
      text: "caption only should not be injected",
      images: [{ kind: "photo", fileId: "photo-model", mimeType: "image/jpeg", supported: true }],
      chat: { id: 883, type: "private" },
      user: { id: 33, username: "owner" },
    });

    expect(downloadImage).not.toHaveBeenCalled();
    expect(deliveries).toEqual([]);
    expect(sent[0]).toContain("does not support image input");
  });

  it("falls back to a textual acknowledgement when typing activity fails", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-typing-fallback:/tmp/session-typing-fallback.jsonl",
      sessionId: "session-typing-fallback",
      sessionFile: "/tmp/session-typing-fallback.jsonl",
      sessionLabel: "session-typing-fallback.jsonl",
      chatId: 778,
      userId: 12,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendChatAction: async () => {
        throw new Error("chat action failed");
      },
    };

    await (runtime as any).processInbound({
      updateId: 8,
      messageId: 8,
      text: "please run the checks",
      chat: { id: 778, type: "private" },
      user: { id: 12, username: "owner" },
    });

    expect(deliveries).toEqual([{ text: "please run the checks", deliverAs: undefined }]);
    expect(sent).toEqual(["Prompt delivered to Pi."]);
  });

  it("refreshes typing activity while busy and stops after route unregister", async () => {
    vi.useFakeTimers();
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-typing-refresh:/tmp/session-typing-refresh.jsonl",
      sessionId: "session-typing-refresh",
      sessionFile: "/tmp/session-typing-refresh.jsonl",
      sessionLabel: "session-typing-refresh.jsonl",
      chatId: 779,
      userId: 13,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route } = createRoute(binding, false);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const actions: string[] = [];
    (runtime as any).api = {
      sendPlainText: async () => undefined,
      sendChatAction: async (_chatId: number, action: string) => actions.push(action),
    };

    await (runtime as any).processInbound({
      updateId: 9,
      messageId: 9,
      text: "queue this while busy",
      chat: { id: 779, type: "private" },
      user: { id: 13, username: "owner" },
    });

    expect(actions).toEqual(["typing"]);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => expect(actions).toEqual(["typing", "typing"]));

    await runtime.unregisterRoute(route.sessionKey);
    await vi.advanceTimersByTimeAsync(4000);
    expect(actions).toEqual(["typing", "typing"]);
  });

  it("accepts direct numeric answers for structured choice metadata", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-4:/tmp/session-4.jsonl",
      sessionId: "session-4",
      sessionFile: "/tmp/session-4.jsonl",
      sessionLabel: "session-4.jsonl",
      chatId: 888,
      userId: 10,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.notification.structuredAnswer = extractStructuredAnswerMetadata([
      "Choose:",
      "1. sync — sync specs now, then archive",
      "2. skip — archive without syncing",
    ].join("\n"));
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = [
      "Choose:",
      "1. sync — sync specs now, then archive",
      "2. skip — archive without syncing",
    ].join("\n");
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    (runtime as any).api = { sendPlainText: async () => undefined };

    await (runtime as any).processInbound({
      updateId: 4,
      messageId: 4,
      text: "1",
      chat: { id: 888, type: "private" },
      user: { id: 10, username: "owner" },
    });

    expect(deliveries).toEqual([
      {
        text: "Answer to: Choose:\nSelected option 1: sync — sync specs now, then archive",
        deliverAs: undefined,
      },
    ]);
  });

  it("routes prompt-like text as a normal prompt after answerable output", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-prompt-like:/tmp/session-prompt-like.jsonl",
      sessionId: "session-prompt-like",
      sessionFile: "/tmp/session-prompt-like.jsonl",
      sessionLabel: "session-prompt-like.jsonl",
      chatId: 889,
      userId: 10,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries, outbound } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = ["Choose:", "1. sync", "2. skip"].join("\n");
    route.notification.structuredAnswer = extractStructuredAnswerMetadata(route.notification.lastAssistantText);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    (runtime as any).api = { sendPlainText: async () => undefined, sendChatAction: async () => undefined };

    await (runtime as any).processInbound({
      updateId: 41,
      messageId: 41,
      text: "How can messenger interaction be adjusted to be audio-first?",
      chat: { id: 889, type: "private" },
      user: { id: 10, username: "owner" },
    });

    expect(deliveries).toEqual([{ text: "How can messenger interaction be adjusted to be audio-first?", deliverAs: undefined }]);
    expect(outbound.at(-1)).toBe("audit:Telegram @owner sent a prompt.");
  });

  it("asks for confirmation for ambiguous answer-like text", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-ambiguous:/tmp/session-ambiguous.jsonl",
      sessionId: "session-ambiguous",
      sessionFile: "/tmp/session-ambiguous.jsonl",
      sessionLabel: "session-ambiguous.jsonl",
      chatId: 890,
      userId: 10,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastTurnId = "turn-ambiguous";
    route.notification.lastAssistantText = ["Choose:", "1. sync", "2. skip"].join("\n");
    route.notification.structuredAnswer = extractStructuredAnswerMetadata(route.notification.lastAssistantText, { turnId: "turn-ambiguous" });
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sends: Array<{ text: string; keyboard?: any }> = [];
    const callbacks: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sends.push({ text }),
      sendPlainTextWithKeyboard: async (_chatId: number, text: string, keyboard?: any) => sends.push({ text, keyboard }),
      sendChatAction: async () => undefined,
      answerCallbackQuery: async (_id: string, text?: string) => callbacks.push(text ?? ""),
    };

    await (runtime as any).processInbound({
      updateId: 42,
      messageId: 42,
      text: "I think sync is safest",
      chat: { id: 890, type: "private" },
      user: { id: 10, username: "owner" },
    });

    expect(deliveries).toEqual([]);
    expect(sends[0]?.text).toContain("could be an answer");
    const promptCallback = sends[0]?.keyboard?.[0]?.[0]?.callbackData as string;
    expect(parseTelegramActionCallbackData(promptCallback)).toMatchObject({ kind: "answer-ambiguity", resolution: "prompt" });

    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 43,
      callbackQueryId: "amb-1",
      data: promptCallback,
      chat: { id: 890, type: "private" },
      user: { id: 10, username: "owner" },
    });

    expect(callbacks).toEqual(["Sending as prompt."]);
    expect(deliveries).toEqual([{ text: "I think sync is safest", deliverAs: undefined }]);
  });

  it("supports explicit answer-draft replies for structured questions", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-5:/tmp/session-5.jsonl",
      sessionId: "session-5",
      sessionFile: "/tmp/session-5.jsonl",
      sessionLabel: "session-5.jsonl",
      chatId: 999,
      userId: 11,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.notification.structuredAnswer = extractStructuredAnswerMetadata([
      "Please answer the following questions.",
      "What environment should we target?",
      "Do we archive immediately?",
    ].join("\n"));
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = [
      "Please answer the following questions.",
      "What environment should we target?",
      "Do we archive immediately?",
    ].join("\n");
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await (runtime as any).processInbound({
      updateId: 5,
      messageId: 5,
      text: "answer",
      chat: { id: 999, type: "private" },
      user: { id: 11, username: "owner" },
    });
    await (runtime as any).processInbound({
      updateId: 6,
      messageId: 6,
      text: [
        "A1: staging",
        "A2: yes, archive now",
      ].join("\n"),
      chat: { id: 999, type: "private" },
      user: { id: 11, username: "owner" },
    });

    expect(sent[0]).toContain("Answering the latest completed assistant output:");
    expect(sent[0]).toContain("A1:");
    expect(sent[1]).toContain("Sent your answers to Pi.");
    expect(deliveries).toEqual([
      {
        text: [
          "Please answer the following questions.",
          "Q1: What environment should we target?",
          "A1: staging",
          "",
          "Q2: Do we archive immediately?",
          "A2: yes, archive now",
        ].join("\n"),
        deliverAs: undefined,
      },
    ]);
  });

  it("falls back cleanly when answer is requested without reliable structured metadata", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-answer-fallback:/tmp/session-answer-fallback.jsonl",
      sessionId: "session-answer-fallback",
      sessionFile: "/tmp/session-answer-fallback.jsonl",
      sessionLabel: "session-answer-fallback.jsonl",
      chatId: 1000,
      userId: 20,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = "Thanks, I finished the task.";
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await (runtime as any).processInbound({
      updateId: 7,
      messageId: 7,
      text: "answer",
      chat: { id: 1000, type: "private" },
      user: { id: 20, username: "owner" },
    });

    expect(deliveries).toEqual([]);
    expect(sent[0]).toContain("could not build a structured answer draft");
  });

  it("only attaches full-output buttons when the completion preview is truncated", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-button-threshold:/tmp/session-button-threshold.jsonl",
      sessionId: "session-button-threshold",
      sessionFile: "/tmp/session-button-threshold.jsonl",
      sessionLabel: "session-button-threshold.jsonl",
      chatId: 1010,
      userId: 30,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route } = createRoute(binding, true);
    binding.progressMode = "quiet";
    route.notification.lastTurnId = "turn-short";
    route.notification.lastAssistantText = "Hey! Morning — ready when you are.";
    const sends: Array<{ text: string; keyboard?: unknown }> = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string, keyboard?: unknown) => sends.push({ text, keyboard }),
    };

    await runtime.notifyTurnCompleted(route, "completed");

    expect(sends[0]?.text).toContain("Hey! Morning — ready when you are.");
    expect(sends[0]?.text).not.toContain("Use /full");
    expect(sends[0]?.keyboard).toBeUndefined();

    sends.length = 0;
    route.notification.lastTurnId = "turn-long";
    route.notification.lastAssistantText = "Long output ".repeat(40);

    await runtime.notifyTurnCompleted(route, "completed");

    expect(sends[0]?.text).toContain("Use /full");
    expect(sends[0]?.keyboard).toEqual(buildFullOutputKeyboard("turn-long"));

    sends.length = 0;
    const decisionText = [
      `${"Long decision output ".repeat(30)}`,
      "",
      "Choose:",
      "1. Review the current diff.",
      "2. Commit the current changes.",
    ].join("\n");
    route.notification.lastTurnId = "turn-decision";
    route.notification.lastAssistantText = decisionText;
    route.notification.structuredAnswer = extractStructuredAnswerMetadata(decisionText);

    await runtime.notifyTurnCompleted(route, "completed");

    expect(sends).toHaveLength(2);
    expect(sends[0]?.text).not.toContain("Use /full");
    expect(sends[0]?.keyboard).toBeUndefined();
    expect(sends[1]?.text).toContain("Use /full or the full-output buttons");
    expect(sends[1]?.keyboard).toEqual(expect.arrayContaining(buildFullOutputKeyboard(route.notification.structuredAnswer!.turnId)));

    sends.length = 0;
    route.notification.latestImages = { turnId: "turn-decision", count: 1, skipped: 0 };

    await runtime.notifyTurnCompleted(route, "completed");

    expect(sends).toHaveLength(2);
    expect(sends[0]?.keyboard).toBeUndefined();
    expect(sends[1]?.keyboard).toEqual(expect.arrayContaining(buildLatestImagesKeyboard("turn-decision", 1)));
  });

  it("falls back to a Markdown document for very large Telegram completions", async () => {
    const config = await createRuntimeConfig();
    config.maxTelegramMessageChars = 20;
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-large-output:/tmp/session-large-output.jsonl",
      sessionId: "session-large-output",
      sessionFile: "/tmp/session-large-output.jsonl",
      sessionLabel: "session-large-output.jsonl",
      chatId: 10121,
      userId: 321,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.notification.lastTurnId = "turn-large";
    route.notification.lastAssistantText = "paragraph one\n\nparagraph two\n\nparagraph three\n\nparagraph four\n\nparagraph five\n\nparagraph six";
    const texts: string[] = [];
    const documents: Array<{ filename: string; data: string; caption?: string }> = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => texts.push(text),
      sendPlainText: async (_chatId: number, text: string) => texts.push(text),
      sendDocumentData: async (_chatId: number, filename: string, data: Uint8Array, caption?: string) => documents.push({ filename, data: Buffer.from(data).toString("utf8"), caption }),
    };

    await runtime.notifyTurnCompleted(route, "completed");

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Full output is attached as Markdown");
    expect(documents).toEqual([{ filename: "pi-output-session-large-output-turn-large.md", data: route.notification.lastAssistantText, caption: "Latest assistant output" }]);
  });

  it("uses summaries for broker fallback completion notifications", async () => {
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-broker-quiet:/tmp/session-broker-quiet.jsonl",
      sessionId: "session-broker-quiet",
      sessionFile: "/tmp/session-broker-quiet.jsonl",
      sessionLabel: "session-broker-quiet.jsonl",
      chatId: 10120,
      userId: 320,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.notification.lastAssistantText = "Full final output that should not be sent through the broker fallback completion path. ".repeat(20);
    const sent: string[] = [];
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 1, botUsername: "bot", botDisplayName: "Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async (_sessionKey, text) => {
        sent.push(text);
      }),
    };

    await sendSessionNotification(fakeRuntime, route, "completed", { progressMode: "quiet" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(route.notification.lastSummary);
    expect(sent[0]!.length).toBeLessThan(route.notification.lastAssistantText!.length);

    sent.length = 0;
    await sendSessionNotification(fakeRuntime, route, "completed", { progressMode: "normal" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(route.notification.lastSummary!);
    expect(sent[0]).toContain("Use /full for the full assistant output.");
    expect(sent[0]).not.toContain(route.notification.lastAssistantText!);
  });

  it("sends Telegram failure and aborted terminal notifications", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-terminal:/tmp/session-terminal.jsonl",
      sessionId: "session-terminal",
      sessionFile: "/tmp/session-terminal.jsonl",
      sessionLabel: "session-terminal.jsonl",
      chatId: 1012,
      userId: 32,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.notification.startedAt = Date.now() - 2_000;
    route.notification.lastFailure = "The agent finished without a final assistant response.";
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await runtime.notifyTurnCompleted(route, "failed");
    await runtime.notifyTurnCompleted(route, "aborted");

    expect(sent[0]).toContain("Pi task failed");
    expect(sent[0]).toContain("without a final assistant response");
    expect(sent[1]).toContain("Pi task aborted");
  });

  it("treats terminal notification state as idle even if stale busy context remains", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-stale-busy:/tmp/session-stale-busy.jsonl",
      sessionId: "session-stale-busy",
      sessionFile: "/tmp/session-stale-busy.jsonl",
      sessionLabel: "session-stale-busy.jsonl",
      chatId: 1001,
      userId: 21,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, false);
    route.notification.lastStatus = "completed";
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const actions: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendChatAction: async (_chatId: number, action: string) => actions.push(action),
    };

    await (runtime as any).processInbound({
      updateId: 10,
      messageId: 10,
      text: "check openspec status",
      chat: { id: 1001, type: "private" },
      user: { id: 21, username: "owner" },
    });

    expect(deliveries).toEqual([{ text: "check openspec status", deliverAs: undefined }]);
    expect(sent).not.toContain("Pi is busy; your message was queued as followUp.");
    expect(actions).toEqual(["typing"]);
  });

  it("handles inline option callbacks for the current assistant turn", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-callback-option:/tmp/session-callback-option.jsonl",
      sessionId: "session-callback-option",
      sessionFile: "/tmp/session-callback-option.jsonl",
      sessionLabel: "session-callback-option.jsonl",
      chatId: 1002,
      userId: 22,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastTurnId = "turn-callback";
    route.notification.lastAssistantText = ["Choose:", "1. sync", "2. skip"].join("\n");
    route.notification.structuredAnswer = extractStructuredAnswerMetadata(route.notification.lastAssistantText, { turnId: "turn-callback" });
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const callbacks: string[] = [];
    (runtime as any).api = {
      sendPlainText: async () => undefined,
      sendChatAction: async () => undefined,
      answerCallbackQuery: async (_id: string, text?: string) => callbacks.push(text ?? ""),
    };

    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 11,
      callbackQueryId: "cb-1",
      data: buildAnswerOptionCallbackData("turn-callback", "2"),
      chat: { id: 1002, type: "private" },
      user: { id: 22, username: "owner" },
    });

    expect(callbacks).toEqual(["Selected 2"]);
    expect(deliveries).toEqual([{ text: "Answer to: Choose:\nSelected option 2: skip", deliverAs: undefined }]);
    expect(route.remoteRequester?.messageId).toBeUndefined();
  });

  it("does not answer callback as unavailable for non-unavailable prompt failures", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-callback-failure:/tmp/session-callback-failure.jsonl",
      sessionId: "session-callback-failure",
      sessionFile: "/tmp/session-callback-failure.jsonl",
      sessionLabel: "session-callback-failure.jsonl",
      chatId: 1002,
      userId: 22,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route } = createRoute(binding, true);
    route.actions.sendUserMessage = () => { throw new Error("non-unavailable prompt failure"); };
    route.notification.lastStatus = "completed";
    route.notification.lastTurnId = "turn-callback-failure";
    route.notification.lastAssistantText = ["Choose:", "1. sync", "2. skip"].join("\n");
    route.notification.structuredAnswer = extractStructuredAnswerMetadata(route.notification.lastAssistantText, { turnId: "turn-callback-failure" });
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const callbacks: string[] = [];
    (runtime as any).api = {
      sendPlainText: async () => undefined,
      sendChatAction: async () => undefined,
      answerCallbackQuery: async (_id: string, text?: string) => callbacks.push(text ?? ""),
    };

    await expect((runtime as any).processInbound({
      kind: "callback",
      updateId: 111,
      callbackQueryId: "cb-failure",
      data: buildAnswerOptionCallbackData("turn-callback-failure", "2"),
      chat: { id: 1002, type: "private" },
      user: { id: 22, username: "owner" },
    })).rejects.toThrow("non-unavailable prompt failure");

    expect(callbacks).toEqual([]);
  });

  it("captures custom answers after an inline custom-answer callback and lets commands bypass capture", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-custom-callback:/tmp/session-custom-callback.jsonl",
      sessionId: "session-custom-callback",
      sessionFile: "/tmp/session-custom-callback.jsonl",
      sessionLabel: "session-custom-callback.jsonl",
      chatId: 1003,
      userId: 23,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastTurnId = "turn-custom";
    route.notification.lastAssistantText = ["Choose:", "1. sync", "2. skip"].join("\n");
    route.notification.structuredAnswer = extractStructuredAnswerMetadata(route.notification.lastAssistantText, { turnId: "turn-custom" });
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const callbacks: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendChatAction: async () => undefined,
      answerCallbackQuery: async (_id: string, text?: string) => callbacks.push(text ?? ""),
    };

    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 12,
      callbackQueryId: "cb-2",
      data: buildAnswerCustomCallbackData("turn-custom"),
      chat: { id: 1003, type: "private" },
      user: { id: 23, username: "owner" },
    });
    await (runtime as any).processInbound({
      updateId: 13,
      messageId: 13,
      text: "cancel",
      chat: { id: 1003, type: "private" },
      user: { id: 23, username: "owner" },
    });
    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 14,
      callbackQueryId: "cb-3",
      data: buildAnswerCustomCallbackData("turn-custom"),
      chat: { id: 1003, type: "private" },
      user: { id: 23, username: "owner" },
    });
    await (runtime as any).processInbound({
      updateId: 15,
      messageId: 15,
      text: "/status",
      chat: { id: 1003, type: "private" },
      user: { id: 23, username: "owner" },
    });
    await (runtime as any).processInbound({
      updateId: 16,
      messageId: 16,
      text: "Use my own custom plan",
      chat: { id: 1003, type: "private" },
      user: { id: 23, username: "owner" },
    });

    expect(callbacks).toEqual(["Send your custom answer.", "Send your custom answer."]);
    expect(sent[0]).toContain("Send your custom answer");
    expect(sent).toContain("Custom answer cancelled.");
    expect(sent.some((text) => text.includes("Session:"))).toBe(true);
    expect(sent.at(-1)).toBe("Sent your custom answer to Pi.");
    expect(deliveries).toEqual([{ text: "Answer to: Choose:\nUse my own custom plan", deliverAs: undefined }]);
  });

  it("rejects stale callbacks and handles full-output actions", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-full-callback:/tmp/session-full-callback.jsonl",
      sessionId: "session-full-callback",
      sessionFile: "/tmp/session-full-callback.jsonl",
      sessionLabel: "session-full-callback.jsonl",
      chatId: 1004,
      userId: 24,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route, deliveries } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastTurnId = "turn-full";
    route.notification.lastAssistantText = "Full assistant output";
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const callbacks: string[] = [];
    const sent: string[] = [];
    const documents: Array<{ filename: string; text: string }> = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendChatAction: async () => undefined,
      sendMarkdownDocument: async (_chatId: number, filename: string, text: string) => documents.push({ filename, text }),
      answerCallbackQuery: async (_id: string, text?: string) => callbacks.push(text ?? ""),
    };

    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 15,
      callbackQueryId: "cb-unauthorized",
      data: buildFullChatCallbackData("turn-full"),
      chat: { id: 1004, type: "private" },
      user: { id: 999, username: "intruder" },
    });
    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 16,
      callbackQueryId: "cb-3",
      data: buildAnswerOptionCallbackData("older-turn", "1"),
      chat: { id: 1004, type: "private" },
      user: { id: 24, username: "owner" },
    });
    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 17,
      callbackQueryId: "cb-4",
      data: buildFullChatCallbackData("turn-full"),
      chat: { id: 1004, type: "private" },
      user: { id: 24, username: "owner" },
    });
    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 18,
      callbackQueryId: "cb-5",
      data: buildFullMarkdownCallbackData("turn-full"),
      chat: { id: 1004, type: "private" },
      user: { id: 24, username: "owner" },
    });

    expect(callbacks).toEqual(["Unauthorized.", "This action is no longer current.", "Sending full output.", "Sending Markdown file."]);
    expect(sent).toContain("Full assistant output");
    expect(documents[0]?.filename).toContain("pi-output-session-full-callback-turn-full.md");
    expect(documents[0]?.text).toBe("Full assistant output");
    expect(deliveries).toEqual([]);
  });

  it("sends latest image outputs via command and rejects stale image callbacks", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-images-callback:/tmp/session-images-callback.jsonl",
      sessionId: "session-images-callback",
      sessionFile: "/tmp/session-images-callback.jsonl",
      sessionLabel: "session-images-callback.jsonl",
      chatId: 1005,
      userId: 25,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const { route } = createRoute(binding, true);
    const latestImage = {
      id: "turn-images-1",
      turnId: "turn-images",
      fileName: "preview.png",
      mimeType: "image/png",
      data: Buffer.from([1, 2, 3]).toString("base64"),
      byteSize: 3,
    };
    route.notification.lastStatus = "completed";
    route.notification.lastTurnId = "turn-images";
    route.notification.lastAssistantText = "Generated image.";
    route.notification.latestImages = { turnId: "turn-images", count: 1, skipped: 0 };
    route.actions.getLatestImages = async () => [latestImage];
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const callbacks: string[] = [];
    const sent: string[] = [];
    const images: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendImageDocument: async (_chatId: number, image: { fileName: string }) => images.push(image.fileName),
      answerCallbackQuery: async (_id: string, text?: string) => callbacks.push(text ?? ""),
    };

    await (runtime as any).processInbound({
      updateId: 19,
      messageId: 19,
      text: "/images",
      chat: { id: 1005, type: "private" },
      user: { id: 25, username: "owner" },
    });
    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 20,
      callbackQueryId: "cb-images-stale",
      data: buildLatestImagesCallbackData("older-turn"),
      chat: { id: 1005, type: "private" },
      user: { id: 25, username: "owner" },
    });
    await (runtime as any).processInbound({
      kind: "callback",
      updateId: 21,
      callbackQueryId: "cb-images-current",
      data: buildLatestImagesCallbackData("turn-images"),
      chat: { id: 1005, type: "private" },
      user: { id: 25, username: "owner" },
    });

    expect(images).toEqual(["preview.png", "preview.png"]);
    expect(callbacks).toEqual(["This action is no longer current.", "Sending image outputs."]);
    expect(sent).toContain("That image action belongs to an older Pi output. Use the latest buttons or /images.");
  });

  it("routes session-list dashboard callbacks to the selected session", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const firstBinding: TelegramBindingMetadata = {
      sessionKey: "session-dash-1:/tmp/session-dash-1.jsonl",
      sessionId: "session-dash-1",
      sessionFile: "/tmp/session-dash-1.jsonl",
      sessionLabel: "first.jsonl",
      chatId: 1008,
      userId: 28,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const secondBinding: TelegramBindingMetadata = {
      sessionKey: "session-dash-2:/tmp/session-dash-2.jsonl",
      sessionId: "session-dash-2",
      sessionFile: "/tmp/session-dash-2.jsonl",
      sessionLabel: "second.jsonl",
      alias: "second-phone",
      chatId: 1008,
      userId: 28,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const first = createRoute(firstBinding, true).route;
    const second = createRoute(secondBinding, true).route;
    second.notification.recentActivity = [createProgressActivity({ id: "p2", kind: "tool", text: "Second route activity", at: Date.now() }, config)!];
    await store.upsertBinding(firstBinding);
    await store.upsertBinding(secondBinding);
    (runtime as any).routes.set(first.sessionKey, first);
    (runtime as any).routes.set(second.sessionKey, second);
    const sent: string[] = [];
    const callbacks: string[] = [];
    (runtime as any).api = {
      answerCallbackQuery: async (_id: string, text?: string) => callbacks.push(text ?? ""),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processCallback({
      kind: "callback",
      updateId: 30,
      callbackQueryId: "dash-i2",
      messageId: 30,
      data: buildDashboardCallbackData(sessionDashboardRef(second.sessionKey), "recent"),
      chat: { id: 1008, type: "private" },
      user: { id: 28, username: "owner" },
    });

    expect(callbacks).toEqual(["Showing recent activity."]);
    expect(sent.join("\n")).toContain("Second route activity");
  });

  it("uses dashboard selection for subsequent in-process prompts", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const firstBinding: TelegramBindingMetadata = {
      sessionKey: "session-use-1:/tmp/session-use-1.jsonl",
      sessionId: "session-use-1",
      sessionFile: "/tmp/session-use-1.jsonl",
      sessionLabel: "first.jsonl",
      chatId: 1009,
      userId: 29,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const secondBinding: TelegramBindingMetadata = {
      sessionKey: "session-use-2:/tmp/session-use-2.jsonl",
      sessionId: "session-use-2",
      sessionFile: "/tmp/session-use-2.jsonl",
      sessionLabel: "second.jsonl",
      chatId: 1009,
      userId: 29,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const first = createRoute(firstBinding, true);
    const second = createRoute(secondBinding, true);
    await store.upsertBinding(firstBinding);
    await store.upsertBinding(secondBinding);
    (runtime as any).routes.set(first.route.sessionKey, first.route);
    (runtime as any).routes.set(second.route.sessionKey, second.route);
    (runtime as any).api = {
      answerCallbackQuery: async () => undefined,
      sendPlainText: async () => undefined,
      sendPlainTextWithKeyboard: async () => undefined,
    };

    await (runtime as any).processCallback({
      kind: "callback",
      updateId: 31,
      callbackQueryId: "dash-use-second",
      messageId: 31,
      data: buildDashboardCallbackData(sessionDashboardRef(second.route.sessionKey), "use"),
      chat: { id: 1009, type: "private" },
      user: { id: 29, username: "owner" },
    });

    await (runtime as any).processInbound({
      updateId: 32,
      messageId: 32,
      text: "hello selected session",
      chat: { id: 1009, type: "private" },
      user: { id: 29, username: "owner" },
    });

    expect(first.deliveries).toHaveLength(0);
    expect(second.deliveries).toEqual([{ text: "hello selected session", deliverAs: undefined }]);
  });

  it("reports unavailable routes before delivering Telegram prompts", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-unavailable:/tmp/session-unavailable.jsonl",
      sessionId: "session-unavailable",
      sessionFile: "/tmp/session-unavailable.jsonl",
      sessionLabel: "unavailable.jsonl",
      chatId: 1012,
      userId: 32,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route, deliveries } = createRoute(binding, true);
    route.actions.isIdle = () => undefined;
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await (runtime as any).processInbound({ updateId: 39, messageId: 39, text: "hello unavailable", chat: { id: 1012, type: "private" }, user: { id: 32, username: "owner" } });

    expect(deliveries).toEqual([]);
    expect(sent).toContain("The Pi session is unavailable. Resume it locally, then try again.");
  });

  it("stops Telegram activity indicators for unavailable routes", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-unavailable-activity:/tmp/session-unavailable-activity.jsonl",
      sessionId: "session-unavailable-activity",
      sessionFile: "/tmp/session-unavailable-activity.jsonl",
      sessionLabel: "unavailable-activity.jsonl",
      chatId: 1016,
      userId: 36,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.actions.isIdle = () => undefined;
    route.notification.lastStatus = "running";
    await store.upsertBinding(binding);

    expect((runtime as any).shouldContinueActivityIndicator(route)).toBe(false);
  });

  it("reports Telegram prompt delivery becoming unavailable after the idle check", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-unavailable-send:/tmp/session-unavailable-send.jsonl",
      sessionId: "session-unavailable-send",
      sessionFile: "/tmp/session-unavailable-send.jsonl",
      sessionLabel: "unavailable-send.jsonl",
      chatId: 1014,
      userId: 34,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route, deliveries } = createRoute(binding, true);
    route.actions.sendUserMessage = () => { throw routeUnavailableError(); };
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await (runtime as any).processInbound({ updateId: 44, messageId: 44, text: "hello unavailable after check", chat: { id: 1014, type: "private" }, user: { id: 34, username: "owner" } });

    expect(deliveries).toEqual([]);
    expect(sent).toContain("The Pi session is unavailable. Resume it locally, then try again.");
  });

  it("rolls back Telegram abort state when abort becomes unavailable", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-unavailable-abort:/tmp/session-unavailable-abort.jsonl",
      sessionId: "session-unavailable-abort",
      sessionFile: "/tmp/session-unavailable-abort.jsonl",
      sessionLabel: "unavailable-abort.jsonl",
      chatId: 1015,
      userId: 35,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route, setIdle } = createRoute(binding, true);
    setIdle(false);
    route.actions.abort = () => { throw routeUnavailableError(); };
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    await (runtime as any).processInbound({ updateId: 45, messageId: 45, text: "/abort", chat: { id: 1015, type: "private" }, user: { id: 35, username: "owner" } });

    expect(route.notification.abortRequested).toBe(false);
    expect(sent).toContain("The Pi session is unavailable. Resume it locally, then try again.");
  });

  it("supports text /use, /to, and /forget session controls in-process", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const firstBinding: TelegramBindingMetadata = {
      sessionKey: "session-text-use-1:/tmp/session-text-use-1.jsonl",
      sessionId: "session-text-use-1",
      sessionFile: "/tmp/session-text-use-1.jsonl",
      sessionLabel: "first.jsonl",
      chatId: 1011,
      userId: 31,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const secondBinding: TelegramBindingMetadata = {
      sessionKey: "session-text-use-2:/tmp/session-text-use-2.jsonl",
      sessionId: "session-text-use-2",
      sessionFile: "/tmp/session-text-use-2.jsonl",
      sessionLabel: "second.jsonl",
      alias: "phone",
      chatId: 1011,
      userId: 31,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const offlineBinding: TelegramBindingMetadata = {
      sessionKey: "session-text-use-offline:/tmp/session-text-use-offline.jsonl",
      sessionId: "session-text-use-offline",
      sessionFile: "/tmp/session-text-use-offline.jsonl",
      sessionLabel: "offline.jsonl",
      chatId: 1011,
      userId: 31,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const first = createRoute(firstBinding, true);
    const second = createRoute(secondBinding, true);
    await store.upsertBinding(firstBinding);
    await store.upsertBinding(secondBinding);
    await store.upsertBinding(offlineBinding);
    (runtime as any).routes.set(first.route.sessionKey, first.route);
    (runtime as any).routes.set(second.route.sessionKey, second.route);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({ updateId: 40, messageId: 40, text: "/use phone", chat: { id: 1011, type: "private" }, user: { id: 31, username: "owner" } });
    await (runtime as any).processInbound({ updateId: 41, messageId: 41, text: "hello active", chat: { id: 1011, type: "private" }, user: { id: 31, username: "owner" } });
    await (runtime as any).processInbound({ updateId: 42, messageId: 42, text: "/to first.jsonl one shot", chat: { id: 1011, type: "private" }, user: { id: 31, username: "owner" } });
    await (runtime as any).processInbound({ updateId: 43, messageId: 43, text: "/forget offline.jsonl", chat: { id: 1011, type: "private" }, user: { id: 31, username: "owner" } });

    expect(second.deliveries).toContainEqual({ text: "hello active", deliverAs: undefined });
    expect(first.deliveries).toContainEqual({ text: "one shot", deliverAs: undefined });
    expect(sent.join("\n")).toContain("Forgot offline session offline.jsonl");
    expect((await store.getBindingBySessionKey(offlineBinding.sessionKey))?.status).toBe("revoked");
  });

  it("marks unavailable in-memory Telegram routes offline in session entries", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-unavailable-list:/tmp/session-unavailable-list.jsonl",
      sessionId: "session-unavailable-list",
      sessionFile: "/tmp/session-unavailable-list.jsonl",
      sessionLabel: "unavailable-list.jsonl",
      chatId: 1013,
      userId: 33,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.actions.isIdle = () => undefined;
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);

    const entries = await (runtime as any).sessionEntriesFromBindings([binding], () => true);

    expect(entries).toContainEqual(expect.objectContaining({ sessionKey: route.sessionKey, online: false, busy: false }));
  });

  it("includes persisted offline sessions in the in-process session list", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const onlineBinding: TelegramBindingMetadata = {
      sessionKey: "session-online:/tmp/session-online.jsonl",
      sessionId: "session-online",
      sessionFile: "/tmp/session-online.jsonl",
      sessionLabel: "online.jsonl",
      chatId: 1010,
      userId: 30,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const offlineBinding: TelegramBindingMetadata = {
      sessionKey: "session-offline:/tmp/session-offline.jsonl",
      sessionId: "session-offline",
      sessionFile: "/tmp/session-offline.jsonl",
      sessionLabel: "offline.jsonl",
      chatId: 1010,
      userId: 30,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const online = createRoute(onlineBinding, true);
    await store.upsertBinding(onlineBinding);
    await store.upsertBinding(offlineBinding);
    (runtime as any).routes.set(online.route.sessionKey, online.route);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({
      updateId: 33,
      messageId: 33,
      text: "/sessions",
      chat: { id: 1010, type: "private" },
      user: { id: 30, username: "owner" },
    });

    expect(sent.join("\n")).toContain("online.jsonl");
    expect(sent.join("\n")).toContain("offline.jsonl");
    expect(sent.join("\n")).toContain("offline");
  });

  it("does not list a stale in-memory route after its persisted Telegram binding is revoked", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-revoked-list:/tmp/session-revoked-list.jsonl",
      sessionId: "session-revoked-list",
      sessionFile: "/tmp/session-revoked-list.jsonl",
      sessionLabel: "revoked-list.jsonl",
      chatId: 3030,
      userId: 30,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    await store.upsertBinding(binding);
    await store.revokeBinding(binding.sessionKey);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({
      updateId: 34,
      messageId: 34,
      text: "/sessions",
      chat: { id: 3030, type: "private" },
      user: { id: 30, username: "owner" },
    });

    expect(sent.join("\n")).toContain("No paired sessions were found");
    expect(sent.join("\n")).not.toContain("revoked-list.jsonl");
  });

  it("suppresses Telegram completion delivery after persisted binding revocation", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-revoked-completion:/tmp/session-revoked-completion.jsonl",
      sessionId: "session-revoked-completion",
      sessionFile: "/tmp/session-revoked-completion.jsonl",
      sessionLabel: "revoked-completion.jsonl",
      chatId: 4040,
      userId: 40,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = "This output must not be sent.";
    route.notification.lastTurnId = "turn-revoked";
    await store.upsertBinding(binding);
    await store.revokeBinding(binding.sessionKey);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendDocumentData: async () => sent.push("document"),
    };

    await runtime.notifyTurnCompleted(route, "completed");

    expect(sent).toEqual([]);
  });

  it("suppresses Telegram completion delivery when state is unavailable", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-corrupt-completion:/tmp/session-corrupt-completion.jsonl",
      sessionId: "session-corrupt-completion",
      sessionFile: "/tmp/session-corrupt-completion.jsonl",
      sessionLabel: "corrupt-completion.jsonl",
      chatId: 4545,
      userId: 45,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = "This output must not be sent.";
    route.notification.lastTurnId = "turn-corrupt";
    await writeFile(join(config.stateDir, "state.json"), "{not-json", "utf8");
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendDocumentData: async () => sent.push("document"),
    };

    await runtime.notifyTurnCompleted(route, "completed");

    expect(sent).toEqual([]);
  });

  it("lists private-paired sessions for bot-authored addressed Telegram group commands without stale keyboards", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    (runtime as any).setupCache = { botId: 123456, botUsername: "mini_builder_bot", botDisplayName: "Mini Builder", validatedAt: new Date().toISOString() };
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-group-list:/tmp/session-group-list.jsonl",
      sessionId: "session-group-list",
      sessionFile: "/tmp/session-group-list.jsonl",
      sessionLabel: "group-list.jsonl",
      chatId: 2020,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: Array<{ chatId: number; text: string }> = [];
    const keyboardSends: Array<{ chatId: number; text: string }> = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (chatId: number, text: string) => keyboardSends.push({ chatId, text }),
      sendPlainText: async (chatId: number, text: string) => sent.push({ chatId, text }),
    };

    await (runtime as any).processInbound({ updateId: 50, messageId: 50, text: "/sessions@mini_builder_bot", chat: { id: -1001, type: "supergroup" }, user: { id: 42, username: "peer_machine_bot", isBot: true } });

    expect(sent).toHaveLength(1);
    expect(keyboardSends).toHaveLength(0);
    expect(sent[0]).toMatchObject({ chatId: -1001 });
    expect(sent[0]?.text).toContain("group-list.jsonl");
  });

  it("keeps unpaired and non-target Telegram group shared-room commands conservative", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    (runtime as any).setupCache = { botId: 123456, botUsername: "mini_builder_bot", botDisplayName: "Mini Builder", validatedAt: new Date().toISOString() };
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-group-silent:/tmp/session-group-silent.jsonl",
      sessionId: "session-group-silent",
      sessionFile: "/tmp/session-group-silent.jsonl",
      sessionLabel: "group-silent.jsonl",
      chatId: 2021,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({ updateId: 51, messageId: 51, text: "/sessions@other_bot", chat: { id: -1001, type: "supergroup" }, user: { id: 42, username: "owner" } });
    await (runtime as any).processInbound({ updateId: 52, messageId: 52, text: "/sessions", chat: { id: -1001, type: "supergroup" }, user: { id: 42, username: "owner" } });
    await (runtime as any).processInbound({ updateId: 53, messageId: 53, text: "/sessions@mini_builder_bot", chat: { id: -1001, type: "supergroup" }, user: { id: 99, username: "stranger" } });
    await (runtime as any).processInbound({ updateId: 54, messageId: 54, text: "/sessions@mini_builder_bot", chat: { id: -1001, type: "supergroup" }, user: { id: 123456, username: "mini_builder_bot", isBot: true } });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Pair with this bot in a private Telegram chat");
  });

  it("enforces the Telegram allow-list for group shared-room commands", async () => {
    const config = await createRuntimeConfig();
    config.allowUserIds = [7];
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    (runtime as any).setupCache = { botId: 123456, botUsername: "mini_builder_bot", botDisplayName: "Mini Builder", validatedAt: new Date().toISOString() };
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-group-allow-list:/tmp/session-group-allow-list.jsonl",
      sessionId: "session-group-allow-list",
      sessionFile: "/tmp/session-group-allow-list.jsonl",
      sessionLabel: "group-allow-list.jsonl",
      chatId: 2022,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route, deliveries } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({ updateId: 57, messageId: 57, text: "/to@mini_builder_bot group-allow-list.jsonl ship it", chat: { id: -1001, type: "supergroup" }, user: { id: 42, username: "owner" } });

    expect(sent).toEqual(["Unauthorized Telegram identity for this Pi session."]);
    expect(deliveries).toHaveLength(0);
  });

  it("keeps Telegram group active selection separate from the private chat binding", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    (runtime as any).setupCache = { botId: 123456, botUsername: "mini_builder_bot", botDisplayName: "Mini Builder", validatedAt: new Date().toISOString() };
    const firstBinding: TelegramBindingMetadata = {
      sessionKey: "session-group-use-1:/tmp/session-group-use-1.jsonl",
      sessionId: "session-group-use-1",
      sessionFile: "/tmp/session-group-use-1.jsonl",
      sessionLabel: "first-group.jsonl",
      chatId: 2030,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const secondBinding: TelegramBindingMetadata = {
      sessionKey: "session-group-use-2:/tmp/session-group-use-2.jsonl",
      sessionId: "session-group-use-2",
      sessionFile: "/tmp/session-group-use-2.jsonl",
      sessionLabel: "second-group.jsonl",
      alias: "phone",
      chatId: 2030,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const first = createRoute(firstBinding, true);
    const second = createRoute(secondBinding, true);
    await store.upsertBinding(firstBinding);
    await store.upsertBinding(secondBinding);
    (runtime as any).routes.set(first.route.sessionKey, first.route);
    (runtime as any).routes.set(second.route.sessionKey, second.route);
    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
    };

    await (runtime as any).processInbound({ updateId: 54, messageId: 54, text: "/use@mini_builder_bot phone", chat: { id: -1002, type: "supergroup" }, user: { id: 42, username: "owner" } });
    await (runtime as any).processInbound({ updateId: 55, messageId: 55, text: "private prompt", chat: { id: 2030, type: "private" }, user: { id: 42, username: "owner" } });

    expect(await store.getActiveChannelSelection("telegram", "-1002", "42")).toMatchObject({ sessionKey: second.route.sessionKey });
    expect((await store.getBindingBySessionKey(second.route.sessionKey))?.chatId).toBe(2030);
    expect(first.deliveries).toContainEqual({ text: "private prompt", deliverAs: undefined });
    expect(second.deliveries).toHaveLength(0);
  });

  it("routes Telegram group /to@bot prompts and outputs through private-pairing authorization", async () => {
    vi.useFakeTimers();
    const config = await createRuntimeConfig();
    config.progressIntervalMs = 1;
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    (runtime as any).setupCache = { botId: 123456, botUsername: "mini_builder_bot", botDisplayName: "Mini Builder", validatedAt: new Date().toISOString() };
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-group-to:/tmp/session-group-to.jsonl",
      sessionId: "session-group-to",
      sessionFile: "/tmp/session-group-to.jsonl",
      sessionLabel: "target-group.jsonl",
      chatId: 2040,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route, deliveries } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: Array<{ chatId: number; text: string }> = [];
    const actions: Array<{ chatId: number; action: string }> = [];
    (runtime as any).api = {
      sendPlainText: async (chatId: number, text: string) => sent.push({ chatId, text }),
      sendPlainTextWithKeyboard: async (chatId: number, text: string) => sent.push({ chatId, text }),
      sendChatAction: async (chatId: number, action: string) => actions.push({ chatId, action }),
    };

    await (runtime as any).processInbound({ updateId: 56, messageId: 56, text: "/to@mini_builder_bot target-group.jsonl ship it", chat: { id: -1003, type: "supergroup" }, user: { id: 42, username: "owner" } });

    expect(deliveries).toEqual([{ text: "ship it", deliverAs: undefined }]);
    expect(actions).toContainEqual({ chatId: -1003, action: "typing" });
    expect(sent).toContainEqual({ chatId: -1003, text: "Prompt delivered to Pi." });
    expect(sent).not.toContainEqual(expect.objectContaining({ chatId: 2040 }));

    sent.length = 0;
    route.notification.lastStatus = "running";
    route.notification.progressEvent = createProgressActivity({ id: "shared-progress", kind: "tool", text: "Running shared prompt", at: Date.now() }, config);
    (runtime as any).syncProgressDelivery(route);
    await vi.runOnlyPendingTimersAsync();

    await vi.waitFor(() => expect(sent.at(-1)).toMatchObject({ chatId: -1003, text: expect.stringContaining("Running shared prompt") }));

    sent.length = 0;
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = "Shared prompt finished successfully.";
    await runtime.notifyTurnCompleted(route, "completed");

    expect(sent.at(-1)).toMatchObject({ chatId: -1003, text: expect.stringContaining("Shared prompt finished successfully") });
    expect(sent).not.toContainEqual(expect.objectContaining({ chatId: 2040 }));
  });

  it("rolls back Telegram shared-room output destinations when delivery becomes unavailable", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    (runtime as any).setupCache = { botId: 123456, botUsername: "mini_builder_bot", botDisplayName: "Mini Builder", validatedAt: new Date().toISOString() };
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-group-unavailable:/tmp/session-group-unavailable.jsonl",
      sessionId: "session-group-unavailable",
      sessionFile: "/tmp/session-group-unavailable.jsonl",
      sessionLabel: "group-unavailable.jsonl",
      chatId: 2041,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    route.actions.sendUserMessage = () => { throw routeUnavailableError(); };
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: Array<{ chatId: number; text: string }> = [];
    (runtime as any).api = {
      sendPlainText: async (chatId: number, text: string) => sent.push({ chatId, text }),
      sendPlainTextWithKeyboard: async (chatId: number, text: string) => sent.push({ chatId, text }),
      sendChatAction: async () => undefined,
    };

    await (runtime as any).processInbound({ updateId: 58, messageId: 58, text: "/to@mini_builder_bot group-unavailable.jsonl ship it", chat: { id: -1005, type: "supergroup" }, user: { id: 42, username: "owner" } });

    expect(sent).toContainEqual({ chatId: -1005, text: "The Pi session is unavailable. Resume it locally, then try again." });
    route.notification.lastStatus = "completed";
    route.notification.lastAssistantText = "Later private output.";
    await runtime.notifyTurnCompleted(route, "completed");
    expect(sent).toContainEqual(expect.objectContaining({ chatId: 2041, text: expect.stringContaining("Later private output") }));
    expect(sent).not.toContainEqual(expect.objectContaining({ chatId: -1005, text: expect.stringContaining("Later private output") }));
  });

  it("uses Telegram shared-room output destinations for direct bound-chat sends", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-group-fallback:/tmp/session-group-fallback.jsonl",
      sessionId: "session-group-fallback",
      sessionFile: "/tmp/session-group-fallback.jsonl",
      sessionLabel: "group-fallback.jsonl",
      chatId: 2050,
      userId: 42,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    (runtime as any).routes.set(route.sessionKey, route);
    (runtime as any).setSharedRoomOutputDestination(route, { chatId: -1004, userId: 42 });
    const sent: Array<{ chatId: number; text: string }> = [];
    (runtime as any).api = {
      sendPlainTextWithKeyboard: async (chatId: number, text: string) => sent.push({ chatId, text }),
    };

    await runtime.sendToBoundChat(route.sessionKey, "Fallback output");

    expect(sent).toEqual([{ chatId: -1004, text: expect.stringContaining("Fallback output") }]);
    expect(sent).not.toContainEqual(expect.objectContaining({ chatId: 2050 }));
  });

  it("coalesces rate-limited progress updates and respects quiet mode", async () => {
    vi.useFakeTimers();
    const config = await createRuntimeConfig();
    config.progressIntervalMs = 1_000;
    config.verboseProgressIntervalMs = 100;
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-progress:/tmp/session-progress.jsonl",
      sessionId: "session-progress",
      sessionFile: "/tmp/session-progress.jsonl",
      sessionLabel: "session-progress.jsonl",
      chatId: 1007,
      userId: 27,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      progressMode: "verbose",
    };
    const { route } = createRoute(binding, false);
    route.notification.lastStatus = "running";
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    (runtime as any).api = { sendPlainText: async (_chatId: number, text: string) => sent.push(text) };

    route.notification.progressEvent = createProgressActivity({ id: "p1", kind: "tool", text: "Running tests", at: Date.now() }, config);
    (runtime as any).syncProgressDelivery(route);
    route.notification.progressEvent = createProgressActivity({ id: "p2", kind: "tool", text: "Running tests", at: Date.now() }, config);
    (runtime as any).syncProgressDelivery(route);
    await vi.runOnlyPendingTimersAsync();

    await vi.waitFor(() => expect(sent[0]).toContain("Running tests (2×)"));
    expect(route.notification.recentActivity).toHaveLength(2);

    sent.length = 0;
    binding.progressMode = "quiet";
    route.notification.progressEvent = createProgressActivity({ id: "p3", kind: "tool", text: "Editing files", at: Date.now() }, config);
    (runtime as any).syncProgressDelivery(route);
    await vi.runOnlyPendingTimersAsync();
    expect(sent).toEqual([]);
  });

  it("sends requester-scoped workspace files from Telegram remote commands", async () => {
    const config = await createRuntimeConfig();
    const root = await mkdtemp(join(tmpdir(), "pirelay-telegram-remote-file-"));
    tempDirs.push(root);
    await writeFile(join(root, "report.md"), "# Report\n");
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-send-file:/tmp/session-send-file.jsonl",
      sessionId: "session-send-file",
      sessionFile: "/tmp/session-send-file.jsonl",
      sessionLabel: "session-send-file.jsonl",
      chatId: 1007,
      userId: 27,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    (route.actions.context as { cwd: string }).cwd = root;
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const documents: Array<{ filename: string; caption?: string; text: string }> = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendPlainTextWithKeyboard: async (_chatId: number, text: string) => sent.push(text),
      sendDocumentData: async (_chatId: number, filename: string, data: Uint8Array, caption?: string) => documents.push({ filename, caption, text: Buffer.from(data).toString("utf8") }),
      answerCallbackQuery: async () => undefined,
      sendChatAction: async () => undefined,
    };

    await (runtime as any).processInbound({
      updateId: 25,
      messageId: 25,
      text: "/send-file report.md Monthly report",
      chat: { id: 1007, type: "private" },
      user: { id: 27, username: "owner" },
    });
    await (runtime as any).processInbound({
      updateId: 26,
      messageId: 26,
      text: "/send-file ../secret.md",
      chat: { id: 1007, type: "private" },
      user: { id: 27, username: "owner" },
    });

    expect(documents).toEqual([{ filename: "report.md", caption: "Monthly report", text: "# Report\n" }]);
    expect(sent.at(-1)).toContain("traversal");
    expect(route.remoteRequester).toMatchObject({ channel: "telegram", conversationId: "1007", userId: "27", sessionKey: route.sessionKey });
  });

  it("sends explicit workspace image paths and explains empty latest image states", async () => {
    const config = await createRuntimeConfig();
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding: TelegramBindingMetadata = {
      sessionKey: "session-send-image:/tmp/session-send-image.jsonl",
      sessionId: "session-send-image",
      sessionFile: "/tmp/session-send-image.jsonl",
      sessionLabel: "session-send-image.jsonl",
      chatId: 1006,
      userId: 26,
      username: "owner",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const { route } = createRoute(binding, true);
    const image = {
      id: "turn-file-1",
      turnId: "turn-file",
      fileName: "render.png",
      mimeType: "image/png",
      data: Buffer.from([1, 2, 3]).toString("base64"),
      byteSize: 3,
    };
    route.actions.getImageByPath = async (path) => path === "outputs/render.png"
      ? { ok: true, image }
      : { ok: false, error: "Image file not found: missing.png" };
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);
    const sent: string[] = [];
    const images: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendImageDocument: async (_chatId: number, sentImage: { fileName: string }) => images.push(sentImage.fileName),
    };

    await (runtime as any).processInbound({
      updateId: 22,
      messageId: 22,
      text: "/images",
      chat: { id: 1006, type: "private" },
      user: { id: 26, username: "owner" },
    });
    await (runtime as any).processInbound({
      updateId: 23,
      messageId: 23,
      text: "/send-image outputs/render.png",
      chat: { id: 1006, type: "private" },
      user: { id: 26, username: "owner" },
    });
    await (runtime as any).processInbound({
      updateId: 24,
      messageId: 24,
      text: "/send-image missing.png",
      chat: { id: 1006, type: "private" },
      user: { id: 26, username: "owner" },
    });

    expect(sent[0]).toContain("safe workspace image files mentioned");
    expect(images).toEqual(["render.png"]);
    expect(sent).toContain("Image file not found: missing.png");
  });
});
