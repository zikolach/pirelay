import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BrokerTunnelRuntime } from "../extensions/relay/broker/tunnel-runtime.js";
import type { SessionRoute, TelegramTunnelConfig } from "../extensions/relay/core/types.js";

const dirs: string[] = [];
const runtimes: BrokerTunnelRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop().catch(() => undefined)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("shared broker restart convergence", () => {
  it("repairs a missing route while the owning client socket remains connected", async () => {
    const stateDir = await mkdtemp(join(tmpdir().length <= 40 ? tmpdir() : "/tmp", "pirelay-broker-route-repair-"));
    dirs.push(stateDir);
    const previousSkip = process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING;
    process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING = "1";
    try {
      const config = testConfig(stateDir);
      const target = new BrokerTunnelRuntime(config, { reconciliationIntervalMs: 25 });
      const keeper = new BrokerTunnelRuntime(config, { reconciliationIntervalMs: 25 });
      runtimes.push(target, keeper);
      await Promise.all([target.start(), keeper.start()]);
      await target.registerRoute(route("target-session"));
      await keeper.registerRoute(route("keeper-session"));
      const socketPath = (target as unknown as { socketPath: string }).socketPath;
      const thief = await openClient(socketPath);
      await thief.request({ type: "request", action: "reconcileRoutes", clientId: "replacement", routes: [serializedRoute("target-session")] });
      await thief.close();

      await waitFor(async () => {
        const observer = await openClient(socketPath);
        try {
          const health = await observer.request({ type: "request", action: "getBrokerHealth" }) as { registeredRouteCount?: number };
          return health.registeredRouteCount === 2;
        } finally {
          await observer.close();
        }
      });
      expect(target.getBrokerSynchronizationState()).toMatchObject({ transport: "connected", routes: { "target-session": "synchronized" } });
    } finally {
      if (previousSkip === undefined) delete process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING;
      else process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING = previousSkip;
    }
  }, 20_000);

  it("reports bounded partial convergence when an expected client exits", async () => {
    const stateDir = await mkdtemp(join(tmpdir().length <= 40 ? tmpdir() : "/tmp", "pirelay-broker-partial-"));
    dirs.push(stateDir);
    const previousSkip = process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING;
    process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING = "1";
    try {
      const config = testConfig(stateDir);
      const initiator = new BrokerTunnelRuntime(config, { reconciliationIntervalMs: 25, restartConvergenceTimeoutMs: 300 });
      const exiting = new BrokerTunnelRuntime(config, { reconciliationIntervalMs: 25 });
      runtimes.push(initiator, exiting);
      await Promise.all([initiator.start(), exiting.start()]);
      await initiator.registerRoute(route("remaining-session"));
      await exiting.registerRoute(route("exiting-session"));

      const restarting = initiator.restartBrokerProcess();
      await new Promise((resolve) => setTimeout(resolve, 30));
      await exiting.stop();
      const result = await restarting;

      expect(result).toMatchObject({ status: "partial-timeout", expectedClientCount: 2, connectedClientCount: 1, registeredRouteCount: 1 });
      expect(initiator.getBrokerSynchronizationState().routes["remaining-session"]).toBe("synchronized");
    } finally {
      if (previousSkip === undefined) delete process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING;
      else process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING = previousSkip;
    }
  }, 20_000);

  it("recovers three clients and routes without private reconnect helpers", async () => {
    const stateDir = await mkdtemp(join(tmpdir().length <= 40 ? tmpdir() : "/tmp", "pirelay-broker-convergence-"));
    dirs.push(stateDir);
    const previousSkip = process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING;
    process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING = "1";
    try {
      const config = testConfig(stateDir);
      const clients = [0, 1, 2].map(() => new BrokerTunnelRuntime(config, { reconciliationIntervalMs: 25 }));
      runtimes.push(...clients);
      await Promise.all(clients.map((client) => client.start()));
      await Promise.all(clients.map((client, index) => client.registerRoute(route(`session-${index + 1}`))));

      const restarting = clients[0]!.restartBrokerProcess();
      const concurrent = await clients[0]!.restartBrokerProcess();
      const result = await restarting;

      expect(concurrent).toMatchObject({ status: "in-progress" });
      expect(result).toMatchObject({ status: "complete", expectedClientCount: 3, connectedClientCount: 3, registeredRouteCount: 3 });
      await waitFor(async () => clients.every((client, index) => client.getBrokerSynchronizationState().routes[`session-${index + 1}`] === "synchronized"));
      for (let index = 0; index < clients.length; index += 1) {
        expect(clients[index]!.getBrokerSynchronizationState()).toMatchObject({
          transport: "connected",
          routes: { [`session-${index + 1}`]: "synchronized" },
        });
      }
      const pidPath = (clients[0] as unknown as { pidPath: string }).pidPath;
      const pid = Number((await readFile(pidPath, "utf8")).trim());
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
    } finally {
      if (previousSkip === undefined) delete process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING;
      else process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING = previousSkip;
    }
  }, 20_000);
});

function route(sessionKey: string): SessionRoute {
  return {
    sessionKey,
    sessionId: sessionKey,
    sessionLabel: sessionKey,
    notification: { lastStatus: "idle" },
    actions: {
      context: { isIdle: () => true } as never,
      getModel: () => undefined,
      sendUserMessage: () => undefined,
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "not-found" }),
      appendAudit: () => undefined,
      persistBinding: () => undefined,
      promptLocalConfirmation: async () => true,
      abort: () => undefined,
      compact: async () => undefined,
    },
  };
}

function testConfig(stateDir: string): TelegramTunnelConfig {
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

function serializedRoute(sessionKey: string): Record<string, unknown> {
  return { channel: "telegram", sessionKey, sessionId: sessionKey, sessionLabel: sessionKey, busy: false, notification: {} };
}

async function openClient(socketPath: string): Promise<{ request(payload: Record<string, unknown>): Promise<unknown>; close(): Promise<void> }> {
  const socket = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  socket.setEncoding("utf8");
  let buffer = "";
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line) as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: string };
        if (message.type === "request" && message.requestId) {
          socket.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: true })}\n`);
        } else if (message.requestId) {
          const waiter = pending.get(message.requestId);
          if (waiter) {
            pending.delete(message.requestId);
            if (message.ok) waiter.resolve(message.result);
            else waiter.reject(new Error(message.error ?? "Broker request failed."));
          }
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  return {
    request(payload) {
      const requestId = `${Date.now()}-${Math.random()}`;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.write(`${JSON.stringify({ ...payload, requestId })}\n`);
      });
    },
    close() {
      if (socket.destroyed) return Promise.resolve();
      return new Promise((resolve) => { socket.once("close", resolve); socket.end(); });
    },
  };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for broker route repair.");
}
