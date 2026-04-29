import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractStructuredAnswerMetadata } from "../extensions/telegram-tunnel/answer-workflow.js";
import { InProcessTunnelRuntime } from "../extensions/telegram-tunnel/runtime.js";
import { TunnelStateStore } from "../extensions/telegram-tunnel/state-store.js";
import type { SessionRoute, TelegramBindingMetadata, TelegramTunnelConfig } from "../extensions/telegram-tunnel/types.js";

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
  };
}

function createRoute(binding: TelegramBindingMetadata, idle = true) {
  const deliveries: Array<{ text: string; deliverAs?: "followUp" | "steer" }> = [];
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
});
