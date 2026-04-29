import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InProcessTunnelRuntime } from "../extensions/telegram-tunnel/runtime.js";
import { TunnelStateStore } from "../extensions/telegram-tunnel/state-store.js";
import type { SessionRoute, TelegramBindingMetadata, TelegramTunnelConfig } from "../extensions/telegram-tunnel/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
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

  it("routes idle Telegram text as a normal Pi prompt", async () => {
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
    (runtime as any).api = { sendPlainText: async () => undefined };

    await (runtime as any).processInbound({
      updateId: 2,
      messageId: 2,
      text: "please summarize the branch",
      chat: { id: 555, type: "private" },
      user: { id: 7, username: "owner" },
    });

    expect(deliveries).toEqual([{ text: "please summarize the branch", deliverAs: undefined }]);
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
    (runtime as any).api = { sendPlainText: async () => undefined };

    await (runtime as any).processInbound({
      updateId: 3,
      messageId: 3,
      text: "continue with the test cleanup",
      chat: { id: 777, type: "private" },
      user: { id: 9, username: "owner" },
    });

    expect(deliveries).toEqual([{ text: "continue with the test cleanup", deliverAs: "followUp" }]);
  });
});
