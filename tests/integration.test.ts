import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerTunnelRuntime } from "../extensions/telegram-tunnel/broker-runtime.js";
import { InProcessTunnelRuntime } from "../extensions/telegram-tunnel/runtime.js";
import { TunnelStateStore } from "../extensions/telegram-tunnel/state-store.js";
import type { SessionRoute, TelegramBindingMetadata, TelegramPromptContent, TelegramTunnelConfig, TunnelRuntime } from "../extensions/telegram-tunnel/types.js";

const tempDirs: string[] = [];

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
  vi.doUnmock("../extensions/telegram-tunnel/runtime.js");
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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

function createMockPi() {
  const commands = new Map<string, { handler: (args: string, ctx: any) => void | Promise<void> }>();
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

  commands.set("skill:telegram-tunnel", {
    handler: async () => {
      skillInvocations.push("telegram-tunnel");
    },
  });

  return {
    api,
    commands,
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

describe("Telegram tunnel integration behavior", () => {
  it("keeps local prompts and skill commands usable after connect, pairing, and route sync", async () => {
    const config = await createRuntimeConfig("pi-telegram-extension-");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", config.botToken);
    vi.stubEnv("PI_TELEGRAM_TUNNEL_STATE_DIR", config.stateDir);

    const registeredRoutes = new Map<string, SessionRoute>();
    let blockFutureRouteSync = false;
    let blockedRouteSyncAttempts = 0;
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
          await new Promise<void>(() => undefined);
        }
      }),
      unregisterRoute: vi.fn(async (sessionKey: string) => {
        registeredRoutes.delete(sessionKey);
      }),
      getStatus: vi.fn(() => undefined),
      sendToBoundChat: vi.fn(async () => undefined),
    };

    vi.doMock("../extensions/telegram-tunnel/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: telegramTunnelExtension } = await import("../extensions/telegram-tunnel/index.js");
    const pi = createMockPi();
    const { context, branch, setIdle } = createMockContext("local-after-pairing");
    telegramTunnelExtension(pi.api as any);

    await pi.runCommand("telegram-tunnel", "connect", context);
    const route = [...registeredRoutes.values()][0];
    expect(route).toBeDefined();

    const binding = createBinding(route!.sessionId, 7001, 9001);
    binding.sessionKey = route!.sessionKey;
    binding.sessionFile = route!.sessionFile;
    binding.sessionLabel = route!.sessionLabel;
    route!.binding = binding;
    route!.actions.persistBinding(binding, false);
    route!.actions.appendAudit("Telegram tunnel paired with @owner.");
    branch.push(...pi.appendedEntries);

    blockFutureRouteSync = true;
    setIdle(false);
    await Promise.race([
      pi.submitLocalPrompt("local prompt still works after Telegram pairing", context),
      new Promise((_, reject) => setTimeout(() => reject(new Error("local prompt was blocked by route sync")), 100)),
    ]);
    await Promise.race([
      pi.runCommand("skill:telegram-tunnel", "", context),
      new Promise((_, reject) => setTimeout(() => reject(new Error("skill command was blocked after pairing")), 100)),
    ]);

    expect(pi.localPrompts).toEqual(["local prompt still works after Telegram pairing"]);
    expect(pi.skillInvocations).toEqual(["telegram-tunnel"]);
    expect(blockedRouteSyncAttempts).toBeGreaterThan(0);
    expect(pi.sentMessages.map((message) => message.customType)).toContain("telegram-tunnel-audit");
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

    vi.doMock("../extensions/telegram-tunnel/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: telegramTunnelExtension } = await import("../extensions/telegram-tunnel/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("explicit-label-session");
    telegramTunnelExtension(pi.api as any);

    await pi.runCommand("telegram-tunnel", "connect docs team", context);
    const route = [...registeredRoutes.values()][0];
    expect(route?.sessionLabel).toBe("docs team");

    const store = new TunnelStateStore(config.stateDir);
    const pending = Object.values((await store.load()).pendingPairings)[0];
    expect(pending?.sessionLabel).toBe("docs team");
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

    vi.doMock("../extensions/telegram-tunnel/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: telegramTunnelExtension } = await import("../extensions/telegram-tunnel/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("local-image-tracking");
    telegramTunnelExtension(pi.api as any);

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
  });

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

    vi.doMock("../extensions/telegram-tunnel/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: telegramTunnelExtension } = await import("../extensions/telegram-tunnel/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("local-file-image-tracking");
    context.cwd = workspace;
    telegramTunnelExtension(pi.api as any);

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
  });

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

    vi.doMock("../extensions/telegram-tunnel/runtime.js", () => ({
      getOrCreateTunnelRuntime: () => fakeRuntime,
      sendSessionNotification: vi.fn(async () => undefined),
    }));

    const { default: telegramTunnelExtension } = await import("../extensions/telegram-tunnel/index.js");
    const pi = createMockPi();
    const { context } = createMockContext("local-missing-file-image-tracking");
    context.cwd = workspace;
    telegramTunnelExtension(pi.api as any);

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
  });

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
      expect(firstRegistration?.route).toMatchObject({
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
        sessionKey: route.sessionKey,
        busy: true,
        notification: { lastStatus: "running" },
      });

      sockets[0]!.write(`${JSON.stringify({
        type: "request",
        requestId: "broker-deliver-1",
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
