import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractStructuredAnswerMetadata } from "../extensions/telegram-tunnel/answer-workflow.js";
import { buildAnswerCustomCallbackData, buildAnswerOptionCallbackData, buildFullChatCallbackData, buildFullMarkdownCallbackData, buildFullOutputKeyboard, buildLatestImagesCallbackData } from "../extensions/telegram-tunnel/telegram-actions.js";
import { InProcessTunnelRuntime } from "../extensions/telegram-tunnel/runtime.js";
import { TunnelStateStore } from "../extensions/telegram-tunnel/state-store.js";
import type { SessionRoute, TelegramBindingMetadata, TelegramPromptContent, TelegramTunnelConfig } from "../extensions/telegram-tunnel/types.js";

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

function createRoute(binding: TelegramBindingMetadata, idle = true) {
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
      promptLocalConfirmation: async () => true,
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
    expect(actions).toEqual(["typing", "typing"]);

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
