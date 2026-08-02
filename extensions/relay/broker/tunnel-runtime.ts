import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageFileLoadResult, LatestTurnImage, SessionRoute, SessionStatusSnapshot, SetupCache, TelegramBindingMetadata, TelegramPromptContent, TelegramTunnelConfig, TunnelRuntime } from "../core/types.js";
import { TelegramChannelAdapter } from "../adapters/telegram/adapter.js";
import { deliverWorkspaceFileToRequester, formatRequesterFileDeliveryResult, type RelayFileDeliveryRequester } from "../core/requester-file-delivery.js";
import { ensureStateDir } from "../state/paths.js";
import { TunnelStateStore } from "../state/tunnel-store.js";
import { relayRouteStateForRoute, statusSnapshotForRoute, type RelayRouteState } from "../core/relay-core.js";
import { abortRouteSafely, compactRouteSafely, deliverRoutePrompt, latestRouteImagesSafely, newSessionRouteSafely, routeActionDisplayMessage, routeImageByPathSafely, routeSkillCommandsSafely, routeWorkspaceRootSafely, unavailableRouteMessage } from "../core/route-actions.js";
import { relayPipelineProtocolVersion } from "../middleware/pipeline.js";
import { sha256 } from "../core/utils.js";
import { brokerScopeControlPaths, ensureScopedBroker, normalizeBrokerNamespace, replaceScopedBroker } from "./supervisor.js";
import { normalizeBrokerReconciliationResponse, synchronizationStateAfterConnect, synchronizationStateAfterDisconnect, synchronizationStateAfterResponse } from "./reconciliation.js";
import type { BrokerClientSynchronizationState, BrokerHealthSnapshot, BrokerRestartOutcome, BrokerRestartPreparation } from "./protocol.js";
import { createCommunicationDiagnosticsLogger, type CommunicationDiagnosticsLogger } from "../diagnostics/communication.js";

const BROKER_PROTOCOL_VERSION = 1;
const BROKER_CHANNEL = "telegram" as const;
const DEFAULT_RECONCILIATION_INTERVAL_MS = 20_000;
const MAX_RECONCILIATION_JITTER_MS = 10_000;

export interface BrokerTunnelRuntimeOptions {
  reconciliationIntervalMs?: number;
  restartConvergenceTimeoutMs?: number;
  requestTimeoutMs?: number;
  random?: () => number;
  onSynchronizationStateChange?: (state: BrokerClientSynchronizationState) => void;
}

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
  private readonly epochPath: string;
  private readonly brokerNamespace?: string;
  private readonly routes = new Map<string, SessionRoute>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private socket?: Socket;
  private buffer = "";
  private connecting?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconciliationTimer?: ReturnType<typeof setTimeout>;
  private reconciliationQueue: Promise<void> = Promise.resolve();
  private operationGeneration = 0;
  private reconnectNeeded = false;
  private restartInProgress = false;
  private reconnectDelayMs = 250;
  private started = false;
  private setupCache?: SetupCache;
  private synchronizationState: BrokerClientSynchronizationState = { transport: "disconnected", routes: {} };
  private reconciliationSupported?: boolean;
  private synchronizationListener?: (state: BrokerClientSynchronizationState) => void;
  private readonly diagnostics: CommunicationDiagnosticsLogger;
  private lastFailureDiagnostic?: string;

  constructor(private readonly config: TelegramTunnelConfig, private readonly options: BrokerTunnelRuntimeOptions = {}) {
    this.diagnostics = createCommunicationDiagnosticsLogger(config.communicationDiagnostics);
    this.brokerNamespace = normalizeBrokerNamespace(config.brokerNamespace ?? process.env.PI_RELAY_BROKER_NAMESPACE);
    const tokenHash = sha256(config.botToken).slice(0, 16);
    // Broker scope is intentionally machine-local and secret-safe:
    // { stateDir, bot token hash, brokerNamespace }. Multiple Pi sessions
    // in the same scope are clients of one supervised broker process.
    const paths = brokerScopeControlPaths({ stateDir: config.stateDir, tokenHash, namespace: this.brokerNamespace });
    this.socketPath = paths.socketPath;
    this.pidPath = paths.pidPath;
    this.epochPath = paths.epochPath;
  }

  get setup(): SetupCache | undefined {
    return this.setupCache;
  }

  async start(): Promise<void> {
    this.started = true;
    try {
      await this.ensureConnected();
    } catch (error) {
      this.scheduleReconnect();
      throw error;
    } finally {
      this.schedulePeriodicReconciliation();
    }
  }

  async stop(): Promise<void> {
    this.operationGeneration += 1;
    this.started = false;
    this.disconnectClient(new Error("Broker runtime stopped."));
  }

  async restartBrokerProcess(): Promise<BrokerRestartOutcome> {
    if (this.restartInProgress) {
      return { status: "in-progress", expectedClientCount: 1, connectedClientCount: this.socket && !this.socket.destroyed ? 1 : 0, registeredRouteCount: Object.values(this.synchronizationState.routes).filter((health) => health === "synchronized").length };
    }
    this.restartInProgress = true;
    try {
      const restartStartedAt = Date.now();
    const fallbackExpected = this.routes.size;
    let preparation: BrokerRestartPreparation = { brokerEpoch: this.synchronizationState.brokerEpoch ?? "legacy", expectedClientCount: fallbackExpected > 0 ? 1 : 0, expectedRouteCount: fallbackExpected };
    if (this.socket && !this.socket.destroyed) {
      try {
        const value = await this.requestOnce("prepareBrokerRestart", { clientId: this.clientId });
        if (isBrokerRestartPreparation(value)) preparation = value;
      } catch (error) {
        if (!isUnsupportedRestartAction(error)) throw error;
      }
    }
    const selectedPid = await this.readBrokerPid();
    this.recordDiagnostic("broker.restart", "prepared", { expectedClientCount: preparation.expectedClientCount, expectedRouteCount: preparation.expectedRouteCount });
    this.operationGeneration += 1;
    this.started = false;
    this.disconnectClient(new Error("Broker runtime restarted."));
    const tokenHash = sha256(this.config.botToken).slice(0, 16);
    const replacement = await replaceScopedBroker({
      stateDir: this.config.stateDir,
      tokenHash,
      namespace: this.brokerNamespace,
      selectedPid,
      selectedEpoch: preparation.brokerEpoch === "legacy" ? undefined : preparation.brokerEpoch,
      isAlive: (pid) => this.isProcessAlive(pid),
      probeSocket: async () => this.probeSocket().then(() => true, () => false),
      waitForSocketReady: async () => this.waitForSocketReady(),
      stopBroker: async (pid) => {
        try {
          process.kill(pid, "SIGTERM");
        } catch (error) {
          if (!isNoSuchProcessError(error)) throw error;
        }
        await this.waitForBrokerProcessExit(pid);
      },
      startBroker: async () => this.spawnBroker(),
    });
    this.recordDiagnostic("broker.restart", replacement.status, {});
    this.started = true;
    try {
      await this.ensureConnected();
      const outcome = await this.waitForBrokerConvergence(preparation);
      this.recordDiagnostic("broker.restart", outcome.status, { expectedClientCount: outcome.expectedClientCount, connectedClientCount: outcome.connectedClientCount, registeredRouteCount: outcome.registeredRouteCount, durationMs: Date.now() - restartStartedAt });
      return outcome;
    } catch {
      this.scheduleReconnect();
      return { status: "failed", expectedClientCount: preparation.expectedClientCount, connectedClientCount: 0, registeredRouteCount: 0, safeMessage: "Broker restart did not converge; automatic retry remains active." };
    }
    } catch {
      this.started = true;
      this.scheduleReconnect();
      return { status: "failed", expectedClientCount: 1, connectedClientCount: 0, registeredRouteCount: 0, safeMessage: "Broker restart failed safely; automatic retry remains active." };
    } finally {
      this.restartInProgress = false;
    }
  }

  async ensureSetup(): Promise<SetupCache> {
    const setup = (await this.request("ensureSetup", {})) as SetupCache;
    this.setupCache = setup;
    return setup;
  }

  async registerRoute(route: SessionRoute): Promise<void> {
    this.routes.set(route.sessionKey, route);
    this.publishSynchronizationState(this.synchronizationStatePendingForCurrentRoutes());
    try {
      await this.reconcileRoutes();
      route.actions.clearLocalStatus?.("relay-sync");
    } finally {
      this.schedulePeriodicReconciliation();
    }
  }

  async unregisterRoute(sessionKey: string): Promise<void> {
    this.routes.delete(sessionKey);
    this.publishSynchronizationState({
      ...this.synchronizationState,
      routes: Object.fromEntries(Object.entries(this.synchronizationState.routes).filter(([key]) => key !== sessionKey)),
    });
    if (this.routes.size === 0) {
      this.operationGeneration += 1;
      this.cancelPeriodicReconciliation();
      if (this.socket && !this.socket.destroyed) {
        await this.requestOnce("unregisterRoute", { clientId: this.clientId, sessionKey }).catch(() => undefined);
      }
      await this.stop();
    } else {
      await this.reconcileRoutes();
    }
  }

  getBrokerSynchronizationState(): BrokerClientSynchronizationState {
    return this.synchronizationState;
  }

  setBrokerSynchronizationListener(listener: (state: BrokerClientSynchronizationState) => void): void {
    this.synchronizationListener = listener;
  }

  async reconcileBrokerRoutes(): Promise<BrokerClientSynchronizationState> {
    if (this.routes.size > 0) await this.reconcileRoutes("doctor");
    return this.synchronizationState;
  }

  getStatus(sessionKey: string): SessionStatusSnapshot | undefined {
    const route = this.routes.get(sessionKey);
    if (!route) return undefined;
    return statusSnapshotForRoute(route, { online: true });
  }

  async sendToBoundChat(sessionKey: string, text: string, options: { terminalStatus?: "completed" | "failed" | "aborted" } = {}): Promise<void> {
    await this.request("sendToBoundChat", { sessionKey, text, ...options });
  }

  private serializeRoute(route: SessionRoute): BrokerRouteState {
    return relayRouteStateForRoute(route, { channel: BROKER_CHANNEL });
  }

  private disconnectClient(error: Error): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.cancelPeriodicReconciliation();
    this.rejectPending(error);
    this.socket?.destroy();
    this.socket = undefined;
    this.publishSynchronizationState(synchronizationStateAfterDisconnect([...this.routes.keys()], this.started ? "reconnecting" : "disconnected"));
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;

    const generation = this.operationGeneration;
    this.connecting = (async () => {
      await ensureStateDir(this.config.stateDir);
      if (!await this.tryConnectSocket()) {
        const tokenHash = sha256(this.config.botToken).slice(0, 16);
        await ensureScopedBroker({
          stateDir: this.config.stateDir,
          tokenHash,
          namespace: this.brokerNamespace,
          isAlive: (pid) => this.isProcessAlive(pid),
          probeSocket: async () => this.probeSocket().then(() => true, () => false),
          waitForSocketReady: async () => this.waitForSocketReady(),
          startBroker: async () => this.spawnBroker(),
        });
        await this.connectSocket();
      }
      if (generation !== this.operationGeneration) {
        this.socket?.destroy();
        this.socket = undefined;
        return;
      }
      await this.resyncRoutes();
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
      if (this.started && (this.reconnectNeeded || !this.socket || this.socket.destroyed)) {
        this.reconnectNeeded = false;
        this.scheduleReconnect();
      }
    }
  }

  private async tryConnectSocket(): Promise<boolean> {
    try {
      await this.connectSocket();
      return true;
    } catch {
      return false;
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectDelayMs = 250;
    this.socket = socket;
    this.reconciliationSupported = undefined;
    this.reconnectNeeded = false;
    this.publishSynchronizationState(synchronizationStateAfterConnect([...this.routes.keys()], this.synchronizationState));
    this.recordDiagnostic("broker.connect", "connected", { routeCount: this.routes.size });
    this.buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newlineIndex = this.buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          void this.handleMessage(line, socket);
        }
        newlineIndex = this.buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.started) this.reconnectNeeded = true;
      this.publishSynchronizationState(synchronizationStateAfterDisconnect([...this.routes.keys()], this.started ? "reconnecting" : "disconnected"));
      this.recordDiagnostic("broker.disconnect", this.started ? "reconnecting" : "stopped", { routeCount: this.routes.size });
      this.rejectPending(new Error("Broker connection closed."));
      this.scheduleReconnect();
    });
    socket.on("error", () => {
      // close handler covers recovery
    });
  }

  private async handleMessage(line: string, sourceSocket?: Socket): Promise<void> {
    if (sourceSocket && sourceSocket !== this.socket) return;
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

      if (request.action === "brokerRestartNotice") {
        await respond({ ok: true });
        this.reconnectNeeded = this.started;
        this.publishSynchronizationState(synchronizationStateAfterDisconnect([...this.routes.keys()], this.started ? "reconnecting" : "disconnected"));
        setTimeout(() => {
          if (sourceSocket) {
            if (this.socket === sourceSocket) sourceSocket.destroy();
          } else {
            this.socket?.destroy();
          }
        }, 0).unref?.();
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
          const outcome = await deliverRoutePrompt(route, {
            content,
            deliverAs,
            requester: isRecord(request.requester) ? request.requester as unknown as RelayFileDeliveryRequester : undefined,
            passUndefinedOptions: true,
            safeFailureMessage: "Could not deliver the broker prompt to Pi.",
          });
          if (outcome.kind !== "success") {
            await respond({ ok: false, error: routeActionDisplayMessage(outcome) });
            return;
          }
          if (typeof request.auditMessage === "string" && request.auditMessage) {
            route.actions.appendAudit(request.auditMessage);
          }
          await respond({ ok: true, result: outcome.result });
          return;
        }
        case "resolveApprovalDecision": {
          if (!route.actions.resolveApprovalDecision) {
            await respond({ ok: false, error: "Approval request is stale." });
            return;
          }
          const result = await route.actions.resolveApprovalDecision(request.decision as never);
          await respond({ ok: true, result });
          return;
        }
        case "sendRequesterFile": {
          if (!isRecord(request.requester)) {
            await respond({ ok: false, error: "Missing requester context." });
            return;
          }
          const workspace = routeWorkspaceRootSafely(route);
          if (workspace.kind !== "success") {
            await respond({ ok: false, error: routeActionDisplayMessage(workspace) });
            return;
          }
          const workspaceRoot = workspace.result;
          const requester = request.requester as unknown as RelayFileDeliveryRequester;
          route.remoteRequester = requester;
          const adapter = new TelegramChannelAdapter(this.config);
          const result = await deliverWorkspaceFileToRequester({
            route,
            requester,
            adapter,
            workspaceRoot: workspaceRoot,
            relativePath: String(request.relativePath ?? ""),
            caption: typeof request.caption === "string" ? request.caption : undefined,
            source: "remote-command",
            maxDocumentBytes: 50 * 1024 * 1024,
            maxImageBytes: this.config.maxOutboundImageBytes,
            allowedImageMimeTypes: this.config.allowedImageMimeTypes,
            authoritySnapshot: await new TunnelStateStore(this.config.stateDir).loadBindingAuthoritySnapshot(),
          });
          route.actions.appendAudit(`Telegram broker send-file ${result.ok ? "delivered" : "failed"}: ${result.ok ? result.relativePath : result.error}`);
          await respond({ ok: true, result: formatRequesterFileDeliveryResult(result) });
          return;
        }
        case "getSkillCommands": {
          await respond({ ok: true, result: routeSkillCommandsSafely(route) });
          return;
        }
        case "getLatestImages": {
          const outcome = await latestRouteImagesSafely(route);
          if (outcome.kind !== "success") {
            await respond({ ok: false, error: routeActionDisplayMessage(outcome) });
            return;
          }
          await respond({ ok: true, result: outcome.result });
          return;
        }
        case "getImageByPath": {
          const outcome = await routeImageByPathSafely(route, String(request.path ?? ""));
          if (outcome.kind !== "success") {
            await respond({ ok: false, error: routeActionDisplayMessage(outcome) });
            return;
          }
          await respond({ ok: true, result: outcome.result });
          return;
        }
        case "newSession": {
          const requester = isRecord(request.requester) ? request.requester as unknown as RelayFileDeliveryRequester : undefined;
          const outcome = await newSessionRouteSafely(route, requester);
          await respond({ ok: true, result: outcome.kind === "failed" ? { kind: "failed", safeMessage: outcome.safeMessage } : outcome });
          return;
        }
        case "abort": {
          const outcome = abortRouteSafely(route);
          if (outcome.kind !== "success") {
            await respond({ ok: false, error: routeActionDisplayMessage(outcome) });
            return;
          }
          if (typeof request.auditMessage === "string" && request.auditMessage) {
            route.actions.appendAudit(request.auditMessage);
          }
          await respond({ ok: true });
          return;
        }
        case "compact": {
          const outcome = await compactRouteSafely(route);
          if (outcome.kind !== "success") {
            await respond({ ok: false, error: routeActionDisplayMessage(outcome) });
            return;
          }
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
      if (isBrokerRequestTimeout(error)) throw error;
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
    const timeoutMs = this.options.requestTimeoutMs ?? (action === "getBrokerHealth" ? 2_000 : action === "prepareBrokerRestart" || action === "reconcileRoutes" ? 10_000 : 30_000);
    const result = new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        rejectPromise(new Error(`Broker ${action} request timed out.`));
      }, timeoutMs);
      timeout.unref?.();
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timeout); resolvePromise(value); },
        reject: (error) => { clearTimeout(timeout); rejectPromise(error); },
      });
    });
    try {
      this.writeMessage(message);
    } catch (error) {
      this.pending.get(requestId)?.reject(error instanceof Error ? error : new Error("Broker request write failed."));
      this.pending.delete(requestId);
    }
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
    const startedAt = Date.now();
    if (this.routes.size === 0) return;
    let result: unknown;
    try {
      result = await this.requestOnce("reconcileRoutes", {
        clientId: this.clientId,
        routes: [...this.routes.values()].map((route) => this.serializeRoute(route)),
      });
    } catch (error) {
      if (!isUnsupportedReconciliationAction(error)) throw error;
      this.reconciliationSupported = false;
      await this.resyncRoutesLegacy();
      for (const route of this.routes.values()) route.actions.clearLocalStatus?.("relay-sync");
      return;
    }
    if (!this.applyReconciliationResponse(result, startedAt, "connect")) await this.resyncRoutesLegacy();
    for (const route of this.routes.values()) route.actions.clearLocalStatus?.("relay-sync");
  }

  private reconcileRoutes(trigger: "route-mutation" | "periodic" | "doctor" = "route-mutation"): Promise<void> {
    const generation = this.operationGeneration;
    const operation = this.reconciliationQueue
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.operationGeneration || this.routes.size === 0) return;
        await this.reconcileRoutesOnce(trigger);
      });
    this.reconciliationQueue = operation.catch(() => undefined);
    return operation;
  }

  private async reconcileRoutesOnce(trigger: "route-mutation" | "periodic" | "doctor"): Promise<void> {
    const startedAt = Date.now();
    this.recordDiagnostic("broker.reconcile", "attempt", { routeCount: this.routes.size, trigger });
    if (this.reconciliationSupported === false) {
      await this.reconcileRoutesLegacy();
      return;
    }
    this.publishSynchronizationState(this.synchronizationStatePendingForCurrentRoutes());
    let result: unknown;
    try {
      await this.ensureConnected();
      result = await this.requestOnce("reconcileRoutes", {
        clientId: this.clientId,
        observedBrokerEpoch: this.synchronizationState.brokerEpoch,
        routes: [...this.routes.values()].map((route) => this.serializeRoute(route)),
      });
    } catch (error) {
      if (!isUnsupportedReconciliationAction(error)) throw error;
      this.reconciliationSupported = false;
      await this.reconcileRoutesLegacy();
      return;
    }
    if (!this.applyReconciliationResponse(result, startedAt, trigger)) await this.reconcileRoutesLegacy();
  }

  private applyReconciliationResponse(value: unknown, startedAt = Date.now(), trigger = "direct"): boolean {
    const previous = this.synchronizationState;
    const response = normalizeBrokerReconciliationResponse(value);
    if (!response) {
      if (value === undefined || value === true) return false;
      throw new Error("Invalid broker route reconciliation response.");
    }
    this.reconciliationSupported = true;
    this.publishSynchronizationState(synchronizationStateAfterResponse([...this.routes.keys()], response));
    const synchronizedCount = Object.values(this.synchronizationState.routes).filter((health) => health === "synchronized").length;
    const repairedCount = Object.entries(this.synchronizationState.routes).filter(([sessionKey, health]) => health === "synchronized" && previous.routes[sessionKey] !== "synchronized").length;
    this.recordDiagnostic("broker.reconcile", response.rejected.length > 0 ? "rejected" : repairedCount > 0 ? "repaired" : "acknowledged", {
      routeCount: this.routes.size,
      synchronizedCount,
      rejectedCount: response.rejected.length,
      repairedCount,
      durationMs: Date.now() - startedAt,
      trigger,
    });
    return true;
  }

  private async resyncRoutesLegacy(): Promise<void> {
    for (const route of this.routes.values()) {
      await this.requestOnce("registerRoute", { clientId: this.clientId, route: this.serializeRoute(route) });
    }
    this.markLegacyRoutesSynchronized();
  }

  private async reconcileRoutesLegacy(): Promise<void> {
    for (const route of this.routes.values()) {
      await this.request("registerRoute", { clientId: this.clientId, route: this.serializeRoute(route) });
    }
    this.markLegacyRoutesSynchronized();
  }

  private markLegacyRoutesSynchronized(): void {
    this.publishSynchronizationState({
      transport: "connected",
      routes: Object.fromEntries([...this.routes.keys()].map((sessionKey) => [sessionKey, "synchronized" as const])),
    });
  }

  private synchronizationStatePendingForCurrentRoutes(): BrokerClientSynchronizationState {
    return {
      transport: "connected",
      brokerEpoch: this.synchronizationState.brokerEpoch,
      routes: Object.fromEntries([...this.routes.keys()].map((sessionKey) => [
        sessionKey,
        this.synchronizationState.routes[sessionKey] === "synchronized" ? "synchronized" : "pending",
      ])),
    };
  }

  private recordDiagnostic(event: string, outcome: string, details: Record<string, unknown>): void {
    if (!this.diagnostics.config.enabled) return;
    const failureSignature = outcome === "error" || outcome === "rejected" ? `${event}:${outcome}:${JSON.stringify(details)}` : undefined;
    if (failureSignature) {
      if (failureSignature === this.lastFailureDiagnostic) return;
      this.lastFailureDiagnostic = failureSignature;
    } else if (outcome === "acknowledged" || outcome === "repaired" || outcome === "connected") {
      this.lastFailureDiagnostic = undefined;
    }
    void this.diagnostics.record({ component: "runtime", event, outcome, details });
  }

  private publishSynchronizationState(state: BrokerClientSynchronizationState): void {
    this.synchronizationState = state;
    try {
      (this.synchronizationListener ?? this.options.onSynchronizationStateChange)?.(state);
    } catch {
      // Status rendering must not interfere with broker recovery.
    }
  }

  private schedulePeriodicReconciliation(): void {
    this.cancelPeriodicReconciliation();
    if (!this.started || this.routes.size === 0) return;
    const baseDelay = Math.max(10, this.options.reconciliationIntervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS);
    const random = this.options.random ?? Math.random;
    const jitter = this.options.reconciliationIntervalMs === undefined
      ? Math.floor(Math.max(0, Math.min(1, random())) * MAX_RECONCILIATION_JITTER_MS)
      : 0;
    this.reconciliationTimer = setTimeout(() => {
      this.reconciliationTimer = undefined;
      if (!this.started || this.routes.size === 0) return;
      const reconciliation = this.reconcileRoutes("periodic")
        .catch(() => {
          this.recordDiagnostic("broker.reconcile", "error", { category: "request-failed" });
          if (this.started) this.scheduleReconnect();
        })
        .finally(() => {
          this.schedulePeriodicReconciliation();
        });
    }, baseDelay + jitter);
    this.reconciliationTimer.unref?.();
  }

  private cancelPeriodicReconciliation(): void {
    if (this.reconciliationTimer) clearTimeout(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
  }

  private async waitForBrokerConvergence(preparation: BrokerRestartPreparation): Promise<BrokerRestartOutcome> {
    const deadline = Date.now() + (this.options.restartConvergenceTimeoutMs ?? 10_000);
    let latest: BrokerHealthSnapshot = { brokerEpoch: this.synchronizationState.brokerEpoch ?? "unknown", connectedClientCount: 1, registeredRouteCount: this.routes.size };
    while (Date.now() < deadline) {
      const value = await this.requestOnce("getBrokerHealth", { clientId: this.clientId });
      if (isBrokerHealthSnapshot(value)) latest = value;
      const ownRoutesSynchronized = [...this.routes.keys()].every((sessionKey) => this.synchronizationState.routes[sessionKey] === "synchronized");
      if (ownRoutesSynchronized && latest.connectedClientCount >= preparation.expectedClientCount && latest.registeredRouteCount >= preparation.expectedRouteCount) {
        return { status: "complete", expectedClientCount: preparation.expectedClientCount, connectedClientCount: latest.connectedClientCount, registeredRouteCount: latest.registeredRouteCount };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return { status: "partial-timeout", expectedClientCount: preparation.expectedClientCount, connectedClientCount: latest.connectedClientCount, registeredRouteCount: latest.registeredRouteCount };
  }

  private async readBrokerPid(): Promise<number | undefined> {
    try {
      const raw = (await readFile(this.pidPath, "utf8")).trim();
      const pid = Number(raw);
      if (Number.isInteger(pid) && pid > 0) return pid;
      throw new Error(`Invalid broker pid file contents: ${raw || "empty"}`);
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw new Error(`Could not read PiRelay broker pid file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (isNoSuchProcessError(error)) return false;
      throw new Error(`Could not inspect PiRelay broker process ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async waitForBrokerProcessExit(pid: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!this.isProcessAlive(pid)) return;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`PiRelay broker process ${pid} did not stop in time.`);
  }

  private async spawnBroker(): Promise<{ pid: number }> {
    const brokerPath = fileURLToPath(new URL("./process.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify(this.config),
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: this.socketPath,
        TELEGRAM_TUNNEL_BROKER_PID_PATH: this.pidPath,
        PI_RELAY_BROKER_EPOCH_PATH: this.epochPath,
        PI_RELAY_BROKER_NAMESPACE: this.brokerNamespace ?? "",
        PI_RELAY_COMMUNICATION_DIAGNOSTICS_CONFIG_JSON: JSON.stringify(this.config.communicationDiagnostics ?? { enabled: false }),
      },
    });
    child.unref();
    if (!child.pid) throw new Error("PiRelay broker process did not expose a pid.");
    return { pid: child.pid };
  }

  private async waitForSocketReady(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        await this.probeSocket();
        return;
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
      }
    }
    throw new Error("PiRelay broker did not start in time.");
  }

  private async probeSocket(): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const socket = createConnection(this.socketPath);
      const onError = (error: Error) => {
        socket.destroy();
        rejectPromise(error);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        socket.end();
        resolvePromise();
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    if (this.connecting) {
      this.reconnectNeeded = true;
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.started) return;
      void this.ensureConnected().catch(() => {
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 5_000);
        this.scheduleReconnect();
      }).then(() => {
        this.schedulePeriodicReconciliation();
      });
    }, this.reconnectDelayMs);
    this.recordDiagnostic("broker.retry", "scheduled", { delayMs: this.reconnectDelayMs });
    this.reconnectTimer.unref?.();
  }
}

function isBrokerRestartPreparation(value: unknown): value is BrokerRestartPreparation {
  return isRecord(value)
    && typeof value.brokerEpoch === "string"
    && Number.isInteger(value.expectedClientCount) && Number(value.expectedClientCount) >= 0
    && Number.isInteger(value.expectedRouteCount) && Number(value.expectedRouteCount) >= 0;
}

function isBrokerHealthSnapshot(value: unknown): value is BrokerHealthSnapshot {
  return isRecord(value)
    && typeof value.brokerEpoch === "string"
    && Number.isInteger(value.connectedClientCount) && Number(value.connectedClientCount) >= 0
    && Number.isInteger(value.registeredRouteCount) && Number(value.registeredRouteCount) >= 0;
}

function isUnsupportedRestartAction(error: unknown): boolean {
  return error instanceof Error && error.message === "Unknown client action: prepareBrokerRestart";
}

function isBrokerRequestTimeout(error: unknown): boolean {
  return error instanceof Error && /^Broker [A-Za-z0-9_-]+ request timed out\.$/.test(error.message);
}

function isUnsupportedReconciliationAction(error: unknown): boolean {
  return error instanceof Error && (error.message === "Unknown client action: reconcileRoutes" || error.message === "Unknown broker action: reconcileRoutes");
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isNoSuchProcessError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ESRCH";
}
