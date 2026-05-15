import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrokerTunnelRuntime } from "../extensions/relay/broker/tunnel-runtime.js";
import { InProcessTunnelRuntime } from "../extensions/relay/adapters/telegram/runtime.js";
import { TunnelStateStore } from "../extensions/relay/state/tunnel-store.js";
import { sessionKeyOf } from "../extensions/relay/core/utils.js";
import type { DiscordGatewayEvent, DiscordSendFilePayload, DiscordSendMessagePayload } from "../extensions/relay/adapters/discord/adapter.js";
import type { SessionRoute, TelegramBindingMetadata, TelegramPromptContent, TelegramTunnelConfig, TunnelRuntime } from "../extensions/relay/core/types.js";

const tempDirs: string[] = [];
const STALE_EXTENSION_ERROR = "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().";

beforeEach(() => {
  for (const name of [
    "PI_RELAY_SLACK_BOT_TOKEN",
    "PI_RELAY_SLACK_SIGNING_SECRET",
    "PI_RELAY_SLACK_APP_TOKEN",
    "PI_RELAY_SLACK_APP_ID",
    "PI_RELAY_SLACK_EVENT_MODE",
    "PI_RELAY_SLACK_WORKSPACE_ID",
    "PI_RELAY_SLACK_BOT_USER_ID",
    "PI_RELAY_SLACK_ALLOW_USER_IDS",
    "PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES",
  ]) vi.stubEnv(name, undefined);
});

async function flushAsyncActions(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function createRuntimeConfig(prefix = "pi-telegram-integration-"): Promise<TelegramTunnelConfig> {
  const stateDir = await mkdtemp(join(tmpdir(), prefix));
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

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock("../extensions/relay/adapters/telegram/runtime.js");
  vi.doUnmock("../extensions/relay/adapters/discord/runtime.js");
  vi.doUnmock("../extensions/relay/adapters/slack/runtime.js");
  vi.doUnmock("../extensions/relay/adapters/discord/live-client.js");
  vi.doUnmock("../extensions/relay/ui/clipboard.js");
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })));
});

function createBinding(id: string, chatId = 555, userId = 42): TelegramBindingMetadata {
  return {
    sessionKey: `${id}:/tmp/${id}.jsonl`,
    sessionId: id,
    sessionFile: `/tmp/${id}.jsonl`,
    sessionLabel: `${id}.jsonl`,
    chatId,
    userId,
    username: "owner",
    boundAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

function createRoute(binding: TelegramBindingMetadata, idle = true) {
  const deliveries: Array<{ text: TelegramPromptContent; deliverAs?: "followUp" | "steer" }> = [];
  const audits: string[] = [];
  const persisted: Array<{ binding: TelegramBindingMetadata | null; revoked?: boolean }> = [];
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
          getBranch: () => [],
        },
        modelRegistry: {} as never,
        model: undefined,
        isIdle: () => currentIdle,
        abort: () => undefined,
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
      appendAudit: (message) => audits.push(message),
      persistBinding: (nextBinding, revoked) => persisted.push({ binding: nextBinding, revoked }),
      promptLocalConfirmation: async () => true,
      abort: () => undefined,
      compact: async () => undefined,
    },
  };

  return {
    route,
    deliveries,
    audits,
    persisted,
    setIdle(value: boolean) {
      currentIdle = value;
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for integration test condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createMockContext(sessionId = "local-session") {
  let idle = true;
  const branch: any[] = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const statuses: Array<{ key: string; value: string }> = [];
  const theme = { fg: (_name: string, text: string) => text };
  const context = {
    ui: {
      notify: vi.fn((message: string, level?: string) => notifications.push({ message, level })),
      select: vi.fn(async () => undefined),
      confirm: vi.fn(async () => true),
      input: vi.fn(async () => undefined),
      onTerminalInput: vi.fn(() => () => undefined),
      setStatus: vi.fn((key: string, value: string) => statuses.push({ key, value })),
      setWorkingMessage: vi.fn(),
      setWidget: vi.fn(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      setTitle: vi.fn(),
      custom: vi.fn(async (factory: (...args: any[]) => { render?: (width: number) => string[] } | undefined) => {
        let resolveDone!: (value: unknown) => void;
        const donePromise = new Promise((resolve) => {
          resolveDone = resolve;
        });
        const screen = factory({}, theme, {}, resolveDone);
        screen?.render?.(88);
        resolveDone(undefined);
        await donePromise;
      }),
      pasteToEditor: vi.fn(),
      setEditorText: vi.fn(),
      getEditorText: vi.fn(() => ""),
      editor: vi.fn(async () => undefined),
      setEditorComponent: vi.fn(),
    },
    hasUI: true,
    cwd: process.cwd(),
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/tmp/${sessionId}.jsonl`,
      getSessionName: () => `${sessionId}.jsonl`,
      getBranch: () => branch,
    },
    modelRegistry: {} as never,
    model: undefined,
    isIdle: () => idle,
    abort: vi.fn(),
    hasPendingMessages: () => false,
    shutdown: vi.fn(),
    getContextUsage: () => undefined,
    compact: vi.fn(({ onComplete }: { onComplete?: () => void } = {}) => onComplete?.()),
    getSystemPrompt: () => "",
  } as any;

  return {
    context,
    branch,
    notifications,
    statuses,
    setIdle(value: boolean) {
      idle = value;
    },
  };
}

class IntegrationDiscordOperations {
  handler?: (event: DiscordGatewayEvent) => Promise<void>;
  readonly messages: DiscordSendMessagePayload[] = [];
  readonly files: DiscordSendFilePayload[] = [];
  readonly typing: string[] = [];

  async connect(handler: (event: DiscordGatewayEvent) => Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async disconnect(): Promise<void> {
    this.handler = undefined;
  }

  async sendMessage(payload: DiscordSendMessagePayload): Promise<void> {
    this.messages.push(payload);
  }

  async sendFile(payload: DiscordSendFilePayload): Promise<void> {
    this.files.push(payload);
  }

  async sendTyping(channelId: string): Promise<void> {
    this.typing.push(channelId);
  }

  async answerInteraction(): Promise<void> {}
}

function integrationDiscordMessage(content: string, options: { id?: string; userId?: string; channelId?: string; guildId?: string; bot?: boolean } = {}): DiscordGatewayEvent {
  return {
    type: "message",
    payload: {
      id: options.id ?? `discord-${Math.random()}`,
      channel_id: options.channelId ?? "dm1",
      guild_id: options.guildId,
      content,
      author: { id: options.userId ?? "u1", username: "zikolach", bot: options.bot ?? false },
      attachments: [],
    },
  };
}

function createMockPi() {
  const commands = new Map<string, { handler: (args: string, ctx: any) => void | Promise<void> }>();
  const tools = new Map<string, { execute: (toolCallId: string, params: any) => Promise<any> | any }>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => void | Promise<void>>>();
  const injectedMessages: Array<{ text: string; options?: { deliverAs?: "followUp" | "steer" } }> = [];
  const localPrompts: string[] = [];
  const sentMessages: any[] = [];
  const appendedEntries: any[] = [];
  const skillInvocations: string[] = [];

  const api = {
    registerCommand: vi.fn((name: string, definition: { handler: (args: string, ctx: any) => void | Promise<void> }) => {
      commands.set(name, definition);
    }),
    registerTool: vi.fn((definition: { name: string; execute: (toolCallId: string, params: any) => Promise<any> | any }) => {
      tools.set(definition.name, definition);
    }),
    registerMessageRenderer: vi.fn(),
    on: vi.fn((event: string, handler: (payload: any, ctx: any) => void | Promise<void>) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    sendUserMessage: vi.fn((text: string, options?: { deliverAs?: "followUp" | "steer" }) => {
      injectedMessages.push({ text, options });
    }),
    sendMessage: vi.fn((message: any) => sentMessages.push(message)),
    appendEntry: vi.fn((customType: string, data: any) => {
      const entry = { type: "custom", customType, data };
      appendedEntries.push(entry);
    }),
  };

  commands.set("skill:relay", {
    handler: async () => {
      skillInvocations.push("relay");
    },
  });

  return {
    api,
    commands,
    tools,
    injectedMessages,
    localPrompts,
    sentMessages,
    appendedEntries,
    skillInvocations,
    async runCommand(name: string, args: string, ctx: any) {
      const command = commands.get(name);
      if (!command) throw new Error(`Unknown command: ${name}`);
      await command.handler(args, ctx);
    },
    async emit(event: string, payload: any, ctx: any) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload, ctx);
      }
    },
    async submitLocalPrompt(text: string, ctx: any) {
      localPrompts.push(text);
      await this.emit("agent_start", {}, ctx);
    },
  };
}

describe("PiRelay integration behavior", () => {
  it("keeps Telegram local commands compatible while exposing relay aliases", async () => {
    const config = await createRuntimeConfig("pi-telegram-relay-alias-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("relay-alias-session");
    relayExtension(pi.api as any);

    expect(pi.commands.has("telegram-tunnel")).toBe(false);
    expect(pi.commands.has("relay")).toBe(true);

    await pi.runCommand("relay", "setup telegram", context);

    expect(fakeRuntime.ensureSetup).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.start).toHaveBeenCalledTimes(1);
    expect(notifications.filter((entry) => entry.message.includes("Telegram bot ready"))).toHaveLength(1);
  });

  it("shows Telegram runtime errors instead of paired/ready state", async () => {
    const config = await createRuntimeConfig("pi-telegram-runtime-error-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);

    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async () => {
        throw new Error("broker unavailable");
      }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, statuses } = createMockContext("telegram-runtime-error");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "status", context);

    expect(statuses).toContainEqual({ key: "relay-sync", value: "telegram sync error: broker unavailable" });
    expect(statuses).toContainEqual({ key: "relay", value: "telegram error: broker unavailable" });
    expect(statuses).not.toContainEqual({ key: "relay", value: "telegram: ready unpaired" });
  });

  it("sends Telegram lifecycle notifications for offline, restored, and disconnect events", async () => {
    const config = await createRuntimeConfig("pi-lifecycle-telegram-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const sessionId = "lifecycle-session";
    const sessionFile = `/tmp/${sessionId}.jsonl`;
    const binding = createBinding(sessionId, 555, 42);
    binding.sessionFile = sessionFile;
    binding.sessionKey = sessionKeyOf(sessionId, sessionFile);
    binding.sessionLabel = "Docs";
    await new TunnelStateStore(config.stateDir).upsertBinding(binding);

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
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.emit("session_start", {}, context);
    expect(fakeRuntime.sendToBoundChat).not.toHaveBeenCalled();

    await pi.emit("session_shutdown", {}, context);
    expect(fakeRuntime.sendToBoundChat).toHaveBeenCalledWith(binding.sessionKey, expect.stringContaining("went offline locally"));
    expect(fakeRuntime.unregisterRoute).toHaveBeenCalledWith(binding.sessionKey);

    await pi.emit("session_start", {}, context);
    expect(fakeRuntime.sendToBoundChat).toHaveBeenCalledWith(binding.sessionKey, expect.stringContaining("back online"));

    await pi.runCommand("relay", "disconnect", context);
    expect(fakeRuntime.sendToBoundChat).toHaveBeenCalledWith(binding.sessionKey, expect.stringContaining("disconnected locally"));
  });

  it("does not mark restored binding online when Telegram registration fails", async () => {
    const config = await createRuntimeConfig("pi-lifecycle-startup-failure-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const sessionId = "lifecycle-startup-failure";
    const sessionFile = `/tmp/${sessionId}.jsonl`;
    const binding = createBinding(sessionId, 555, 42);
    binding.sessionFile = sessionFile;
    binding.sessionKey = sessionKeyOf(sessionId, sessionFile);
    const store = new TunnelStateStore(config.stateDir);
    await store.upsertBinding(binding);
    await store.recordLifecycleNotification({ channel: "telegram", sessionKey: binding.sessionKey, conversationId: String(binding.chatId), userId: String(binding.userId), kind: "offline", nowIso: "2026-05-12T10:00:00.000Z" });
    await store.markLifecycleNotificationDelivered({ channel: "telegram", sessionKey: binding.sessionKey, conversationId: String(binding.chatId), userId: String(binding.userId), kind: "offline", deliveredAt: "2026-05-12T10:00:00.000Z" });

    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async () => { throw new Error("broker unavailable"); }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, statuses } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.emit("session_start", {}, context);

    expect(fakeRuntime.sendToBoundChat).not.toHaveBeenCalled();
    expect(statuses).toContainEqual({ key: "relay-sync", value: "telegram sync error: broker unavailable" });
    const lifecycleRecord = Object.values((await store.load()).lifecycleNotifications)[0];
    expect(lifecycleRecord).toMatchObject({ state: "offline", lastEvent: "offline" });
  });

  it("time-boxes lifecycle notifications during shutdown", async () => {
    vi.useFakeTimers();
    const config = await createRuntimeConfig("pi-lifecycle-shutdown-timeout-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const sessionId = "lifecycle-shutdown-timeout";
    const sessionFile = `/tmp/${sessionId}.jsonl`;
    const binding = createBinding(sessionId, 555, 42);
    binding.sessionFile = sessionFile;
    binding.sessionKey = sessionKeyOf(sessionId, sessionFile);
    await new TunnelStateStore(config.stateDir).upsertBinding(binding);

    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(() => new Promise<void>(() => undefined)),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, statuses } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.emit("session_start", {}, context);
    const shutdown = pi.emit("session_shutdown", {}, context);
    await vi.advanceTimersByTimeAsync(3_000);
    await shutdown;

    expect(fakeRuntime.unregisterRoute).toHaveBeenCalledWith(binding.sessionKey);
    expect(statuses).toContainEqual({ key: "relay-lifecycle", value: "relay lifecycle warning: lifecycle notification timed out" });
  });

  it("unregisters Discord routes on session shutdown", async () => {
    const config = await createRuntimeConfig("pi-discord-shutdown-unregister-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-token-test");
    const sessionId = "discord-shutdown";
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
    const fakeDiscordRuntime = {
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: true })),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/discord/runtime.js", () => ({
      getOrCreateDiscordRuntime: () => fakeDiscordRuntime,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.emit("session_start", {}, context);
    const registerCall = fakeDiscordRuntime.registerRoute.mock.calls.at(-1) as unknown[] | undefined;
    const registeredRoute = registerCall?.[0] as SessionRoute;
    await pi.emit("session_shutdown", {}, context);

    expect(fakeDiscordRuntime.unregisterRoute).toHaveBeenCalledWith(registeredRoute.sessionKey);
  });

  it("keeps lifecycle notification failures nonfatal", async () => {
    const config = await createRuntimeConfig("pi-lifecycle-failure-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const sessionId = "lifecycle-failure";
    const sessionFile = `/tmp/${sessionId}.jsonl`;
    const binding = createBinding(sessionId, 555, 42);
    binding.sessionFile = sessionFile;
    binding.sessionKey = sessionKeyOf(sessionId, sessionFile);
    await new TunnelStateStore(config.stateDir).upsertBinding(binding);

    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => { throw new Error("network down"); }),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, statuses } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.emit("session_start", {}, context);
    await pi.emit("session_shutdown", {}, context);

    expect(fakeRuntime.unregisterRoute).toHaveBeenCalledWith(binding.sessionKey);
    expect(statuses).toContainEqual({ key: "relay-lifecycle", value: "relay lifecycle warning: network down" });
  });

  it("opens interactive setup wizard when UI is available", async () => {
    const config = await createRuntimeConfig("pi-setup-wizard-ui-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-token-test");
    vi.stubEnv("PI_RELAY_DISCORD_APPLICATION_ID", "123456789012345678");

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("setup-wizard-ui");
    const rendered: string[][] = [];
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { render?: (width: number) => string[] } | undefined) => {
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, () => undefined);
      rendered.push(screen?.render?.(100) ?? []);
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup discord", context);

    expect(context.ui.custom).toHaveBeenCalledTimes(1);
    const text = rendered.flat().join("\n");
    expect(text).toContain("Discord setup");
    expect(text).toContain("Application ID");
    expect(text).toContain("Readiness checks");
    expect(text).not.toContain("Checklist");
  });

  it("uses plain setup guidance without UI", async () => {
    const config = await createRuntimeConfig("pi-setup-wizard-headless-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-token-test");

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-wizard-headless");
    context.hasUI = false;
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup discord", context);

    expect(context.ui.custom).not.toHaveBeenCalled();
    expect(notifications.at(-1)?.message).toContain("Discord relay setup");
  });

  it("falls back to plain setup guidance when setup wizard rendering fails", async () => {
    const config = await createRuntimeConfig("pi-setup-wizard-fallback-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-token-test");

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-wizard-fallback");
    context.ui.custom = vi.fn(async () => {
      throw new Error("terminal broke");
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup discord", context);

    expect(notifications.some((entry) => entry.message.includes("Interactive setup wizard failed"))).toBe(true);
    expect(notifications.at(-1)?.message).toContain("Setup checklist:");
  });

  it("does not open setup wizard for unsupported setup channels", async () => {
    const config = await createRuntimeConfig("pi-setup-wizard-unsupported-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-wizard-unsupported");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup matrix", context);

    expect(context.ui.custom).not.toHaveBeenCalled();
    expect(notifications.at(-1)?.message).toContain("Unsupported relay channel");
  });

  it("copies setup env snippets to the clipboard across supported messengers", async () => {
    const config = await createRuntimeConfig("pi-setup-copy-env-");
    const clipboardTexts: string[] = [];
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.doMock("../extensions/relay/ui/clipboard.js", () => ({
      copyTextToClipboard: vi.fn(async (text: string) => {
        clipboardTexts.push(text);
        return { ok: true, command: "test-clipboard" };
      }),
    }));
    const fakeRuntime = {
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pirelay_bot", botDisplayName: "PiRelay" })),
      start: vi.fn(async () => undefined),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-copy-env");
    let closeCount = 0;
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        closeCount += 1;
        result = value;
      });
      screen?.handleInput?.("c");
      await flushAsyncActions();
      return result;
    });
    relayExtension(pi.api as any);

    for (const [channel, expectedEnv] of [["telegram", "PI_RELAY_TELEGRAM_BOT_TOKEN"], ["discord", "PI_RELAY_DISCORD_BOT_TOKEN"], ["slack", "PI_RELAY_SLACK_BOT_TOKEN"]] as const) {
      await pi.runCommand("relay", `setup ${channel}`, context);
      expect(clipboardTexts.at(-1)).toContain(expectedEnv);
    }
    expect(context.ui.setEditorText).not.toHaveBeenCalled();
    expect(closeCount).toBe(0);
    expect(notifications.at(-1)?.message).toContain("copied to clipboard");
  });

  it("copies the Slack app manifest without closing setup", async () => {
    const config = await createRuntimeConfig("pi-setup-copy-manifest-");
    const clipboardTexts: string[] = [];
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.doMock("../extensions/relay/ui/clipboard.js", () => ({
      copyTextToClipboard: vi.fn(async (text: string) => {
        clipboardTexts.push(text);
        return { ok: true, command: "test-clipboard" };
      }),
    }));
    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-copy-manifest");
    let closeCount = 0;
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        closeCount += 1;
        result = value;
      });
      screen?.handleInput?.("m");
      await flushAsyncActions();
      return result;
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup slack", context);

    expect(clipboardTexts.at(-1)).toContain("display_information:");
    expect(clipboardTexts.at(-1)).toContain("message.im");
    expect(clipboardTexts.at(-1)).toContain("messages_tab_enabled: true");
    expect(context.ui.setEditorText).not.toHaveBeenCalled();
    expect(closeCount).toBe(0);
    expect(notifications.at(-1)?.message).toContain("Slack app manifest copied to clipboard");
  });

  it("falls back to the editor when setup clipboard copy is unavailable", async () => {
    const config = await createRuntimeConfig("pi-setup-copy-fallback-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.doMock("../extensions/relay/ui/clipboard.js", () => ({
      copyTextToClipboard: vi.fn(async () => ({ ok: false, error: "no clipboard command available" })),
    }));
    const fakeRuntime = {
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pirelay_bot", botDisplayName: "PiRelay" })),
      start: vi.fn(async () => undefined),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-copy-fallback");
    let closeCount = 0;
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        closeCount += 1;
        result = value;
      });
      screen?.handleInput?.("c");
      await flushAsyncActions();
      return result;
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup telegram", context);

    expect(context.ui.setEditorText).toHaveBeenCalledWith(expect.stringContaining("PI_RELAY_TELEGRAM_BOT_TOKEN"));
    expect(closeCount).toBe(0);
    expect(notifications.at(-1)?.message).toContain("Clipboard copy is unavailable");
  });

  it("writes setup config from env without persisting resolved secrets", async () => {
    const config = await createRuntimeConfig("pi-setup-write-env-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "xoxb-secret-token");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "slack-signing-secret-value");
    vi.stubEnv("PI_RELAY_SLACK_APP_TOKEN", "xapp-secret-token");
    vi.stubEnv("PI_RELAY_SLACK_WORKSPACE_ID", "T1");

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-write-env");
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        result = value;
      });
      screen?.handleInput?.("w");
      return result;
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup slack", context);

    expect(context.ui.confirm).toHaveBeenCalledTimes(1);
    const written = await readFile(config.configPath!, "utf8");
    expect(written).toContain("PI_RELAY_SLACK_BOT_TOKEN");
    expect(written).toContain("PI_RELAY_SLACK_SIGNING_SECRET");
    expect(written).toContain("PI_RELAY_SLACK_APP_TOKEN");
    expect(written).toContain("T1");
    expect(written).not.toContain("xoxb-secret-token");
    expect(written).not.toContain("slack-signing-secret-value");
    expect(written).not.toContain("xapp-secret-token");
    expect(notifications.at(-1)?.message).toContain("Updated PiRelay slack config from environment variables");
  });

  it("stops active runtimes before reloading config written from env", async () => {
    const config = await createRuntimeConfig("pi-setup-write-stops-runtime-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.stubEnv("PI_RELAY_SLACK_ENABLED", "true");
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "xoxb-secret-token");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "slack-signing-secret-value");
    vi.stubEnv("PI_RELAY_SLACK_APP_TOKEN", "xapp-secret-token");
    vi.stubEnv("PI_RELAY_SLACK_WORKSPACE_ID", "T1");

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
    let slackStarted = false;
    const fakeSlackRuntime = {
      start: vi.fn(async () => { slackStarted = true; }),
      stop: vi.fn(async () => { slackStarted = false; }),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: slackStarted, appId: "A1", teamId: "T1" })),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/slack/runtime.js", () => ({
      getOrCreateSlackRuntime: () => fakeSlackRuntime,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, statuses } = createMockContext("setup-write-stops-runtime");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "connect slack", context);
    expect(fakeSlackRuntime.start).toHaveBeenCalledTimes(1);
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        result = value;
      });
      screen?.handleInput?.("w");
      return result;
    });

    await pi.runCommand("relay", "setup slack", context);

    expect(fakeSlackRuntime.stop).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.stop).toHaveBeenCalledTimes(1);
    expect(statuses).toContainEqual({ key: "relay", value: "telegram: starting" });
    expect(statuses).toContainEqual({ key: "slack-relay", value: "slack: starting" });
  });

  it("does not show Slack ready when required credentials are incomplete", async () => {
    const config = await createRuntimeConfig("pi-slack-incomplete-status-");
    await writeFile(config.configPath!, JSON.stringify({
      messengers: {
        telegram: { default: { botToken: config.botToken } },
        slack: { default: { enabled: true, botToken: "slack-default", eventMode: "socket" } },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
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
    const fakeSlackRuntime = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: true })),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/slack/runtime.js", () => ({
      getOrCreateSlackRuntime: () => fakeSlackRuntime,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, statuses } = createMockContext("slack-incomplete-status");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "status", context);

    expect(statuses).toContainEqual({ key: "slack-relay", value: "slack: off" });
  });

  it("scopes Slack status lines by configured instance", async () => {
    const config = await createRuntimeConfig("pi-slack-instance-status-");
    await writeFile(config.configPath!, JSON.stringify({
      messengers: {
        telegram: { default: { botToken: config.botToken } },
        slack: {
          default: { enabled: true, botToken: "slack-default", signingSecret: "secret-default", eventMode: "webhook" },
          beta: { enabled: true, botToken: "slack-beta", signingSecret: "secret-beta", eventMode: "webhook" },
        },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const sessionId = "slack-instance-status";
    const sessionFile = `/tmp/${sessionId}.jsonl`;
    const sessionKey = sessionKeyOf(sessionId, sessionFile);
    const store = new TunnelStateStore(config.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "beta", conversationId: "C_BETA", userId: "U_BETA", sessionKey, sessionId, sessionFile, sessionLabel: `${sessionId}.jsonl`, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { conversationKind: "channel" } });
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
    const slackRuntimes = new Map<string, { started: boolean; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; registerRoute: ReturnType<typeof vi.fn>; unregisterRoute: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> }>();
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/slack/runtime.js", () => ({
      getOrCreateSlackRuntime: (_config: TelegramTunnelConfig, _operations: unknown, instanceId = "default") => {
        let runtime = slackRuntimes.get(instanceId);
        if (!runtime) {
          runtime = {
            started: false,
            start: vi.fn(async () => { runtime!.started = true; }),
            stop: vi.fn(async () => { runtime!.started = false; }),
            registerRoute: vi.fn(async () => undefined),
            unregisterRoute: vi.fn(async () => undefined),
            getStatus: vi.fn(() => ({ enabled: true, started: runtime!.started })),
          };
          slackRuntimes.set(instanceId, runtime);
        }
        return runtime;
      },
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, statuses } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "status", context);

    expect(statuses).toContainEqual({ key: "slack-relay", value: "slack: ready unpaired" });
    expect(statuses).toContainEqual({ key: "slack-relay:beta", value: "slack: paired channel" });
  });

  it("does not write setup config when confirmation is cancelled", async () => {
    const config = await createRuntimeConfig("pi-setup-write-cancel-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-secret-token");
    vi.stubEnv("PI_RELAY_DISCORD_APPLICATION_ID", "123456789012345678");

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-write-cancel");
    context.ui.confirm = vi.fn(async () => false);
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        result = value;
      });
      screen?.handleInput?.("w");
      return result;
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup discord", context);

    await expect(readFile(config.configPath!, "utf8")).rejects.toThrow();
    expect(notifications.at(-1)?.message).toContain("Skipped PiRelay discord config update");
  });

  it("does not write setup config when env vars are invalid", async () => {
    const config = await createRuntimeConfig("pi-setup-write-invalid-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-secret-token");
    vi.stubEnv("PI_RELAY_DISCORD_APPLICATION_ID", "123456789012345678");
    vi.stubEnv("PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS", "sometimes");

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-write-invalid");
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        result = value;
      });
      screen?.handleInput?.("w");
      return result;
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup discord", context);

    expect(context.ui.confirm).not.toHaveBeenCalled();
    await expect(readFile(config.configPath!, "utf8")).rejects.toThrow();
    expect(notifications.at(-1)?.message).toContain("Invalid: PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS");
  });

  it("does not write setup config when required env vars are missing", async () => {
    const config = await createRuntimeConfig("pi-setup-write-missing-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "xoxb-secret-token");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "slack-signing-secret-value");

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("setup-write-missing");
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { handleInput?: (data: string) => void } | undefined) => {
      let result: unknown;
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        result = value;
      });
      screen?.handleInput?.("w");
      return result;
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "setup slack", context);

    expect(context.ui.confirm).not.toHaveBeenCalled();
    await expect(readFile(config.configPath!, "utf8")).rejects.toThrow();
    expect(notifications.at(-1)?.message).toContain("PI_RELAY_SLACK_APP_TOKEN");
  });

  it("asks before auto-migrating legacy relay config from doctor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-doctor-migrate-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      stateDir: dir,
      allowUserIds: [1001],
      PI_RELAY_DISCORD_BOT_TOKEN: "discord-file-env-style",
    }, null, 2), { mode: 0o644 });
    vi.stubEnv("PI_RELAY_CONFIG", configPath);

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("relay-doctor-migrate");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "doctor", context);

    expect(context.ui.confirm).toHaveBeenCalledWith(
      "Migrate PiRelay config?",
      expect.stringContaining("Legacy Telegram tunnel config keys were detected"),
    );
    const migrated = JSON.parse(await readFile(configPath, "utf8"));
    expect(migrated.botToken).toBeUndefined();
    expect(migrated.stateDir).toBeUndefined();
    expect(migrated.messengers.telegram.default).toMatchObject({
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      allowUserIds: ["1001"],
    });
    expect(migrated.messengers.discord.default.botToken).toBe("discord-file-env-style");
    expect(notifications.some((entry) => entry.message.includes("Migrated PiRelay config"))).toBe(true);
    expect(notifications.some((entry) => entry.message.includes("Relay setup doctor"))).toBe(true);
  });

  it("keeps local prompts and skill commands usable after connect, pairing, and route sync", async () => {
    const config = await createRuntimeConfig("pi-telegram-extension-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);

    const registeredRoutes = new Map<string, SessionRoute>();
    let blockFutureRouteSync = false;
    let blockedRouteSyncAttempts = 0;
    let unblockRouteSync: (() => void) | undefined;
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async (route: SessionRoute) => {
        registeredRoutes.set(route.sessionKey, route);
        if (blockFutureRouteSync) {
          blockedRouteSyncAttempts += 1;
          await new Promise<void>((resolve) => {
            unblockRouteSync = resolve;
          });
        }
      }),
      unregisterRoute: vi.fn(async (sessionKey: string) => {
        registeredRoutes.delete(sessionKey);
      }),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, branch, setIdle, statuses } = createMockContext("local-after-pairing");
    relayExtension(pi.api as any);
    const renderer = pi.api.registerMessageRenderer.mock.calls.find((call) => call[0] === "relay-audit")?.[1];
    expect(renderer({ content: "Slack paired with U5FUPDYM9." }, {}, { fg: (_name: string, text: string) => text }).render(120)[0]).toBe("Relay › Slack paired with U5FUPDYM9.");

    await pi.runCommand("relay", "connect telegram", context);
    expect(statuses).toContainEqual({ key: "relay", value: "telegram: ready unpaired" });
    const route = [...registeredRoutes.values()][0];
    expect(route).toBeDefined();

    const binding = createBinding(route!.sessionId, 7001, 9001);
    binding.sessionKey = route!.sessionKey;
    binding.sessionFile = route!.sessionFile;
    binding.sessionLabel = route!.sessionLabel;
    route!.binding = binding;
    route!.actions.persistBinding(binding, false);
    route!.actions.appendAudit("Telegram relay paired with @owner.");
    route!.actions.notifyLocal?.("Telegram paired with @owner for docs.", "info");
    await waitFor(() => statuses.some((entry) => entry.key === "relay" && entry.value === "telegram: paired dm"));
    branch.push(...pi.appendedEntries);

    blockFutureRouteSync = true;
    setIdle(false);
    await Promise.race([
      pi.submitLocalPrompt("local prompt still works after Telegram pairing", context),
      new Promise((_, reject) => setTimeout(() => reject(new Error("local prompt was blocked by route sync")), 100)),
    ]);
    await Promise.race([
      pi.runCommand("skill:relay", "", context),
      new Promise((_, reject) => setTimeout(() => reject(new Error("skill command was blocked after pairing")), 100)),
    ]);

    expect(pi.localPrompts).toEqual(["local prompt still works after Telegram pairing"]);
    expect(pi.skillInvocations).toEqual(["relay"]);
    expect(blockedRouteSyncAttempts).toBeGreaterThan(0);
    expect(pi.sentMessages.map((message) => message.customType)).toContain("relay-audit");
    unblockRouteSync?.();
  });

  it("uses explicit connect labels for pending pairing and route registration", async () => {
    const config = await createRuntimeConfig("pi-telegram-extension-label-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);

    const registeredRoutes = new Map<string, SessionRoute>();
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async (route: SessionRoute) => {
        registeredRoutes.set(route.sessionKey, route);
      }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("explicit-label-session");
    const store = new TunnelStateStore(config.stateDir);
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "connect telegram docs team", context);
    const route = [...registeredRoutes.values()][0];
    expect(route?.sessionLabel).toBe("docs team");

    const pending = Object.values((await store.load()).pendingPairings)[0];
    expect(pending?.sessionLabel).toBe("docs team");
  });

  it("starts the configured Discord runtime before showing Discord pairing instructions", async () => {
    const config = await createRuntimeConfig("pi-discord-extension-connect-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-token-test");
    vi.stubEnv("PI_RELAY_DISCORD_APPLICATION_ID", "");
    vi.stubEnv("PI_RELAY_DISCORD_CLIENT_ID", "");

    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    let discordStarted = false;
    const fakeDiscordRuntime = {
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      start: vi.fn(async () => {
        discordStarted = true;
      }),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: discordStarted })),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/discord/runtime.js", () => ({
      getOrCreateDiscordRuntime: () => fakeDiscordRuntime,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications, statuses } = createMockContext("discord-connect-session");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "connect discord docs", context);

    expect(fakeDiscordRuntime.registerRoute).toHaveBeenCalled();
    expect(fakeDiscordRuntime.start).toHaveBeenCalledTimes(1);
    expect(statuses).toContainEqual({ key: "discord-relay", value: "discord: ready unpaired" });
    const discordRouteCall = fakeDiscordRuntime.registerRoute.mock.calls.at(-1) as unknown[] | undefined;
    const discordRoute = discordRouteCall?.[0] as SessionRoute;
    const discordStore = new TunnelStateStore(config.stateDir);
    await discordStore.upsertChannelBinding({ channel: "discord", instanceId: "default", conversationId: "D1", userId: "U1", sessionKey: discordRoute.sessionKey, sessionId: discordRoute.sessionId, sessionLabel: discordRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { conversationKind: "private" } });
    discordRoute.actions.notifyLocal?.("Discord paired with U1 for docs.", "info");
    await waitFor(() => statuses.some((entry) => entry.key === "discord-relay" && entry.value === "discord: paired dm"));
    expect(notifications.some((entry) => entry.message.includes("relay pair"))).toBe(true);
    expect(notifications.some((entry) => entry.message.includes("QR redirect unavailable"))).toBe(true);
    const store = new TunnelStateStore(config.stateDir);
    const pending = Object.values((await store.load()).pendingPairings)[0];
    expect(pending).toMatchObject({ channel: "discord", sessionLabel: "docs", codeKind: "pin" });
  });

  it("renders a Discord QR pairing screen when applicationId is configured", async () => {
    const config = await createRuntimeConfig("pi-discord-qr-connect-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-token-test");
    vi.stubEnv("PI_RELAY_DISCORD_APPLICATION_ID", "client-123");

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
    const fakeDiscordRuntime = {
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: true })),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    const clipboardTexts: string[] = [];
    vi.doMock("../extensions/relay/adapters/discord/runtime.js", () => ({
      getOrCreateDiscordRuntime: () => fakeDiscordRuntime,
    }));
    vi.doMock("../extensions/relay/ui/clipboard.js", () => ({
      copyTextToClipboard: vi.fn(async (text: string) => {
        clipboardTexts.push(text);
        return { ok: true, command: "test-clipboard" };
      }),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("discord-qr-session");
    const rendered: string[][] = [];
    let closeCount = 0;
    context.ui.custom = vi.fn(async (factory: (...args: any[]) => { render?: (width: number) => string[]; handleInput?: (data: string) => void } | undefined) => {
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, () => {
        closeCount += 1;
      });
      rendered.push(screen?.render?.(100) ?? []);
      screen?.handleInput?.("c");
      await flushAsyncActions();
    });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "connect discord docs", context);

    const screenText = rendered.flat().join("\n");
    expect(screenText).toContain("Discord relay pairing");
    expect(screenText).toContain("discord.com/users/client-123");
    expect(screenText).not.toContain("discord.com/oauth2/authorize");
    expect(screenText).toContain("Command to send:");
    expect(screenText).toContain("relay pair");
    expect(screenText).toContain("c copy command");
    expect(screenText).toContain("Choose one pairing path");
    expect(screenText).toContain("A) DM");
    expect(screenText).toContain("B) Channel");
    expect(screenText).toContain("already share a server");
    expect(clipboardTexts.at(-1)).toMatch(/^relay pair \d{3}-\d{3}\n$/);
    expect(closeCount).toBe(0);
    expect(notifications.some((entry) => entry.message.includes("pairing command copied to clipboard"))).toBe(true);
    expect(notifications.at(-1)?.message).toContain("Discord pairing PIN ready");
    const store = new TunnelStateStore(config.stateDir);
    const pending = Object.values((await store.load()).pendingPairings)[0];
    expect(pending).toMatchObject({ channel: "discord", sessionLabel: "docs", codeKind: "pin" });
  });

  it("renders a Slack App Home QR pairing screen when appId is configured", async () => {
    const config = await createRuntimeConfig("pi-slack-qr-connect-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_SLACK_ENABLED", "true");
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "xoxb-test-token");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "slack-signing-secret-test");
    vi.stubEnv("PI_RELAY_SLACK_APP_TOKEN", "xapp-test-token");
    vi.stubEnv("PI_RELAY_SLACK_APP_ID", "A123");
    vi.stubEnv("PI_RELAY_SLACK_WORKSPACE_ID", "T123");

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
    let slackStarted = false;
    const fakeSlackRuntime = {
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      start: vi.fn(async () => {
        slackStarted = true;
      }),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: slackStarted, appId: "A123", teamId: "T123" })),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    const clipboardTexts: string[] = [];
    vi.doMock("../extensions/relay/adapters/slack/runtime.js", () => ({
      getOrCreateSlackRuntime: () => fakeSlackRuntime,
    }));
    vi.doMock("../extensions/relay/ui/clipboard.js", () => ({
      copyTextToClipboard: vi.fn(async (text: string) => {
        clipboardTexts.push(text);
        return { ok: true, command: "test-clipboard" };
      }),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications, statuses } = createMockContext("slack-qr-session");
    const rendered: string[][] = [];
    let closeCount = 0;
    context.ui.custom = vi.fn((factory: (...args: any[]) => { render?: (width: number) => string[]; handleInput?: (data: string) => void } | undefined) => new Promise((resolve) => {
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        closeCount += 1;
        resolve(value);
      });
      rendered.push(screen?.render?.(100) ?? []);
      screen?.handleInput?.("c");
    }));
    relayExtension(pi.api as any);

    const connectPromise = pi.runCommand("relay", "connect slack docs", context);
    await waitFor(() => rendered.length > 0);
    await flushAsyncActions();

    const screenText = rendered.flat().join("\n");
    expect(screenText).toContain("Slack relay pairing");
    expect(screenText).toContain("slack.com/app_redirect?app=A123&team=T123");
    expect(screenText).toContain("Command to send:");
    expect(screenText).toContain("relay pair");
    expect(screenText).toContain("c copy command");
    expect(screenText).toContain("Choose one pairing path");
    expect(screenText).toContain("A) DM");
    expect(screenText).toContain("B) Channel");
    expect(screenText).toContain("slack.allowChannelMessa");
    expect(screenText).toContain("sending messages to this app is turned off");
    expect(clipboardTexts.at(-1)).toMatch(/^relay pair \d{3}-\d{3}\n$/);
    expect(closeCount).toBe(0);
    expect(fakeSlackRuntime.start).toHaveBeenCalledTimes(1);
    expect(statuses).toContainEqual({ key: "slack-relay", value: "slack: ready unpaired" });
    expect(notifications.some((entry) => entry.message.includes("pairing command copied to clipboard"))).toBe(true);
    const registerCallsAfterConnect = fakeSlackRuntime.registerRoute.mock.calls.length;
    const routeForPairingCall = fakeSlackRuntime.registerRoute.mock.calls.at(-1) as unknown[] | undefined;
    const routeForPairing = routeForPairingCall?.[0] as SessionRoute;
    const store = new TunnelStateStore(config.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U5FUPDYM9", sessionKey: routeForPairing.sessionKey, sessionId: routeForPairing.sessionId, sessionLabel: routeForPairing.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { conversationKind: "private" } });
    routeForPairing.actions.notifyLocal?.("Slack paired with U5FUPDYM9 for docs.", "info");
    await connectPromise;
    expect(closeCount).toBe(1);
    expect(notifications.some((entry) => entry.message.includes("Slack pairing PIN ready"))).toBe(true);
    expect(notifications).toContainEqual({ message: "Slack paired with U5FUPDYM9 for docs.", level: "info" });
    await waitFor(() => statuses.some((entry) => entry.key === "slack-relay" && entry.value === "slack: paired dm"));
    await pi.emit("agent_start", {}, context);
    expect(fakeSlackRuntime.registerRoute.mock.calls.length).toBeGreaterThan(registerCallsAfterConnect);
    const latestRegisterCall = fakeSlackRuntime.registerRoute.mock.calls.at(-1) as unknown[] | undefined;
    expect(latestRegisterCall?.[0]).toMatchObject({ notification: { lastStatus: "running", progressEvent: expect.objectContaining({ text: "Pi task started" }) } });
    const pending = Object.values((await store.load()).pendingPairings)[0];
    expect(pending).toMatchObject({ channel: "slack", sessionLabel: "docs", codeKind: "pin" });
  });

  it("sends a local workspace file to a paired non-default Slack binding", async () => {
    const config = await createRuntimeConfig("pi-local-file-slack-");
    const root = await mkdtemp(join(tmpdir(), "pirelay-local-file-workspace-"));
    tempDirs.push(root);
    await writeFile(join(root, "proposal.md"), "# Proposal\n");
    await writeFile(config.configPath!, JSON.stringify({
      relay: { stateDir: config.stateDir },
      messengers: {
        telegram: { default: { botToken: config.botToken } },
        slack: {
          default: { enabled: true, botToken: "xoxb-default", signingSecret: "slack-signing-secret-default", appToken: "xapp-default", maxFileBytes: 4 },
          work: { enabled: true, botToken: "xoxb-work", signingSecret: "slack-signing-secret-work", appToken: "xapp-work", maxFileBytes: 1024 },
        },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);

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
    const sentFiles: Array<{ fileName: string; mimeType: string; caption?: string; kind: string }> = [];
    const fakeSlackRuntime = {
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: true })),
      sendFileToBoundRoute: vi.fn(async (_route: SessionRoute, file: { fileName: string; mimeType: string }, options: { kind: string; caption?: string }) => {
        sentFiles.push({ fileName: file.fileName, mimeType: file.mimeType, caption: options.caption, kind: options.kind });
        return true;
      }),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/slack/runtime.js", () => ({
      getOrCreateSlackRuntime: () => fakeSlackRuntime,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("local-file-slack");
    context.cwd = root;
    const sessionKey = sessionKeyOf(context.sessionManager.getSessionId(), context.sessionManager.getSessionFile());
    await new TunnelStateStore(config.stateDir).upsertChannelBinding({ channel: "slack", instanceId: "work", conversationId: "D1", userId: "U1", sessionKey, sessionId: context.sessionManager.getSessionId(), sessionFile: context.sessionManager.getSessionFile(), sessionLabel: "docs", boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { conversationKind: "private" } });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "send-file slack:work proposal.md OpenSpec proposal", context);

    expect(sentFiles).toEqual([{ fileName: "proposal.md", mimeType: "text/markdown", caption: "OpenSpec proposal", kind: "document" }]);
    expect(notifications.at(-1)?.message).toContain("Delivered: Slack:work");
  });

  it("registers relay_send_file and scopes assistant delivery to the current remote requester", async () => {
    const config = await createRuntimeConfig("pi-assistant-send-file-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    await writeFile(config.configPath!, JSON.stringify({
      stateDir: config.stateDir,
      telegram: { botToken: config.botToken },
      slack: { enabled: true, botToken: "xoxb-test", signingSecret: "signing", appToken: "xapp-test", eventMode: "socket" },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", config.configPath!);
    let capturedRoute: SessionRoute | undefined;
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async (route: SessionRoute) => { capturedRoute = route; }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    const fakeSlackRuntime = {
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: true })),
      sendFileToRequester: vi.fn(async () => "Delivered report.md to Slack U1 as report.md (9 bytes)."),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/slack/runtime.js", () => ({
      getOrCreateSlackRuntime: () => fakeSlackRuntime,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("assistant-send-file");
    relayExtension(pi.api as any);
    const tool = pi.tools.get("relay_send_file");
    expect(tool).toBeDefined();

    const noContext = await tool!.execute("tool-1", { relativePath: "report.md" });
    expect(noContext.content[0].text).toContain("no active Pi session route");

    await pi.emit("session_start", {}, context);
    expect(capturedRoute).toBeDefined();
    const localOnly = await tool!.execute("tool-local", { relativePath: "report.md" });
    expect(localOnly.content[0].text).toContain("No authorized remote requester");
    capturedRoute!.remoteRequester = {
      channel: "slack",
      instanceId: "default",
      conversationId: "D1",
      userId: "U1",
      sessionKey: capturedRoute!.sessionKey,
      safeLabel: "Slack U1",
      threadId: "thread-1",
      createdAt: Date.now(),
    };
    capturedRoute!.remoteRequesterPendingTurn = true;
    await pi.emit("agent_start", {}, context);

    const delivered = await tool!.execute("tool-2", { relativePath: "report.md", caption: "Report" });
    expect(delivered.content[0].text).toContain("Delivered report.md");
    expect(fakeSlackRuntime.sendFileToRequester).toHaveBeenCalledWith(capturedRoute, capturedRoute!.remoteRequester, "report.md", "Report");

    await pi.emit("agent_start", {}, context);
    const staleLocal = await tool!.execute("tool-local-stale", { relativePath: "report.md" });
    expect(staleLocal.content[0].text).toContain("No authorized remote requester");
    expect(fakeSlackRuntime.sendFileToRequester).toHaveBeenCalledTimes(1);
  });

  it("contains stale context failures from lifecycle warning reporting", async () => {
    vi.useFakeTimers();
    const config = await createRuntimeConfig("pi-stale-lifecycle-warning-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const sessionId = "stale-lifecycle-warning";
    const binding = createBinding(sessionId, 555, 42);
    await new TunnelStateStore(config.stateDir).upsertBinding(binding);

    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(() => new Promise<void>(() => undefined)),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.emit("session_start", {}, context);
    context.ui.setStatus = vi.fn(() => { throw new Error(STALE_EXTENSION_ERROR); });
    const shutdown = pi.emit("session_shutdown", {}, context);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(shutdown).resolves.toBeUndefined();
    expect(fakeRuntime.unregisterRoute).toHaveBeenCalledWith(binding.sessionKey);
  });

  it("converts stale session-bound API failures in route actions", async () => {
    const config = await createRuntimeConfig("pi-stale-route-actions-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const registeredRoutes: SessionRoute[] = [];
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async (route: SessionRoute) => { registeredRoutes.push(route); }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("stale-route-actions");
    relayExtension(pi.api as any);
    await pi.emit("session_start", {}, context);
    const route = registeredRoutes.at(-1)!;

    route.remoteRequester = { channel: "telegram", instanceId: "default", conversationId: "1", userId: "1", sessionKey: route.sessionKey, safeLabel: "Telegram", createdAt: Date.now() };
    pi.api.sendUserMessage.mockImplementationOnce(() => { throw new Error(STALE_EXTENSION_ERROR); });
    expect(() => route.actions.sendUserMessage("hello")).toThrow("The Pi session is unavailable");
    expect(route.remoteRequester).toBeUndefined();
    expect(route.remoteRequesterPendingTurn).toBe(false);
    expect(route.actions.isIdle?.()).toBeUndefined();

    pi.api.sendMessage.mockImplementationOnce(() => { throw new Error(STALE_EXTENSION_ERROR); });
    expect(() => route.actions.appendAudit("audit")).not.toThrow();

    pi.api.appendEntry.mockImplementationOnce(() => { throw new Error(STALE_EXTENSION_ERROR); });
    expect(() => route.actions.persistBinding(null, true)).not.toThrow();

    context.ui.confirm = vi.fn(async () => { throw new Error(STALE_EXTENSION_ERROR); });
    await expect(route.actions.promptLocalConfirmation({ channel: "telegram", id: 1, userId: "1" })).resolves.toBe("deny");

    context.abort = vi.fn(() => { throw new Error(STALE_EXTENSION_ERROR); });
    expect(() => route.actions.abort()).toThrow("The Pi session is unavailable");

    context.compact = vi.fn(() => { throw new Error(STALE_EXTENSION_ERROR); });
    await expect(route.actions.compact()).rejects.toThrow("The Pi session is unavailable");
  });

  it("invalidates live context when auxiliary route actions see stale session APIs", async () => {
    const config = await createRuntimeConfig("pi-stale-aux-route-actions-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const registeredRoutes: SessionRoute[] = [];
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async (route: SessionRoute) => { registeredRoutes.push(route); }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    relayExtension(pi.api as any);

    async function startRoute(sessionId: string) {
      const { context } = createMockContext(sessionId);
      await pi.emit("session_start", {}, context);
      return { route: registeredRoutes.at(-1)!, context };
    }

    let started = await startRoute("stale-append-audit");
    expect(started.route.actions.isIdle?.()).toBe(true);
    pi.api.sendMessage.mockImplementationOnce(() => { throw new Error(STALE_EXTENSION_ERROR); });
    expect(() => started.route.actions.appendAudit("audit")).not.toThrow();
    expect(started.route.actions.isIdle?.()).toBeUndefined();

    started = await startRoute("stale-persist-binding");
    expect(started.route.actions.isIdle?.()).toBe(true);
    pi.api.appendEntry.mockImplementationOnce(() => { throw new Error(STALE_EXTENSION_ERROR); });
    expect(() => started.route.actions.persistBinding(null, true)).not.toThrow();
    expect(started.route.actions.isIdle?.()).toBeUndefined();

    started = await startRoute("stale-workspace-root");
    expect(started.route.actions.isIdle?.()).toBe(true);
    Object.defineProperty(started.context, "cwd", { configurable: true, get: () => { throw new Error(STALE_EXTENSION_ERROR); } });
    await expect(started.route.actions.getImageByPath("outputs/render.png")).resolves.toMatchObject({ ok: false, error: expect.stringContaining("unavailable") });
    expect(started.route.actions.isIdle?.()).toBeUndefined();

    started = await startRoute("stale-local-confirmation");
    expect(started.route.actions.isIdle?.()).toBe(true);
    started.context.ui.confirm = vi.fn(async () => { throw new Error(STALE_EXTENSION_ERROR); });
    await expect(started.route.actions.promptLocalConfirmation({ channel: "telegram", id: 1, userId: "1" })).resolves.toBe("deny");
    expect(started.route.actions.isIdle?.()).toBeUndefined();
  });

  it("does not refresh active status from stale route-local actions", async () => {
    const config = await createRuntimeConfig("pi-stale-route-local-status-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const registeredRoutes: SessionRoute[] = [];
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async (route: SessionRoute) => { registeredRoutes.push(route); }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const first = createMockContext("stale-route-local-status-a");
    const second = createMockContext("stale-route-local-status-b");
    relayExtension(pi.api as any);

    await pi.emit("session_start", {}, first.context);
    const staleRoute = registeredRoutes.at(-1)!;
    await pi.emit("session_start", {}, second.context);

    let closeCount = 0;
    let customRendered = false;
    type TestCustomScreen = { render?: (width: number) => string[] };
    type TestCustomFactory = (
      terminal: Record<string, never>,
      theme: { fg: (name: string, text: string) => string },
      keymap: Record<string, never>,
      done: (value: unknown) => void,
    ) => TestCustomScreen | undefined;
    second.context.ui.custom = vi.fn((factory: TestCustomFactory) => new Promise((resolve) => {
      const screen = factory({}, { fg: (_name: string, text: string) => text }, {}, (value: unknown) => {
        closeCount += 1;
        resolve(value);
      });
      screen?.render?.(100);
      customRendered = true;
    }));
    const connectPromise = pi.runCommand("relay", "connect telegram", second.context);
    await waitFor(() => customRendered);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const statusCount = second.statuses.length;

    staleRoute.actions.setLocalStatus?.("stale-route", "should not update active context");
    staleRoute.actions.notifyLocal?.("stale route notification");
    staleRoute.actions.refreshLocalStatus?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(second.statuses).toHaveLength(statusCount);
    expect(second.statuses).not.toContainEqual({ key: "stale-route", value: "should not update active context" });
    expect(second.notifications).toEqual([]);
    expect(closeCount).toBe(0);

    const activeRoute = registeredRoutes.at(-1)!;
    activeRoute.actions.notifyLocal?.("active route notification");
    await connectPromise;
    expect(closeCount).toBe(1);
    expect(activeRoute.actions.isIdle?.()).toBe(true);
    pi.api.appendEntry.mockImplementationOnce(() => { throw new Error(STALE_EXTENSION_ERROR); });
    expect(() => staleRoute.actions.persistBinding(null, true)).not.toThrow();
    expect(activeRoute.actions.isIdle?.()).toBe(true);

    second.context.ui.notify = vi.fn(() => { throw new Error(STALE_EXTENSION_ERROR); });
    await expect(pi.runCommand("relay", "setup signal", second.context)).resolves.toBeUndefined();
    expect(activeRoute.actions.isIdle?.()).toBeUndefined();
  });

  it("refuses workspace image lookup when the live context is stale", async () => {
    const config = await createRuntimeConfig("pi-stale-workspace-image-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const registeredRoutes: SessionRoute[] = [];
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async (route: SessionRoute) => { registeredRoutes.push(route); }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("stale-workspace-image");
    relayExtension(pi.api as any);
    await pi.emit("session_start", {}, context);
    const route = registeredRoutes.at(-1)!;
    context.sessionManager.getSessionId = vi.fn(() => { throw new Error(STALE_EXTENSION_ERROR); });

    await expect(route.actions.getImageByPath("outputs/render.png")).resolves.toMatchObject({ ok: false, error: expect.stringContaining("unavailable") });
  });

  it("marks requester turns on the route instance that delivered the prompt", async () => {
    const config = await createRuntimeConfig("pi-route-instance-pending-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const registeredRoutes: SessionRoute[] = [];
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({ botId: 123456, botUsername: "pi_test_bot", botDisplayName: "Pi Test Bot", validatedAt: new Date().toISOString() })),
      registerRoute: vi.fn(async (route: SessionRoute) => { registeredRoutes.push(route); }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const first = createMockContext("route-instance-first").context;
    const second = createMockContext("route-instance-second").context;
    relayExtension(pi.api as any);
    await pi.emit("session_start", {}, first);
    const oldRoute = registeredRoutes.at(-1)!;
    await pi.emit("session_start", {}, second);
    const newRoute = registeredRoutes.at(-1)!;
    oldRoute.remoteRequester = { channel: "telegram", instanceId: "default", conversationId: "1", userId: "1", sessionKey: oldRoute.sessionKey, safeLabel: "Telegram old", createdAt: Date.now() };
    newRoute.remoteRequester = { channel: "telegram", instanceId: "default", conversationId: "2", userId: "2", sessionKey: newRoute.sessionKey, safeLabel: "Telegram new", createdAt: Date.now() };

    expect(() => oldRoute.actions.sendUserMessage("from old route")).toThrow("The Pi session is unavailable");

    expect(oldRoute.remoteRequester).toBeUndefined();
    expect(oldRoute.remoteRequesterPendingTurn).toBe(false);
    expect(newRoute.remoteRequesterPendingTurn).toBeUndefined();
  });

  it("rejects oversized local Telegram send-file documents before delivery", async () => {
    const config = await createRuntimeConfig("pi-local-file-telegram-large-");
    const root = await mkdtemp(join(tmpdir(), "pirelay-local-file-telegram-large-workspace-"));
    tempDirs.push(root);
    await writeFile(join(root, "huge.md"), "");
    await truncate(join(root, "huge.md"), 51 * 1024 * 1024);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
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
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("local-file-telegram-large");
    context.cwd = root;
    const sessionKey = sessionKeyOf(context.sessionManager.getSessionId(), context.sessionManager.getSessionFile());
    await new TunnelStateStore(config.stateDir).upsertBinding({ sessionKey, sessionId: context.sessionManager.getSessionId(), sessionFile: context.sessionManager.getSessionFile(), sessionLabel: "docs", chatId: 123, userId: 456, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "send-file telegram huge.md", context);

    expect(notifications.at(-1)?.message).toContain("too large");
  });

  it("short-circuits local send-file when the target has no deliverable binding", async () => {
    const config = await createRuntimeConfig("pi-local-file-no-delivery-");
    const root = await mkdtemp(join(tmpdir(), "pirelay-local-file-no-delivery-workspace-"));
    tempDirs.push(root);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
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
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("local-file-no-delivery");
    context.cwd = root;
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "send-file slack: missing.md", context);
    expect(notifications.at(-1)?.message).toContain("Unsupported relay channel: slack:");

    await pi.runCommand("relay", "send-file slack missing.md", context);

    expect(notifications.at(-1)?.message).toContain("No active unpaused relay binding");
    expect(notifications.at(-1)?.message).not.toContain("File not found");
  });

  it("applies default Slack file limits before reading local send-file documents", async () => {
    const config = await createRuntimeConfig("pi-local-file-slack-default-large-");
    const root = await mkdtemp(join(tmpdir(), "pirelay-local-file-slack-default-large-workspace-"));
    tempDirs.push(root);
    await writeFile(join(root, "huge.md"), "");
    await truncate(join(root, "huge.md"), 11 * 1024 * 1024);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
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
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("local-file-slack-default-large");
    context.cwd = root;
    const sessionKey = sessionKeyOf(context.sessionManager.getSessionId(), context.sessionManager.getSessionFile());
    await new TunnelStateStore(config.stateDir).upsertChannelBinding({ channel: "slack", instanceId: "ghost", conversationId: "D1", userId: "U1", sessionKey, sessionId: context.sessionManager.getSessionId(), sessionFile: context.sessionManager.getSessionFile(), sessionLabel: "docs", boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { conversationKind: "private" } });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "send-file slack:ghost huge.md", context);

    expect(notifications.at(-1)?.message).toContain("too large");
  });

  it("applies default Discord file limits before reading local send-file images", async () => {
    const config = await createRuntimeConfig("pi-local-file-discord-default-large-image-");
    const root = await mkdtemp(join(tmpdir(), "pirelay-local-file-discord-default-large-image-workspace-"));
    tempDirs.push(root);
    const hugeImagePath = join(root, "huge.png");
    await writeFile(hugeImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    await truncate(hugeImagePath, 9 * 1024 * 1024);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
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
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("local-file-discord-default-large-image");
    context.cwd = root;
    const sessionKey = sessionKeyOf(context.sessionManager.getSessionId(), context.sessionManager.getSessionFile());
    await new TunnelStateStore(config.stateDir).upsertChannelBinding({ channel: "discord", instanceId: "ghost", conversationId: "D1", userId: "U1", sessionKey, sessionId: context.sessionManager.getSessionId(), sessionFile: context.sessionManager.getSessionFile(), sessionLabel: "docs", boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { conversationKind: "private" } });
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "send-file discord:ghost huge.png", context);

    expect(notifications.at(-1)?.message).toContain("too large");
  });

  it("short-circuits paused bindings and rejects unsafe local send-file paths", async () => {
    const config = await createRuntimeConfig("pi-local-file-all-configuration-");
    const root = await mkdtemp(join(tmpdir(), "pirelay-local-file-all-workspace-"));
    tempDirs.push(root);
    await writeFile(join(root, "notes.md"), "# Notes\n");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_SLACK_ENABLED", "true");
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "xoxb-test-token");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "slack-signing-secret-test");
    vi.stubEnv("PI_RELAY_SLACK_APP_TOKEN", "xapp-test-token");

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
    const fakeSlackRuntime = {
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({ enabled: true, started: true })),
      sendFileToBoundRoute: vi.fn(async () => true),
    };
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/slack/runtime.js", () => ({
      getOrCreateSlackRuntime: () => fakeSlackRuntime,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("local-file-all");
    context.cwd = root;
    const sessionKey = sessionKeyOf(context.sessionManager.getSessionId(), context.sessionManager.getSessionFile());
    const store = new TunnelStateStore(config.stateDir);
    const slackBinding = { channel: "slack" as const, instanceId: "default", conversationId: "D1", userId: "U1", sessionKey, sessionId: context.sessionManager.getSessionId(), sessionFile: context.sessionManager.getSessionFile(), sessionLabel: "docs", boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), paused: true, metadata: { conversationKind: "private" } };
    await store.upsertChannelBinding(slackBinding);
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "send-file all notes.md", context);
    expect(fakeSlackRuntime.sendFileToBoundRoute).not.toHaveBeenCalled();
    expect(notifications.at(-1)?.message).toContain("No active unpaused relay binding");

    await store.upsertChannelBinding({ ...slackBinding, paused: false });
    await pi.runCommand("relay", "send-file slack ../secret.md", context);
    expect(notifications.at(-1)?.message).toContain("traversal");
  });

  it("lists and revokes locally trusted relay users", async () => {
    const config = await createRuntimeConfig("pi-trusted-users-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const store = new TunnelStateStore(config.stateDir);
    await store.trustRelayUser({ channel: "discord", instanceId: "default", userId: "u1", displayName: "zikolach", trustedBySessionLabel: "docs" });

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
    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("trusted-users-session");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "trusted", context);
    expect(notifications.at(-1)?.message).toContain("zikolach");

    await pi.runCommand("relay", "untrust discord u1", context);
    expect(notifications.at(-1)?.message).toContain("Revoked local relay trust");
    expect(await store.getTrustedRelayUser("discord", "u1")).toBeUndefined();
  });

  it("connects Discord pairing through the extension and routes relay status plus prompts to Pi", async () => {
    const config = await createRuntimeConfig("pi-discord-connectivity-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-token-test");
    vi.stubEnv("PI_RELAY_DISCORD_APPLICATION_ID", "");
    vi.stubEnv("PI_RELAY_DISCORD_CLIENT_ID", "");

    const store = new TunnelStateStore(config.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: "stale-session:/tmp/stale.jsonl",
      sessionId: "stale-session",
      sessionLabel: "Stale session",
      boundAt: "2026-05-02T10:00:00.000Z",
      lastSeenAt: "2026-05-02T10:00:00.000Z",
    });

    const fakeTelegramRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    const discordOps = new IntegrationDiscordOperations();

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeTelegramRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/discord/live-client.js", () => ({
      createDiscordLiveOperations: () => discordOps,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications } = createMockContext("discord-connectivity-session");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "connect discord docs", context);
    const pending = Object.values((await store.load()).pendingPairings)[0];
    expect(pending).toMatchObject({ channel: "discord", sessionLabel: "docs" });
    expect(discordOps.handler).toBeDefined();

    const code = notifications.map((entry) => entry.message).join("\n").match(/\/start\s+([A-Za-z0-9_-]+)/)?.[1];
    expect(code).toBeDefined();
    await discordOps.handler?.(integrationDiscordMessage(`/start ${code}`));
    await discordOps.handler?.(integrationDiscordMessage("relay status"));
    await discordOps.handler?.(integrationDiscordMessage("hello from discord"));
    await pi.emit("agent_start", {}, context);
    await pi.emit("agent_end", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "Hello back from Pi." }] }],
    }, context);

    expect(discordOps.messages.some((message) => message.content.includes("Discord paired with docs"))).toBe(true);
    expect(discordOps.messages.some((message) => message.content.includes("Session: docs"))).toBe(true);
    expect(pi.injectedMessages).toContainEqual({ text: "hello from discord", options: undefined });
    expect(discordOps.messages.some((message) => message.content.includes("Hello back from Pi."))).toBe(true);
  });

  it("sends failure and abort terminal notifications to Telegram and Discord bindings", async () => {
    const config = await createRuntimeConfig("pi-discord-terminal-parity-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", `discord-token-${config.stateDir.split("/").pop()}`);
    vi.stubEnv("PI_RELAY_DISCORD_APPLICATION_ID", "");
    vi.stubEnv("PI_RELAY_DISCORD_CLIENT_ID", "");

    const store = new TunnelStateStore(config.stateDir);
    const registeredRoutes = new Map<string, SessionRoute>();
    const fakeTelegramRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async (route: SessionRoute) => {
        registeredRoutes.set(route.sessionKey, route);
      }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    const discordOps = new IntegrationDiscordOperations();
    const sendSessionNotification = vi.fn(async () => undefined);

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeTelegramRuntime,
      sendSessionNotification,
    }));
    vi.doMock("../extensions/relay/adapters/discord/live-client.js", () => ({
      createDiscordLiveOperations: () => discordOps,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context, notifications, setIdle } = createMockContext("discord-terminal-session");
    relayExtension(pi.api as any);

    await pi.runCommand("relay", "connect discord docs", context);
    const code = notifications.map((entry) => entry.message).join("\n").match(/\/start\s+([A-Za-z0-9_-]+)/)?.[1];
    expect(code).toBeDefined();
    await discordOps.handler?.(integrationDiscordMessage(`/start ${code}`));

    const route = [...registeredRoutes.values()][0]!;
    const telegramBinding = createBinding(route.sessionId, 7010, 9010);
    telegramBinding.sessionKey = route.sessionKey;
    telegramBinding.sessionFile = route.sessionFile;
    telegramBinding.sessionLabel = route.sessionLabel;
    route.binding = telegramBinding;
    await store.upsertBinding(telegramBinding);

    await discordOps.handler?.(integrationDiscordMessage("run failure"));
    await pi.emit("agent_start", {}, context);
    await pi.emit("agent_end", { messages: [] }, context);

    setIdle(false);
    await pi.emit("agent_start", {}, context);
    await discordOps.handler?.(integrationDiscordMessage("relay abort"));
    await pi.emit("agent_end", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "Stopping now." }] }],
    }, context);

    const terminalStatuses = sendSessionNotification.mock.calls.map((call) => (call as unknown[])[2]);
    expect(terminalStatuses).toEqual(expect.arrayContaining(["failed", "aborted"]));
    expect(discordOps.messages.some((message) => message.content.includes("finished without a final assistant response"))).toBe(true);
    expect(discordOps.messages.some((message) => message.content.includes("Abort requested"))).toBe(true);
    expect(discordOps.messages.some((message) => message.content.includes("Pi task aborted"))).toBe(true);
  });

  it("restores persisted Discord bindings after restart and completes the closed loop without re-pairing", async () => {
    const config = await createRuntimeConfig("pi-discord-restore-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    vi.stubEnv("PI_RELAY_DISCORD_ENABLED", "true");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", `discord-token-${config.stateDir.split("/").pop()}`);

    const sessionId = "discord-restored-session";
    const sessionFile = `/tmp/${sessionId}.jsonl`;
    const sessionKey = sessionKeyOf(sessionId, sessionFile);
    const store = new TunnelStateStore(config.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey,
      sessionId,
      sessionFile,
      sessionLabel: "restored docs",
      boundAt: "2026-05-02T12:00:00.000Z",
      lastSeenAt: "2026-05-02T12:00:00.000Z",
    });

    const fakeTelegramRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async () => undefined),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };
    const discordOps = new IntegrationDiscordOperations();

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeTelegramRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));
    vi.doMock("../extensions/relay/adapters/discord/live-client.js", () => ({
      createDiscordLiveOperations: () => discordOps,
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext(sessionId);
    relayExtension(pi.api as any);

    await pi.emit("session_start", { reason: "startup" }, context);
    await discordOps.handler?.(integrationDiscordMessage("relay status"));
    await discordOps.handler?.(integrationDiscordMessage("hello after restart"));
    await pi.emit("agent_start", {}, context);
    await pi.emit("agent_end", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "Restored Discord binding replied." }] }],
    }, context);

    expect(discordOps.messages.some((message) => message.content.includes("Session: discord-restored-session.jsonl"))).toBe(true);
    expect(pi.injectedMessages).toContainEqual({ text: "hello after restart", options: undefined });
    expect(discordOps.messages.some((message) => message.content.includes("Restored Discord binding replied."))).toBe(true);
  });

  it("tracks latest tool-result images without echoing input images", async () => {
    const config = await createRuntimeConfig("pi-telegram-extension-images-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);

    const registeredRoutes = new Map<string, SessionRoute>();
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async (route: SessionRoute) => {
        registeredRoutes.set(route.sessionKey, route);
      }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("local-image-tracking");
    relayExtension(pi.api as any);

    await pi.emit("session_start", { reason: "startup" }, context);
    const route = [...registeredRoutes.values()][0]!;

    await pi.emit("agent_start", {}, context);
    await pi.emit("message_end", {
      message: {
        role: "user",
        content: [{ type: "text", text: "input" }, { type: "image", data: Buffer.from("input").toString("base64"), mimeType: "image/png" }],
      },
    }, context);
    await pi.emit("message_end", {
      message: {
        role: "toolResult",
        content: [{ type: "image", data: Buffer.from("output").toString("base64"), mimeType: "image/png" }],
      },
    }, context);
    await pi.emit("agent_end", {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Generated an image." }],
      }],
    }, context);

    expect(route.notification.latestImages).toMatchObject({ count: 1, skipped: 0 });
    const images = await route.actions.getLatestImages();
    expect(images).toHaveLength(1);
    expect(images[0]?.data).toBe(Buffer.from("output").toString("base64"));

    const nextContext = createMockContext("other-image-session").context;
    await pi.emit("session_start", { reason: "switch" }, nextContext);
    const nextRoute = registeredRoutes.get("other-image-session:/tmp/other-image-session.jsonl")!;
    await expect(route.actions.getLatestImages()).resolves.toEqual([]);
    await expect(nextRoute.actions.getLatestImages()).resolves.toEqual([]);
  }, 10_000);

  it("stages latest assistant image file references and loads them on demand", async () => {
    const config = await createRuntimeConfig("pi-telegram-extension-file-images-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const workspace = await mkdtemp(join(tmpdir(), "pi-telegram-workspace-images-"));
    tempDirs.push(workspace);
    await writeFile(join(workspace, "render.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));

    const registeredRoutes = new Map<string, SessionRoute>();
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async (route: SessionRoute) => {
        registeredRoutes.set(route.sessionKey, route);
      }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("local-file-image-tracking");
    context.cwd = workspace;
    relayExtension(pi.api as any);

    await pi.emit("session_start", { reason: "startup" }, context);
    const route = [...registeredRoutes.values()][0]!;

    await pi.emit("agent_start", {}, context);
    await pi.emit("agent_end", {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Saved image at `render.png`." }],
      }],
    }, context);

    expect(route.notification.latestImages).toMatchObject({ count: 1, fileCount: 1, contentCount: 0 });
    const images = await route.actions.getLatestImages();
    expect(images).toHaveLength(1);
    expect(images[0]?.fileName).toBe("render.png");
    await expect(route.actions.getImageByPath("../secret.png")).resolves.toMatchObject({ ok: false });
  }, 10_000);

  it("does not offer latest-image actions for missing assistant image path references", async () => {
    const config = await createRuntimeConfig("pi-telegram-extension-missing-file-images-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);
    const workspace = await mkdtemp(join(tmpdir(), "pi-telegram-workspace-missing-images-"));
    tempDirs.push(workspace);

    const registeredRoutes = new Map<string, SessionRoute>();
    const fakeRuntime: TunnelRuntime = {
      setup: undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      ensureSetup: vi.fn(async () => ({
        botId: 123456,
        botUsername: "pi_test_bot",
        botDisplayName: "Pi Test Bot",
        validatedAt: new Date().toISOString(),
      })),
      registerRoute: vi.fn(async (route: SessionRoute) => {
        registeredRoutes.set(route.sessionKey, route);
      }),
      unregisterRoute: vi.fn(async () => undefined),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/relay/adapters/telegram/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: relayExtension } = await import("../extensions/relay/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("local-missing-file-image-tracking");
    context.cwd = workspace;
    relayExtension(pi.api as any);

    await pi.emit("session_start", { reason: "startup" }, context);
    const route = [...registeredRoutes.values()][0]!;

    await pi.emit("agent_start", {}, context);
    await pi.emit("agent_end", {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Saved image at `missing.png`." }],
      }],
    }, context);

    expect(route.notification.latestImages).toBeUndefined();
    await expect(route.actions.getLatestImages()).resolves.toEqual([]);
  }, 10_000);

  it("synchronizes route state through the broker and handles broker-delivered prompts", async () => {
    const config = await createRuntimeConfig("pi-telegram-broker-");
    const runtime = new BrokerTunnelRuntime(config);
    const socketPath = (runtime as any).socketPath as string;
    const brokerMessages: any[] = [];
    const clientResponses: any[] = [];
    const sockets: Socket[] = [];

    const server: Server = createServer((socket) => {
      sockets.push(socket);
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) {
            const message = JSON.parse(line);
            if (message.type === "request") {
              brokerMessages.push(message);
              socket.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: true })}\n`);
            } else if (message.type === "response") {
              clientResponses.push(message);
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      const binding = createBinding("broker-session", 8001, 9001);
      const { route, deliveries, audits, setIdle } = createRoute(binding, true);

      await runtime.registerRoute(route);
      const firstRegistration = brokerMessages.find((message) => message.action === "registerRoute");
      expect(firstRegistration).toMatchObject({ protocolVersion: 1, channel: "telegram", pipeline: { protocolVersion: 1, channel: "telegram", action: "registerRoute" } });
      expect(firstRegistration?.route).toMatchObject({
        channel: "telegram",
        sessionKey: route.sessionKey,
        binding,
        busy: false,
        notification: { lastStatus: "idle" },
      });

      setIdle(false);
      route.notification.lastStatus = "running";
      route.lastActivityAt = Date.now();
      await runtime.registerRoute(route);
      const registrations = brokerMessages.filter((message) => message.action === "registerRoute");
      expect(registrations.at(-1)?.route).toMatchObject({
        channel: "telegram",
        sessionKey: route.sessionKey,
        busy: true,
        notification: { lastStatus: "running" },
      });

      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-deliver-1",
        protocolVersion: 1,
        channel: "telegram",
        pipeline: { protocolVersion: 1, channel: "telegram", action: "deliverPrompt" },
        action: "deliverPrompt",
        sessionKey: route.sessionKey,
        text: "remote follow-up from broker",
        deliverAs: "followUp",
        auditMessage: "Telegram @owner queued a follow-up.",
      })}\n`);

      await waitFor(() => clientResponses.some((message) => message.requestId === "broker-deliver-1"));
      expect(clientResponses.find((message) => message.requestId === "broker-deliver-1")?.ok).toBe(true);
      expect(deliveries).toEqual([{ text: "remote follow-up from broker", deliverAs: "followUp" }]);
      expect(audits).toEqual(["Telegram @owner queued a follow-up."]);

      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-invalid-version",
        protocolVersion: "1",
        channel: "telegram",
        action: "deliverPrompt",
        sessionKey: route.sessionKey,
        text: "should be rejected",
      })}\n`);
      await waitFor(() => clientResponses.some((message) => message.requestId === "broker-invalid-version"));
      expect(clientResponses.find((message) => message.requestId === "broker-invalid-version")).toMatchObject({ ok: false, error: "Invalid broker protocol version." });

      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-invalid-pipeline",
        protocolVersion: 1,
        channel: "telegram",
        pipeline: "1",
        action: "deliverPrompt",
        sessionKey: route.sessionKey,
        text: "should be rejected",
      })}\n`);
      await waitFor(() => clientResponses.some((message) => message.requestId === "broker-invalid-pipeline"));
      expect(clientResponses.find((message) => message.requestId === "broker-invalid-pipeline")).toMatchObject({ ok: false, error: "Invalid relay pipeline protocol version." });

      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-missing-pipeline-version",
        protocolVersion: 1,
        channel: "telegram",
        pipeline: {},
        action: "deliverPrompt",
        sessionKey: route.sessionKey,
        text: "should be rejected",
      })}\n`);
      await waitFor(() => clientResponses.some((message) => message.requestId === "broker-missing-pipeline-version"));
      expect(clientResponses.find((message) => message.requestId === "broker-missing-pipeline-version")).toMatchObject({ ok: false, error: "Invalid relay pipeline protocol version." });

      const multimodalContent = [
        { type: "text", text: "look at this" },
        { type: "image", data: Buffer.from("img").toString("base64"), mimeType: "image/png" },
      ];
      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-deliver-image",
        action: "deliverPrompt",
        sessionKey: route.sessionKey,
        content: multimodalContent,
        deliverAs: "steer",
        auditMessage: "Telegram @owner sent an image prompt.",
      })}\n`);

      await waitFor(() => clientResponses.some((message) => message.requestId === "broker-deliver-image"));
      expect(clientResponses.find((message) => message.requestId === "broker-deliver-image")?.ok).toBe(true);
      expect(deliveries.at(-1)).toEqual({ text: multimodalContent, deliverAs: "steer" });
      expect(audits.at(-1)).toBe("Telegram @owner sent an image prompt.");

      const latestImage = {
        id: "turn-1-1",
        turnId: "turn-1",
        fileName: "preview.png",
        mimeType: "image/png",
        data: Buffer.from([1]).toString("base64"),
        byteSize: 1,
      };
      route.actions.getLatestImages = async () => [latestImage];
      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-images-1",
        action: "getLatestImages",
        sessionKey: route.sessionKey,
      })}\n`);

      await waitFor(() => clientResponses.some((message) => message.requestId === "broker-images-1"));
      expect(clientResponses.find((message) => message.requestId === "broker-images-1")?.result).toEqual([latestImage]);

      route.actions.getImageByPath = async (path) => ({ ok: false, error: `blocked:${path}` });
      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-image-path-1",
        action: "getImageByPath",
        sessionKey: route.sessionKey,
        path: "../secret.png",
      })}\n`);
      await waitFor(() => clientResponses.some((message) => message.requestId === "broker-image-path-1"));
      expect(clientResponses.find((message) => message.requestId === "broker-image-path-1")?.result).toEqual({ ok: false, error: "blocked:../secret.png" });

      await runtime.unregisterRoute(route.sessionKey);
      expect(brokerMessages.some((message) => message.action === "unregisterRoute" && message.sessionKey === route.sessionKey)).toBe(true);
    } finally {
      await runtime.stop().catch(() => undefined);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("recovers remote delivery after Telegram disconnect and reconnect", async () => {
    const config = await createRuntimeConfig("pi-telegram-reconnect-");
    const store = new TunnelStateStore(config.stateDir);
    const runtime = new InProcessTunnelRuntime(config, store);
    const binding = createBinding("reconnect-session", 8101, 9101);
    const { route, deliveries, persisted } = createRoute(binding, true);
    await store.upsertBinding(binding);
    (runtime as any).routes.set(route.sessionKey, route);

    const sent: string[] = [];
    (runtime as any).api = {
      sendPlainText: async (_chatId: number, text: string) => sent.push(text),
      sendChatAction: async () => undefined,
    };

    await (runtime as any).processInbound({
      updateId: 1,
      messageId: 1,
      text: "/disconnect",
      chat: { id: binding.chatId, type: "private" },
      user: { id: binding.userId, username: binding.username },
    });

    expect(route.binding).toBeUndefined();
    expect(persisted.at(-1)).toEqual({ binding: null, revoked: true });
    expect((await store.getBindingBySessionKey(route.sessionKey))?.status).toBe("revoked");

    await (runtime as any).processInbound({
      updateId: 2,
      messageId: 2,
      text: "can you still hear me?",
      chat: { id: binding.chatId, type: "private" },
      user: { id: binding.userId, username: binding.username },
    });
    expect(sent.at(-1)).toContain("binding has been revoked");

    const { nonce } = await store.createPendingPairing({
      sessionId: route.sessionId,
      sessionFile: route.sessionFile,
      sessionLabel: route.sessionLabel,
      expiryMs: config.pairingExpiryMs,
    });

    await (runtime as any).processInbound({
      updateId: 3,
      messageId: 3,
      text: `/start ${nonce}`,
      chat: { id: binding.chatId, type: "private" },
      user: { id: binding.userId, username: binding.username },
    });

    expect(route.binding).toMatchObject({
      sessionKey: route.sessionKey,
      chatId: binding.chatId,
      userId: binding.userId,
      paused: false,
    });
    expect(persisted.at(-1)?.revoked).toBe(false);
    expect((await store.getBindingBySessionKey(route.sessionKey))?.status).toBe("active");
    expect(sent.at(-1)).toContain("Connected to Pi session");

    await (runtime as any).processInbound({
      updateId: 4,
      messageId: 4,
      text: "after reconnect prompt",
      chat: { id: binding.chatId, type: "private" },
      user: { id: binding.userId, username: binding.username },
    });

    expect(deliveries).toEqual([{ text: "after reconnect prompt", deliverAs: undefined }]);
  });
});
