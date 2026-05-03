import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TunnelStateStore } from "../../extensions/relay/state/tunnel-store.js";
import { sessionKeyOf } from "../../extensions/relay/core/utils.js";
import type { TelegramBindingMetadata, TelegramTunnelConfig, TunnelRuntime } from "../../extensions/relay/core/types.js";

const tempDirs: string[] = [];

async function config(): Promise<TelegramTunnelConfig> {
  const stateDir = await mkdtemp(join(tmpdir(), "pirelay-local-disconnect-"));
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

function binding(sessionId: string, sessionFile: string): TelegramBindingMetadata {
  return {
    sessionKey: sessionKeyOf(sessionId, sessionFile),
    sessionId,
    sessionFile,
    sessionLabel: `${sessionId}.jsonl`,
    chatId: 7001,
    userId: 9001,
    username: "owner",
    boundAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

function mockContext(sessionId: string) {
  const notifications: Array<{ message: string; level?: string }> = [];
  const statuses: Array<{ key: string; value: string }> = [];
  const sessionFile = `/tmp/${sessionId}.jsonl`;
  return {
    notifications,
    statuses,
    context: {
      ui: {
        notify: vi.fn((message: string, level?: string) => notifications.push({ message, level })),
        setStatus: vi.fn((key: string, value: string) => statuses.push({ key, value })),
        setWidget: vi.fn(),
      },
      hasUI: false,
      cwd: process.cwd(),
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionFile: () => sessionFile,
        getSessionName: () => `${sessionId}.jsonl`,
        getBranch: () => [],
      },
      model: undefined,
      isIdle: () => true,
      abort: vi.fn(),
      compact: vi.fn(),
    } as never,
  };
}

function mockPi() {
  const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> | void }>();
  return {
    commands,
    api: {
      registerCommand: vi.fn((name: string, definition: { handler: (args: string, ctx: never) => Promise<void> | void }) => commands.set(name, definition)),
      registerMessageRenderer: vi.fn(),
      on: vi.fn(),
      sendMessage: vi.fn(),
      appendEntry: vi.fn(),
      sendUserMessage: vi.fn(),
    },
    async runCommand(name: string, args: string, ctx: never): Promise<void> {
      const command = commands.get(name);
      if (!command) throw new Error(`Unknown command: ${name}`);
      await command.handler(args, ctx);
    },
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.doUnmock("../../extensions/relay/adapters/telegram/runtime.js");
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("local relay disconnect", () => {
  it("uses messenger-neutral wording and revokes channel bindings", async () => {
    const cfg = await config();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", cfg.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", cfg.stateDir);
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    vi.doMock("../../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const sessionId = "disconnect-session";
    const sessionFile = `/tmp/${sessionId}.jsonl`;
    const sessionKey = sessionKeyOf(sessionId, sessionFile);
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertBinding(binding(sessionId, sessionFile));
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey,
      sessionId,
      sessionFile,
      sessionLabel: `${sessionId}.jsonl`,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    const { default: relayExtension } = await import("../../extensions/relay/index.js");
    const pi = mockPi();
    const { context, notifications, statuses } = mockContext(sessionId);
    relayExtension(pi.api as never);
    await pi.runCommand("relay", "disconnect", context);

    expect(notifications.at(-1)?.message).toBe("PiRelay disconnected for this session.");
    expect(notifications.map((entry) => entry.message).join("\n")).not.toContain("Telegram tunnel disconnected");
    expect(statuses).toContainEqual({ key: "relay", value: "relay: disconnected" });
    expect(fakeRuntime.unregisterRoute).toHaveBeenCalledWith(sessionKey);
    expect(await store.getBindingBySessionKey(sessionKey)).toMatchObject({ status: "revoked" });
    expect(await store.getChannelBindingBySessionKey("discord", sessionKey)).toBeUndefined();
  });
});
