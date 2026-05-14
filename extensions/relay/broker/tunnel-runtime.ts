import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageFileLoadResult, LatestTurnImage, SessionRoute, SessionStatusSnapshot, SetupCache, TelegramBindingMetadata, TelegramPromptContent, TelegramTunnelConfig, TunnelRuntime } from "../core/types.js";
import { TelegramChannelAdapter } from "../adapters/telegram/adapter.js";
import { deliverWorkspaceFileToRequester, formatRequesterFileDeliveryResult, type RelayFileDeliveryRequester } from "../core/requester-file-delivery.js";
import { ensureStateDir } from "../state/paths.js";
import { relayRouteStateForRoute, statusSnapshotForRoute, type RelayRouteState } from "../core/relay-core.js";
import { relayPipelineProtocolVersion } from "../middleware/pipeline.js";
import { sha256 } from "../core/utils.js";
import { normalizeBrokerNamespace } from "./supervisor.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relayPipelineProtocolError(pipeline: unknown): string | undefined {
  if (pipeline === undefined) return undefined;
  if (!isRecord(pipeline) || typeof pipeline.protocolVersion !== "number") {
    return "Invalid relay pipeline protocol version.";
  }
  return pipeline.protocolVersion === relayPipelineProtocolVersion
    ? undefined
    : `Unsupported relay pipeline protocol version: ${pipeline.protocolVersion}`;
}

export class BrokerTunnelRuntime implements TunnelRuntime {
  private readonly clientId = randomUUID();
  private readonly socketPath: string;
  private readonly pidPath: string;
  private readonly brokerNamespace?: string;
  private readonly routes = new Map<string, SessionRoute>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private socket?: Socket;
  private buffer = "";
  private connecting?: Promise<void>;
  private started = false;
  private setupCache?: SetupCache;

  constructor(private readonly config: TelegramTunnelConfig) {
    this.brokerNamespace = normalizeBrokerNamespace(config.brokerNamespace ?? process.env.PI_RELAY_BROKER_NAMESPACE);
    const tokenHash = sha256(config.botToken).slice(0, 16);
    const brokerName = this.brokerNamespace ? `broker-${this.brokerNamespace}-${tokenHash}` : `broker-${tokenHash}`;
    this.socketPath = resolve(config.stateDir, `${brokerName}.sock`);
    this.pidPath = resolve(config.stateDir, `${brokerName}.pid`);
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
      if ("protocolVersion" in request && typeof request.protocolVersion !== "number") {
        await respond({ ok: false, error: "Invalid broker protocol version." });
        return;
      }
      if (typeof request.protocolVersion === "number" && request.protocolVersion !== BROKER_PROTOCOL_VERSION) {
        await respond({ ok: false, error: `Unsupported broker protocol version: ${request.protocolVersion}` });
        return;
      }
      const pipelineProtocolError = relayPipelineProtocolError(request.pipeline);
      if (pipelineProtocolError) {
        await respond({ ok: false, error: pipelineProtocolError });
        return;
      }

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
          if (isRecord(request.requester)) route.remoteRequester = request.requester as unknown as RelayFileDeliveryRequester;
          route.actions.sendUserMessage(content, deliverAs ? { deliverAs } : undefined);
          if (typeof request.auditMessage === "string" && request.auditMessage) {
            route.actions.appendAudit(request.auditMessage);
          }
          await respond({ ok: true });
          return;
        }
        case "sendRequesterFile": {
          if (!isRecord(request.requester)) {
            await respond({ ok: false, error: "Missing requester context." });
            return;
          }
          const requester = request.requester as unknown as RelayFileDeliveryRequester;
          route.remoteRequester = requester;
          const adapter = new TelegramChannelAdapter(this.config);
          const result = await deliverWorkspaceFileToRequester({
            route,
            requester,
            adapter,
            workspaceRoot: route.actions.context.cwd,
            relativePath: String(request.relativePath ?? ""),
            caption: typeof request.caption === "string" ? request.caption : undefined,
            source: "remote-command",
            maxDocumentBytes: 50 * 1024 * 1024,
            maxImageBytes: this.config.maxOutboundImageBytes,
            allowedImageMimeTypes: this.config.allowedImageMimeTypes,
          });
          route.actions.appendAudit(`Telegram broker send-file ${result.ok ? "delivered" : "failed"}: ${result.ok ? result.relativePath : result.error}`);
          await respond({ ok: true, result: formatRequesterFileDeliveryResult(result) });
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
    const message: BrokerProtocolRequest = {
      ...payload,
      type: "request",
      requestId,
      protocolVersion: BROKER_PROTOCOL_VERSION,
      channel: BROKER_CHANNEL,
      action,
      pipeline: { protocolVersion: relayPipelineProtocolVersion, channel: BROKER_CHANNEL, action },
    };
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
    const brokerPath = fileURLToPath(new URL("./process.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify(this.config),
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: this.socketPath,
        TELEGRAM_TUNNEL_BROKER_PID_PATH: this.pidPath,
        PI_RELAY_BROKER_NAMESPACE: this.brokerNamespace ?? "",
      },
    });
    child.unref();
    if (child.pid) await writeFile(this.pidPath, `${child.pid}\n`, { mode: 0o600 });
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
    throw new Error("PiRelay broker did not start in time.");
  }
}
