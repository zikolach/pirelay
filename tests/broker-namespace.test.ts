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

    await runtime.registerRoute(route("docs-session"));
    expect(firstMessages.map((message) => message.action)).toContain("registerRoute");

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

    await runtime.stop();
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

async function listenJsonBroker(path: string, messages: Array<Record<string, unknown>>): Promise<Server> {
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
          socket.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: true })}\n`);
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
