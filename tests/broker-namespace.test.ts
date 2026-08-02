import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerTunnelRuntime } from "../extensions/relay/broker/tunnel-runtime.js";
import type { SessionRoute, TelegramTunnelConfig } from "../extensions/relay/core/types.js";

const tempDirs: string[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
const STALE_EXTENSION_ERROR = "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().";

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("broker namespace isolation", () => {
  it("keeps default socket naming unchanged and scopes namespaced clients", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-namespace-"));
    tempDirs.push(stateDir);
    const base = config(stateDir);

    const defaultRuntime = new BrokerTunnelRuntime(base);
    const alphaRuntime = new BrokerTunnelRuntime({ ...base, brokerNamespace: "alpha" });
    const betaRuntime = new BrokerTunnelRuntime({ ...base, brokerNamespace: "beta" });

    expect(socketPath(defaultRuntime)).toBe(join(stateDir, "broker-5c86c8f7d9db9ca4.sock"));
    expect(socketPath(alphaRuntime)).toBe(join(stateDir, "broker-alpha-5c86c8f7d9db9ca4.sock"));
    expect(socketPath(betaRuntime)).toBe(join(stateDir, "broker-beta-5c86c8f7d9db9ca4.sock"));
  });

  it("resyncs registered routes when the broker socket is recreated", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-reconnect-"));
    tempDirs.push(stateDir);
    const runtime = new BrokerTunnelRuntime(config(stateDir));
    const firstMessages: Array<Record<string, unknown>> = [];
    const firstServer = await listenJsonBroker(socketPath(runtime), firstMessages);
    const docsRoute = route("docs-session");
    docsRoute.actions.clearLocalStatus = vi.fn();

    await runtime.registerRoute(docsRoute);
    expect(firstMessages.map((message) => message.action)).toContain("registerRoute");
    vi.mocked(docsRoute.actions.clearLocalStatus).mockClear();

    for (const socket of sockets.splice(0)) socket.destroy();
    (runtime as unknown as { socket?: Socket }).socket?.destroy();
    (runtime as unknown as { socket?: Socket }).socket = undefined;
    await closeServer(firstServer);
    await rm(socketPath(runtime), { force: true });

    const secondMessages: Array<Record<string, unknown>> = [];
    await listenJsonBroker(socketPath(runtime), secondMessages);
    await (runtime as unknown as { ensureConnected(): Promise<void> }).ensureConnected();

    await waitForCondition(() => secondMessages.some((message) => message.action === "registerRoute"));
    expect(secondMessages.some((message) => (message.route as { sessionKey?: string } | undefined)?.sessionKey === "docs-session")).toBe(true);
    expect(docsRoute.actions.clearLocalStatus).toHaveBeenCalledWith("relay-sync");

    await runtime.stop();
  });

  it("periodically reconciles live routes without a local command", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-periodic-"));
    tempDirs.push(stateDir);
    const messages: Array<Record<string, unknown>> = [];
    const runtime = new BrokerTunnelRuntime(config(stateDir), { reconciliationIntervalMs: 20 });
    await listenJsonBroker(socketPath(runtime), messages);

    await runtime.start();
    await runtime.registerRoute(route("periodic-session"));
    const initialCount = messages.filter((message) => message.action === "reconcileRoutes").length;

    await waitForCondition(() => messages.filter((message) => message.action === "reconcileRoutes").length > initialCount);
    await new Promise((resolve) => setTimeout(resolve, 30));

    await runtime.stop();
    const stoppedCount = messages.filter((message) => message.action === "reconcileRoutes").length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messages.filter((message) => message.action === "reconcileRoutes")).toHaveLength(stoppedCount);
  });

  it("autonomously reconnects and republishes routes after socket loss", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-autonomous-reconnect-"));
    tempDirs.push(stateDir);
    const firstMessages: Array<Record<string, unknown>> = [];
    const runtime = new BrokerTunnelRuntime(config(stateDir), { reconciliationIntervalMs: 20 });
    const firstServer = await listenJsonBroker(socketPath(runtime), firstMessages);
    await runtime.start();
    await runtime.registerRoute(route("autonomous-session"));

    for (const socket of sockets.splice(0)) socket.destroy();
    await closeServer(firstServer);
    await rm(socketPath(runtime), { force: true });
    const recoveredMessages: Array<Record<string, unknown>> = [];
    await listenJsonBroker(socketPath(runtime), recoveredMessages);

    await waitForCondition(() => recoveredMessages.some((message) => message.action === "registerRoute") && runtime.getBrokerSynchronizationState().routes["autonomous-session"] === "synchronized", 3_000);
    expect(runtime.getBrokerSynchronizationState()).toMatchObject({ transport: "connected", routes: { "autonomous-session": "synchronized" } });
    await runtime.stop();
  });

  it("keeps routes pending until delayed acknowledgement and resets them for a new epoch", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-epoch-"));
    tempDirs.push(stateDir);
    const messages: Array<Record<string, unknown>> = [];
    const broker = { brokerEpoch: "epoch-1", reconciliationDelayMs: 30 };
    const runtime = new BrokerTunnelRuntime(config(stateDir));
    await listenJsonBroker(socketPath(runtime), messages, broker);
    const pendingRegistration = runtime.registerRoute(route("epoch-session"));
    expect(runtime.getBrokerSynchronizationState().routes["epoch-session"]).toBe("pending");
    await pendingRegistration;
    expect(runtime.getBrokerSynchronizationState()).toMatchObject({ brokerEpoch: "epoch-1", routes: { "epoch-session": "synchronized" } });

    broker.brokerEpoch = "epoch-2";
    const pendingEpoch = runtime.reconcileBrokerRoutes();
    expect(runtime.getBrokerSynchronizationState().routes["epoch-session"]).toBe("pending");
    await pendingEpoch;
    expect(runtime.getBrokerSynchronizationState()).toMatchObject({ brokerEpoch: "epoch-2", routes: { "epoch-session": "synchronized" } });
    await runtime.stop();
  });

  it("falls back to legacy registration when an existing broker lacks reconciliation", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-legacy-reconcile-"));
    tempDirs.push(stateDir);
    const runtime = new BrokerTunnelRuntime(config(stateDir));
    const messages: Array<Record<string, unknown>> = [];
    await listenJsonBroker(socketPath(runtime), messages, { rejectReconciliation: true });

    await runtime.start();
    await runtime.registerRoute(route("legacy-session"));

    expect(messages.some((message) => message.action === "reconcileRoutes")).toBe(true);
    expect(messages.filter((message) => message.action === "reconcileRoutes")).toHaveLength(1);
    expect(messages.some((message) => message.action === "registerRoute" && (message.route as { sessionKey?: string } | undefined)?.sessionKey === "legacy-session")).toBe(true);
    expect(runtime.getBrokerSynchronizationState()).toMatchObject({ routes: { "legacy-session": "synchronized" } });
    await runtime.stop();
  });

  it("re-registers routes from multiple clients after broker socket recovery", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-multi-reconnect-"));
    tempDirs.push(stateDir);
    const firstRuntime = new BrokerTunnelRuntime(config(stateDir));
    const secondRuntime = new BrokerTunnelRuntime(config(stateDir));
    const firstMessages: Array<Record<string, unknown>> = [];
    const firstServer = await listenJsonBroker(socketPath(firstRuntime), firstMessages);
    const firstRoute = route("first-session");
    const secondRoute = route("second-session");

    await firstRuntime.registerRoute(firstRoute);
    await secondRuntime.registerRoute(secondRoute);
    expect(firstMessages.filter((message) => message.action === "registerRoute").length).toBeGreaterThanOrEqual(2);

    for (const socket of sockets.splice(0)) socket.destroy();
    (firstRuntime as unknown as { socket?: Socket }).socket?.destroy();
    (firstRuntime as unknown as { socket?: Socket }).socket = undefined;
    (secondRuntime as unknown as { socket?: Socket }).socket?.destroy();
    (secondRuntime as unknown as { socket?: Socket }).socket = undefined;
    await closeServer(firstServer);
    await rm(socketPath(firstRuntime), { force: true });

    const secondMessages: Array<Record<string, unknown>> = [];
    await listenJsonBroker(socketPath(firstRuntime), secondMessages);
    await Promise.all([
      (firstRuntime as unknown as { ensureConnected(): Promise<void> }).ensureConnected(),
      (secondRuntime as unknown as { ensureConnected(): Promise<void> }).ensureConnected(),
    ]);

    await waitForCondition(() => secondMessages.filter((message) => message.action === "registerRoute").length >= 2);
    expect(secondMessages.some((message) => (message.route as { sessionKey?: string } | undefined)?.sessionKey === "first-session")).toBe(true);
    expect(secondMessages.some((message) => (message.route as { sessionKey?: string } | undefined)?.sessionKey === "second-session")).toBe(true);

    await firstRuntime.stop();
    await secondRuntime.stop();
  });

  it("tracks reconciliation rejection without failing the live runtime", () => {
    const runtime = new BrokerTunnelRuntime(config("/tmp/pirelay-reconciliation-rejection"));
    const rejectedRoute = route("rejected-session");
    (runtime as unknown as { routes: Map<string, SessionRoute> }).routes.set(rejectedRoute.sessionKey, rejectedRoute);

    expect(() => (runtime as unknown as { applyReconciliationResponse(value: unknown): boolean }).applyReconciliationResponse({
      brokerEpoch: "epoch-1",
      acceptedSessionKeys: [],
      rejected: [{ index: 0, code: "invalid-request", safeMessage: "Invalid route." }],
    })).not.toThrow();
    expect(runtime.getBrokerSynchronizationState()).toMatchObject({ routes: { "rejected-session": "rejected" } });
  });

  it("does not connect or spawn a broker only to unregister the final route", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-final-unregister-"));
    tempDirs.push(stateDir);
    const runtime = new BrokerTunnelRuntime(config(stateDir));
    const finalRoute = route("final-session");
    (runtime as unknown as { routes: Map<string, SessionRoute> }).routes.set(finalRoute.sessionKey, finalRoute);
    const ensureConnected = vi.fn(async () => { throw new Error("must not connect"); });
    (runtime as unknown as { ensureConnected(): Promise<void> }).ensureConnected = ensureConnected;

    await runtime.unregisterRoute(finalRoute.sessionKey);

    expect(ensureConnected).not.toHaveBeenCalled();
  });

  it("bridges stale skill command lookups as an empty metadata list", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-skills-"));
    tempDirs.push(stateDir);
    const runtime = new BrokerTunnelRuntime(config(stateDir));
    const staleRoute = route("stale-skills-session");
    staleRoute.actions.getSkillCommands = () => { throw new Error(STALE_EXTENSION_ERROR); };
    (runtime as unknown as { routes: Map<string, SessionRoute> }).routes.set(staleRoute.sessionKey, staleRoute);
    const responses: Array<Record<string, unknown>> = [];
    (runtime as unknown as { writeMessage(message: Record<string, unknown>): void }).writeMessage = (message) => { responses.push(message); };

    await (runtime as unknown as { handleMessage(line: string): Promise<void> }).handleMessage(JSON.stringify({
      type: "request",
      requestId: "skills-1",
      protocolVersion: 1,
      action: "getSkillCommands",
      sessionKey: staleRoute.sessionKey,
    }));

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ type: "response", requestId: "skills-1", ok: true, result: [] });
  });

  it("does not share route registration or delivery across namespace sockets", async () => {
    const stateDir = await mkdtemp(join(shortSocketTmpdir(), "pirelay-broker-namespace-"));
    tempDirs.push(stateDir);
    const alphaRuntime = new BrokerTunnelRuntime({ ...config(stateDir), brokerNamespace: "alpha" });
    const betaRuntime = new BrokerTunnelRuntime({ ...config(stateDir), brokerNamespace: "beta" });
    const alphaMessages: Array<Record<string, unknown>> = [];
    const betaMessages: Array<Record<string, unknown>> = [];
    await listenJsonBroker(socketPath(alphaRuntime), alphaMessages);
    await listenJsonBroker(socketPath(betaRuntime), betaMessages);

    await alphaRuntime.registerRoute(route("alpha-session"));
    await betaRuntime.registerRoute(route("beta-session"));
    await alphaRuntime.sendToBoundChat("alpha-session", "alpha done");
    await betaRuntime.sendToBoundChat("beta-session", "beta done");

    expect(alphaMessages.map((message) => message.action)).toContain("registerRoute");
    expect(alphaMessages.map((message) => message.action)).toContain("sendToBoundChat");
    expect(betaMessages.map((message) => message.action)).toContain("registerRoute");
    expect(betaMessages.map((message) => message.action)).toContain("sendToBoundChat");
    expect(alphaMessages.every((message) => message.sessionKey !== "beta-session" && (message.route as { sessionKey?: string } | undefined)?.sessionKey !== "beta-session")).toBe(true);
    expect(betaMessages.every((message) => message.sessionKey !== "alpha-session" && (message.route as { sessionKey?: string } | undefined)?.sessionKey !== "alpha-session")).toBe(true);

    await alphaRuntime.stop();
    await betaRuntime.stop();
  });
});

function socketPath(runtime: BrokerTunnelRuntime): string {
  return (runtime as unknown as { socketPath: string }).socketPath;
}

async function listenJsonBroker(path: string, messages: Array<Record<string, unknown>>, options: { rejectReconciliation?: boolean; brokerEpoch?: string; reconciliationDelayMs?: number } = {}): Promise<Server> {
  const server = createServer((socket) => {
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
          const message = JSON.parse(line) as Record<string, unknown>;
          messages.push(message);
          const unsupported = options.rejectReconciliation && message.action === "reconcileRoutes";
          const result = message.action === "reconcileRoutes" && options.brokerEpoch
            ? { brokerEpoch: options.brokerEpoch, acceptedSessionKeys: (message.routes as Array<{ sessionKey: string }> | undefined)?.map((route) => route.sessionKey) ?? [], rejected: [] }
            : undefined;
          const respond = () => socket.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: !unsupported, result, error: unsupported ? "Unknown client action: reconcileRoutes" : undefined })}\n`);
          if (message.action === "reconcileRoutes" && options.reconciliationDelayMs) setTimeout(respond, options.reconciliationDelayMs);
          else respond();
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

function closeServer(server: Server): Promise<void> {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
}

function config(stateDir: string): TelegramTunnelConfig {
  return {
    botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
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
    maxInboundImageBytes: 1024,
    maxOutboundImageBytes: 1024,
    maxLatestImages: 4,
    allowedImageMimeTypes: ["image/png"],
  };
}

function route(sessionKey: string): SessionRoute {
  return {
    sessionKey,
    sessionId: sessionKey,
    sessionLabel: sessionKey,
    notification: { lastStatus: "idle" },
    actions: {
      context: { isIdle: () => true } as never,
      getModel: () => undefined,
      sendUserMessage: vi.fn(),
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "not-found" }),
      appendAudit: vi.fn(),
      persistBinding: vi.fn(),
      promptLocalConfirmation: async () => true,
      abort: vi.fn(),
      compact: vi.fn(async () => undefined),
    },
  };
}

function shortSocketTmpdir(): string {
  const candidate = tmpdir();
  // macOS often returns a long /var/folders path that exceeds Unix socket path
  // limits once the broker socket basename is appended. Prefer the platform
  // temp dir when it is short enough; otherwise use the standard short symlink.
  return candidate.length <= 40 ? candidate : "/tmp";
}
