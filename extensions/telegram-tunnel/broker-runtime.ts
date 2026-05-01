import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageFileLoadResult, LatestTurnImage, SessionRoute, SessionStatusSnapshot, SetupCache, TelegramBindingMetadata, TelegramPromptContent, TelegramTunnelConfig, TunnelRuntime } from "./types.js";
import { ensureStateDir } from "./paths.js";
import { relayRouteStateForRoute, statusSnapshotForRoute, type RelayRouteState } from "./relay-core.js";
import { sha256 } from "./utils.js";

const BROKER_PROTOCOL_VERSION = 1;
const BROKER_CHANNEL = "telegram" as const;

type BrokerRouteState = RelayRouteState;

interface BrokerProtocolRequest {
  type: "request";
  requestId: string;
  protocolVersion?: number;
  channel?: typeof BROKER_CHANNEL;
  action: string;
  [key: string]: unknown;
}

interface BrokerProtocolResponse {
  type: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export class BrokerTunnelRuntime implements TunnelRuntime {
  private readonly clientId = randomUUID();
  private readonly socketPath: string;
  private readonly routes = new Map<string, SessionRoute>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private socket?: Socket;
  private buffer = "";
  private connecting?: Promise<void>;
  private started = false;
  private setupCache?: SetupCache;

  constructor(private readonly config: TelegramTunnelConfig) {
    this.socketPath = resolve(config.stateDir, `broker-${sha256(config.botToken).slice(0, 16)}.sock`);
  }

  get setup(): SetupCache | undefined {
    return this.setupCache;
  }

  async start(): Promise<void> {
    this.started = true;
    await this.ensureConnected();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.rejectPending(new Error("Broker runtime stopped."));
    this.socket?.destroy();
    this.socket = undefined;
  }

  async ensureSetup(): Promise<SetupCache> {
    const setup = (await this.request("ensureSetup", {})) as SetupCache;
    this.setupCache = setup;
    return setup;
  }

  async registerRoute(route: SessionRoute): Promise<void> {
    this.routes.set(route.sessionKey, route);
    await this.request("registerRoute", {
      clientId: this.clientId,
      route: this.serializeRoute(route),
    });
  }

  async unregisterRoute(sessionKey: string): Promise<void> {
    this.routes.delete(sessionKey);
    await this.request("unregisterRoute", { clientId: this.clientId, sessionKey });
    if (this.routes.size === 0) {
      await this.stop();
    }
  }

  getStatus(sessionKey: string): SessionStatusSnapshot | undefined {
    const route = this.routes.get(sessionKey);
    if (!route) return undefined;
    return statusSnapshotForRoute(route, { online: true, busy: !route.actions.context.isIdle() });
  }

  async sendToBoundChat(sessionKey: string, text: string): Promise<void> {
    await this.request("sendToBoundChat", { sessionKey, text });
  }

  private serializeRoute(route: SessionRoute): BrokerRouteState {
    return relayRouteStateForRoute(route, { channel: BROKER_CHANNEL, busy: !route.actions.context.isIdle() });
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      await ensureStateDir(this.config.stateDir);
      try {
        await this.connectSocket();
      } catch {
        await this.spawnBroker();
        await this.waitForSocketReady();
        await this.connectSocket();
      }
      await this.resyncRoutes();
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connectSocket(): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const socket = createConnection(this.socketPath);
      const onError = (error: Error) => {
        socket.destroy();
        rejectPromise(error);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        this.attachSocket(socket);
        resolvePromise();
      });
    });
  }

  private attachSocket(socket: Socket): void {
    this.socket = socket;
    this.buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newlineIndex = this.buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          void this.handleMessage(line);
        }
        newlineIndex = this.buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      this.rejectPending(new Error("Broker connection closed."));
    });
    socket.on("error", () => {
      // close handler covers recovery
    });
  }

  private async handleMessage(line: string): Promise<void> {
    const message = JSON.parse(line) as BrokerProtocolRequest | BrokerProtocolResponse;
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "Broker request failed."));
      return;
    }

    const request = message;
    const respond = async (payload: { ok: boolean; result?: unknown; error?: string }) => {
      this.writeMessage({
        type: "response",
        requestId: request.requestId,
        ok: payload.ok,
        result: payload.result,
        error: payload.error,
      });
    };

    try {
      const sessionKey = String(request.sessionKey ?? "");
      const route = this.routes.get(sessionKey);
      if (!route) {
        await respond({ ok: false, error: `Unknown session route: ${sessionKey}` });
        return;
      }

      switch (request.action) {
        case "confirmPairing": {
          const identity = request.identity as Parameters<SessionRoute["actions"]["promptLocalConfirmation"]>[0];
          const approved = await route.actions.promptLocalConfirmation(identity);
          await respond({ ok: true, result: approved });
          return;
        }
        case "persistBinding": {
          const binding = (request.binding as TelegramBindingMetadata | null | undefined) ?? null;
          const revoked = Boolean(request.revoked);
          route.binding = binding ?? undefined;
          route.actions.persistBinding(binding, revoked);
          await respond({ ok: true });
          return;
        }
        case "appendAudit": {
          route.actions.appendAudit(String(request.message ?? "Telegram action"));
          await respond({ ok: true });
          return;
        }
        case "deliverPrompt": {
          const content = Array.isArray(request.content)
            ? request.content as TelegramPromptContent
            : String(request.text ?? "");
          const deliverAs = request.deliverAs as "steer" | "followUp" | undefined;
          route.actions.sendUserMessage(content, deliverAs ? { deliverAs } : undefined);
          if (typeof request.auditMessage === "string" && request.auditMessage) {
            route.actions.appendAudit(request.auditMessage);
          }
          await respond({ ok: true });
          return;
        }
        case "getLatestImages": {
          const images: LatestTurnImage[] = await route.actions.getLatestImages();
          await respond({ ok: true, result: images });
          return;
        }
        case "getImageByPath": {
          const result: ImageFileLoadResult = await route.actions.getImageByPath(String(request.path ?? ""));
          await respond({ ok: true, result });
          return;
        }
        case "abort": {
          route.notification.abortRequested = true;
          route.actions.abort();
          if (typeof request.auditMessage === "string" && request.auditMessage) {
            route.actions.appendAudit(request.auditMessage);
          }
          await respond({ ok: true });
          return;
        }
        case "compact": {
          await route.actions.compact();
          if (typeof request.auditMessage === "string" && request.auditMessage) {
            route.actions.appendAudit(request.auditMessage);
          }
          await respond({ ok: true });
          return;
        }
        default:
          await respond({ ok: false, error: `Unknown broker action: ${request.action}` });
      }
    } catch (error) {
      await respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async request(action: string, payload: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    return this.requestOnce(action, payload).catch(async (error) => {
      this.socket?.destroy();
      this.socket = undefined;
      await this.ensureConnected();
      return this.requestOnce(action, payload, error instanceof Error ? error : undefined);
    });
  }

  private async requestOnce(action: string, payload: Record<string, unknown>, previousError?: Error): Promise<unknown> {
    if (!this.socket || this.socket.destroyed) {
      throw previousError ?? new Error("Broker connection unavailable.");
    }

    const requestId = randomUUID();
    const message: BrokerProtocolRequest = { type: "request", requestId, protocolVersion: BROKER_PROTOCOL_VERSION, channel: BROKER_CHANNEL, action, ...payload };
    const result = new Promise<unknown>((resolvePromise, rejectPromise) => {
      this.pending.set(requestId, { resolve: resolvePromise, reject: rejectPromise });
    });
    this.writeMessage(message);
    return result;
  }

  private writeMessage(message: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error("Broker socket is not connected.");
    }
    socket.write(`${JSON.stringify(message)}\n`);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async resyncRoutes(): Promise<void> {
    for (const route of this.routes.values()) {
      await this.requestOnce("registerRoute", {
        clientId: this.clientId,
        route: this.serializeRoute(route),
      });
    }
  }

  private async spawnBroker(): Promise<void> {
    const brokerPath = fileURLToPath(new URL("./broker.js", import.meta.url));
    spawn(process.execPath, [brokerPath], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify(this.config),
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: this.socketPath,
      },
    }).unref();
  }

  private async waitForSocketReady(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        await this.connectSocket();
        this.socket?.destroy();
        this.socket = undefined;
        return;
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
      }
    }
    throw new Error("Telegram tunnel broker did not start in time.");
  }
}
