import { writeFile } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { ensureParentDir, ensureStateDir, getLockFilePath } from "./paths.js";
import { summarizeForTelegram } from "./summary.js";
import { BrokerTunnelRuntime } from "./broker-runtime.js";
import { TunnelStateStore } from "./state-store.js";
import { TelegramApiClient } from "./telegram-api.js";
import {
  advanceGuidedAnswerFlow,
  buildChoiceInjection,
  isGuidedAnswerStart,
  matchChoiceOption,
  renderGuidedAnswerPrompt,
  startGuidedAnswerFlow,
  summarizeTailForTelegram,
} from "./answer-workflow.js";
import type {
  SessionRoute,
  SessionStatusSnapshot,
  SetupCache,
  TelegramBindingMetadata,
  TelegramInboundMessage,
  TelegramTunnelConfig,
  TunnelRuntime,
  TelegramUserSummary,
} from "./types.js";
import {
  formatModelId,
  getTelegramUserLabel,
  parseTelegramCommand,
  statusLineForBinding,
  summarizeTextDeterministically,
  toIsoNow,
} from "./utils.js";

const HELP_TEXT = [
  "Telegram tunnel commands:",
  "/help - show commands",
  "/status - session and tunnel status",
  "/summary - latest summary/excerpt",
  "/full - latest full assistant output",
  "/steer <text> - steer the active run",
  "/followup <text> - queue a follow-up",
  "/abort - abort the active run",
  "/compact - trigger Pi compaction",
  "/pause - pause remote delivery",
  "/resume - resume remote delivery",
  "/disconnect - revoke this chat binding",
  "answer - start a guided answer flow when the latest output contains choices/questions",
].join("\n");

const TELEGRAM_ACTIVITY_ACTION = "typing" as const;
const TELEGRAM_ACTIVITY_INITIAL_REFRESH_MS = 1_200;
const TELEGRAM_ACTIVITY_REFRESH_MS = 4_000;

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

function isTerminalStatus(status: SessionRoute["notification"]["lastStatus"]): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function isEffectivelyIdle(route: SessionRoute): boolean {
  if (isTerminalStatus(route.notification.lastStatus)) return true;
  return route.actions.context.isIdle();
}

function hasAnswerableLatestOutput(route: SessionRoute): boolean {
  return route.notification.lastStatus === "completed"
    && Boolean(route.notification.lastAssistantText)
    && Boolean(route.notification.structuredAnswer);
}

export class InProcessTunnelRuntime implements TunnelRuntime {
  private readonly api: TelegramApiClient;
  private readonly routes = new Map<string, SessionRoute>();
  private readonly answerFlows = new Map<string, ReturnType<typeof startGuidedAnswerFlow>>();
  private readonly activityIndicators = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;
  private pollingTask?: Promise<void>;
  private releaseLock?: () => Promise<void>;
  private updateOffset?: number;
  private setupCache?: SetupCache;

  constructor(
    private readonly config: TelegramTunnelConfig,
    private readonly store: TunnelStateStore,
  ) {
    this.api = new TelegramApiClient(config);
  }

  get setup(): SetupCache | undefined {
    return this.setupCache;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await ensureStateDir(this.config.stateDir);
    await this.acquireLock();
    this.started = true;
    this.pollingTask = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.clearAllActivityIndicators();
    await this.pollingTask?.catch(() => undefined);
    this.pollingTask = undefined;
    if (this.releaseLock) {
      await this.releaseLock().catch(() => undefined);
      this.releaseLock = undefined;
    }
  }

  async ensureSetup(): Promise<SetupCache> {
    if (this.setupCache) return this.setupCache;

    const cached = await this.store.getSetup();
    if (cached) {
      this.setupCache = cached;
      return cached;
    }

    const me = await this.api.getMe();
    this.setupCache = {
      botId: me.id,
      botUsername: me.username ?? `bot-${me.id}`,
      botDisplayName: me.first_name,
      validatedAt: toIsoNow(),
    };
    await this.store.setSetup(this.setupCache);
    return this.setupCache;
  }

  async registerRoute(route: SessionRoute): Promise<void> {
    const previousRoute = this.routes.get(route.sessionKey);
    if (previousRoute?.binding?.chatId !== route.binding?.chatId && previousRoute?.binding) {
      this.clearActivityIndicator(previousRoute);
    }
    if (!route.notification.structuredAnswer) {
      this.answerFlows.delete(this.answerFlowKey(route));
    }
    this.routes.set(route.sessionKey, route);
    this.syncActivityIndicator(route);
    if (route.binding) {
      await this.store.upsertBinding(route.binding);
    }
    await this.start();
  }

  async unregisterRoute(sessionKey: string): Promise<void> {
    const route = this.routes.get(sessionKey);
    if (route) {
      this.answerFlows.delete(this.answerFlowKey(route));
      this.clearActivityIndicator(route);
    }
    this.routes.delete(sessionKey);
    if (this.routes.size === 0) {
      await this.stop();
    }
  }

  getStatus(sessionKey: string): SessionStatusSnapshot | undefined {
    const route = this.routes.get(sessionKey);
    if (!route) return undefined;
    return this.statusOf(route, true);
  }

  async sendToBoundChat(sessionKey: string, text: string): Promise<void> {
    const route = this.routes.get(sessionKey);
    if (!route?.binding) return;
    await this.api.sendPlainText(route.binding.chatId, text);
    if (route.notification.lastStatus === "completed" && route.notification.structuredAnswer) {
      await this.api.sendPlainText(route.binding.chatId, summarizeTailForTelegram(route.notification.structuredAnswer));
    }
  }

  private answerFlowKey(route: SessionRoute): string {
    return `${route.sessionKey}:${route.binding?.chatId ?? "unbound"}`;
  }

  private activityKey(sessionKey: string, chatId: number): string {
    return `${sessionKey}:${chatId}`;
  }

  private activityKeyForRoute(route: SessionRoute): string | undefined {
    return route.binding ? this.activityKey(route.sessionKey, route.binding.chatId) : undefined;
  }

  private clearAllActivityIndicators(): void {
    for (const timer of this.activityIndicators.values()) {
      clearTimeout(timer);
    }
    this.activityIndicators.clear();
  }

  private clearActivityIndicator(route: SessionRoute): void {
    const key = this.activityKeyForRoute(route);
    if (!key) return;
    this.clearActivityIndicatorByKey(key);
  }

  private clearActivityIndicatorByKey(key: string): void {
    const timer = this.activityIndicators.get(key);
    if (timer) clearTimeout(timer);
    this.activityIndicators.delete(key);
  }

  private shouldContinueActivityIndicator(route: SessionRoute): boolean {
    if (!route.binding || route.binding.paused) return false;
    if (isTerminalStatus(route.notification.lastStatus)) return false;
    return !route.actions.context.isIdle() || route.notification.lastStatus === "running";
  }

  private syncActivityIndicator(route: SessionRoute): void {
    if (this.shouldContinueActivityIndicator(route)) {
      void this.startActivityIndicator(route);
      return;
    }
    this.clearActivityIndicator(route);
  }

  private async startActivityIndicator(route: SessionRoute): Promise<boolean> {
    if (!route.binding || route.binding.paused) return false;
    const key = this.activityKeyForRoute(route);
    if (!key) return false;
    if (this.activityIndicators.has(key)) return true;

    const sent = await this.trySendActivityIndicator(route.binding.chatId);
    if (!sent) return false;
    this.scheduleActivityRefresh(route.sessionKey, route.binding.chatId, key, TELEGRAM_ACTIVITY_INITIAL_REFRESH_MS);
    return true;
  }

  private scheduleActivityRefresh(sessionKey: string, chatId: number, key: string, delayMs = TELEGRAM_ACTIVITY_REFRESH_MS): void {
    const timer = setTimeout(() => {
      void this.refreshActivityIndicator(sessionKey, chatId, key);
    }, delayMs);
    unrefTimer(timer);
    this.activityIndicators.set(key, timer);
  }

  private async refreshActivityIndicator(sessionKey: string, chatId: number, key: string): Promise<void> {
    const route = this.routes.get(sessionKey);
    if (!route || route.binding?.chatId !== chatId || !this.shouldContinueActivityIndicator(route)) {
      this.clearActivityIndicatorByKey(key);
      return;
    }

    const sent = await this.trySendActivityIndicator(chatId);
    if (!sent) {
      this.clearActivityIndicatorByKey(key);
      return;
    }
    if (!this.activityIndicators.has(key)) return;
    this.scheduleActivityRefresh(sessionKey, chatId, key);
  }

  private async trySendActivityIndicator(chatId: number): Promise<boolean> {
    try {
      await this.api.sendChatAction(chatId, TELEGRAM_ACTIVITY_ACTION);
      return true;
    } catch {
      return false;
    }
  }

  private async acquireLock(): Promise<void> {
    const path = getLockFilePath(this.config.stateDir);
    await ensureParentDir(path);
    await writeFile(path, "", { flag: "a", mode: 0o600 });
    this.releaseLock = await lockfile.lock(path, { realpath: false, stale: 60_000, retries: { retries: 0 } });
  }

  private async pollLoop(): Promise<void> {
    while (this.started) {
      try {
        await this.store.cleanupExpiredPairings();
        const messages = await this.api.getUpdates(this.updateOffset);
        for (const message of messages) {
          this.updateOffset = message.updateId + 1;
          await this.processInbound(message);
        }
      } catch (error) {
        if (!this.started) break;
        const text = error instanceof Error ? error.message : String(error);
        for (const route of this.routes.values()) {
          route.actions.context.ui.setStatus("telegram-tunnel-runtime", `telegram poll error: ${text}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  private async processInbound(message: TelegramInboundMessage): Promise<void> {
    const command = parseTelegramCommand(message.text);
    if (command?.command === "start") {
      await this.handleStart(message, command.args);
      return;
    }

    const persisted = await this.store.getBindingByChatId(message.chat.id);
    if (!persisted) {
      await this.api.sendPlainText(message.chat.id, "This chat is not paired to an active Pi session. Run /telegram-tunnel connect locally first.");
      return;
    }

    if (persisted.status === "revoked") {
      await this.api.sendPlainText(message.chat.id, "This Telegram tunnel binding has been revoked. Pair again from Pi with /telegram-tunnel connect.");
      return;
    }

    const route = this.routes.get(persisted.sessionKey);
    if (!route) {
      await this.api.sendPlainText(
        message.chat.id,
        `The paired Pi session (${persisted.sessionLabel}) is currently offline. Resume it locally, then try again.`,
      );
      return;
    }

    if (!route.binding) {
      await this.api.sendPlainText(message.chat.id, "The current Pi session route has no active Telegram binding.");
      return;
    }

    if (!(await this.isAuthorized(route, message.user))) {
      await this.api.sendPlainText(message.chat.id, "Unauthorized Telegram identity for this Pi session.");
      return;
    }

    route.binding.lastSeenAt = toIsoNow();
    await this.store.upsertBinding(route.binding);

    if (command) {
      await this.handleAuthorizedCommand(route, message, command.command, command.args);
      return;
    }

    await this.handleAuthorizedText(route, message);
  }

  private async handleStart(message: TelegramInboundMessage, nonce: string): Promise<void> {
    if (!nonce) {
      await this.api.sendPlainText(message.chat.id, "Missing pairing payload. Re-run /telegram-tunnel connect in Pi and scan the new QR code.");
      return;
    }
    if (message.chat.type !== "private") {
      await this.api.sendPlainText(message.chat.id, "Pairing only works from a private Telegram chat with the bot.");
      return;
    }

    const pairing = await this.store.consumePendingPairing(nonce);
    if (!pairing) {
      await this.api.sendPlainText(message.chat.id, "This pairing link is invalid or expired. Run /telegram-tunnel connect again in Pi.");
      return;
    }

    const route = this.routes.get(pairing.sessionKey);
    if (!route) {
      await this.api.sendPlainText(message.chat.id, `The target Pi session (${pairing.sessionLabel}) is not online anymore. Re-run /telegram-tunnel connect locally.`);
      return;
    }

    const allowedByList = this.config.allowUserIds.length > 0 && this.config.allowUserIds.includes(message.user.id);
    const approved = allowedByList || (await route.actions.promptLocalConfirmation(message.user));

    if (!approved) {
      await this.api.sendPlainText(message.chat.id, "Pairing was declined locally. Ask the Pi user to retry the connection flow.");
      return;
    }

    const binding: TelegramBindingMetadata = {
      sessionKey: route.sessionKey,
      sessionId: route.sessionId,
      sessionFile: route.sessionFile,
      sessionLabel: route.sessionLabel,
      chatId: message.chat.id,
      userId: message.user.id,
      username: message.user.username,
      firstName: message.user.firstName,
      lastName: message.user.lastName,
      boundAt: toIsoNow(),
      lastSeenAt: toIsoNow(),
      paused: false,
    };

    route.binding = binding;
    await this.store.upsertBinding(binding);
    route.actions.persistBinding(binding, false);
    route.actions.appendAudit(`Telegram tunnel paired with ${getTelegramUserLabel(message.user)}.`);
    await this.api.sendPlainText(
      message.chat.id,
      `Connected to Pi session ${route.sessionLabel}. Send text prompts directly, or use /help for tunnel commands.`,
    );
  }

  private async isAuthorized(route: SessionRoute, user: TelegramUserSummary): Promise<boolean> {
    const binding = route.binding;
    if (!binding) return false;
    if (binding.userId !== user.id) return false;
    if (this.config.allowUserIds.length > 0 && !this.config.allowUserIds.includes(user.id)) return false;
    return true;
  }

  private async handleAuthorizedCommand(
    route: SessionRoute,
    message: TelegramInboundMessage,
    command: string,
    args: string,
  ): Promise<void> {
    const binding = route.binding;
    if (!binding) {
      await this.api.sendPlainText(message.chat.id, "This session is no longer paired.");
      return;
    }

    if (binding.paused && !["resume", "status", "help", "disconnect"].includes(command)) {
      await this.api.sendPlainText(message.chat.id, "The tunnel is currently paused. Use /resume or disconnect locally.");
      return;
    }

    switch (command) {
      case "help": {
        await this.api.sendPlainText(message.chat.id, HELP_TEXT);
        return;
      }
      case "status": {
        const status = this.statusOf(route, true);
        const lines = [
          `Session: ${status.sessionLabel}`,
          `Binding: ${statusLineForBinding(status.binding)}`,
          `Online: ${status.online ? "yes" : "no"}`,
          `Busy: ${status.busy ? "yes" : "no"}`,
          `Model: ${status.modelId ?? "unknown"}`,
          `Last activity: ${status.lastActivityAt ? new Date(status.lastActivityAt).toLocaleString() : "unknown"}`,
        ];
        await this.api.sendPlainText(message.chat.id, lines.join("\n"));
        return;
      }
      case "summary": {
        const note = route.notification;
        const text = note.lastSummary || note.lastFailure || note.lastAssistantText;
        await this.api.sendPlainText(message.chat.id, text ? text : "No summary is available yet for this session.");
        return;
      }
      case "full": {
        const text = route.notification.lastAssistantText;
        await this.api.sendPlainText(
          message.chat.id,
          text ? text : "No completed assistant output is available yet for this session.",
        );
        return;
      }
      case "steer": {
        if (!args) {
          await this.api.sendPlainText(message.chat.id, "Usage: /steer <text>");
          return;
        }
        await this.startActivityIndicator(route);
        route.actions.sendUserMessage(args, { deliverAs: isEffectivelyIdle(route) ? undefined : "steer" });
        route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} sent a steering instruction.`);
        await this.api.sendPlainText(message.chat.id, isEffectivelyIdle(route) ? "Sent as a prompt." : "Steering queued.");
        return;
      }
      case "followup": {
        if (!args) {
          await this.api.sendPlainText(message.chat.id, "Usage: /followup <text>");
          return;
        }
        await this.startActivityIndicator(route);
        route.actions.sendUserMessage(args, { deliverAs: isEffectivelyIdle(route) ? undefined : "followUp" });
        route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} queued a follow-up.`);
        await this.api.sendPlainText(message.chat.id, isEffectivelyIdle(route) ? "Sent as a prompt." : "Follow-up queued.");
        return;
      }
      case "abort": {
        if (route.actions.context.isIdle()) {
          await this.api.sendPlainText(message.chat.id, "The Pi session is already idle.");
          return;
        }
        route.notification.abortRequested = true;
        route.actions.abort();
        route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} requested abort.`);
        await this.api.sendPlainText(message.chat.id, "Abort requested.");
        return;
      }
      case "compact": {
        route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} requested compaction.`);
        await route.actions.compact();
        await this.api.sendPlainText(message.chat.id, "Compaction requested.");
        return;
      }
      case "pause": {
        binding.paused = true;
        this.clearActivityIndicator(route);
        await this.store.upsertBinding(binding);
        route.actions.persistBinding(binding, false);
        await this.api.sendPlainText(message.chat.id, "Tunnel paused. Remote prompts and notifications are suspended until /resume.");
        return;
      }
      case "resume": {
        binding.paused = false;
        await this.store.upsertBinding(binding);
        route.actions.persistBinding(binding, false);
        await this.api.sendPlainText(message.chat.id, "Tunnel resumed.");
        return;
      }
      case "disconnect": {
        this.answerFlows.delete(this.answerFlowKey(route));
        this.clearActivityIndicator(route);
        await this.revokeBinding(route, `Telegram ${getTelegramUserLabel(message.user)} disconnected the tunnel.`);
        await this.api.sendPlainText(message.chat.id, "Disconnected. Future messages from this chat will be ignored until a new pairing is created.");
        return;
      }
      default: {
        await this.api.sendPlainText(message.chat.id, `Unknown command: /${command}. Use /help.`);
      }
    }
  }

  private async handleAuthorizedText(route: SessionRoute, message: TelegramInboundMessage): Promise<void> {
    const binding = route.binding;
    if (!binding) return;
    if (binding.paused) {
      await this.api.sendPlainText(message.chat.id, "The tunnel is paused. Use /resume first.");
      return;
    }

    const metadata = hasAnswerableLatestOutput(route) ? route.notification.structuredAnswer : undefined;
    const flowKey = this.answerFlowKey(route);
    const activeFlow = this.answerFlows.get(flowKey);
    if (metadata && activeFlow) {
      const result = advanceGuidedAnswerFlow(metadata, activeFlow, message.text);
      if (result.cancelled) {
        this.answerFlows.delete(flowKey);
        await this.api.sendPlainText(message.chat.id, result.responseText);
        return;
      }
      if (result.done && result.injectionText) {
        this.answerFlows.delete(flowKey);
        await this.startActivityIndicator(route);
        route.actions.sendUserMessage(result.injectionText, isEffectivelyIdle(route) ? undefined : { deliverAs: this.config.busyDeliveryMode });
        route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} answered a guided Telegram question flow.`);
        await this.api.sendPlainText(message.chat.id, result.responseText);
        return;
      }
      if (result.nextState) {
        this.answerFlows.set(flowKey, result.nextState);
        await this.api.sendPlainText(message.chat.id, result.responseText);
        return;
      }
    }

    if (isGuidedAnswerStart(message.text)) {
      if (!metadata) {
        await this.api.sendPlainText(
          message.chat.id,
          route.notification.lastStatus === "completed" && route.notification.lastAssistantText
            ? "I could not build a structured answer draft from the latest completed assistant output. Use /full or send a normal text reply instead."
            : "There is nothing to answer yet. Use /full or send a normal text reply instead.",
        );
        return;
      }
      const state = startGuidedAnswerFlow();
      this.answerFlows.set(flowKey, state);
      await this.api.sendPlainText(message.chat.id, renderGuidedAnswerPrompt(metadata, state));
      return;
    }

    const matchedOption = metadata ? matchChoiceOption(metadata, message.text) : undefined;
    if (metadata && matchedOption) {
      await this.startActivityIndicator(route);
      route.actions.sendUserMessage(buildChoiceInjection(metadata, matchedOption), isEffectivelyIdle(route)
        ? undefined
        : { deliverAs: this.config.busyDeliveryMode });
      route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} answered a guided Telegram question flow.`);
      await this.api.sendPlainText(message.chat.id, `Selected option ${matchedOption.id}: ${matchedOption.label}`);
      return;
    }

    const idle = isEffectivelyIdle(route);
    const deliverAs = idle ? undefined : this.config.busyDeliveryMode;
    const activityStarted = await this.startActivityIndicator(route);
    route.actions.sendUserMessage(message.text, deliverAs ? { deliverAs } : undefined);
    route.actions.appendAudit(
      idle
        ? `Telegram ${getTelegramUserLabel(message.user)} sent a prompt.`
        : `Telegram ${getTelegramUserLabel(message.user)} queued a ${deliverAs} message.`,
    );
    if (!idle) {
      await this.api.sendPlainText(message.chat.id, `Pi is busy; your message was queued as ${deliverAs}.`);
      return;
    }
    if (!activityStarted) {
      await this.api.sendPlainText(message.chat.id, "Prompt delivered to Pi.");
    }
  }

  private async revokeBinding(route: SessionRoute, auditMessage: string): Promise<void> {
    route.binding = undefined;
    await this.store.revokeBinding(route.sessionKey);
    route.actions.persistBinding(null, true);
    route.actions.appendAudit(auditMessage);
  }

  private statusOf(route: SessionRoute, online: boolean): SessionStatusSnapshot {
    return {
      sessionKey: route.sessionKey,
      sessionLabel: route.sessionLabel,
      sessionId: route.sessionId,
      sessionFile: route.sessionFile,
      online,
      busy: !isEffectivelyIdle(route),
      modelId: formatModelId(route.actions.getModel()),
      lastActivityAt: route.lastActivityAt,
      binding: route.binding,
      notification: route.notification,
    };
  }

  async notifyTurnCompleted(route: SessionRoute, status: "completed" | "failed" | "aborted"): Promise<void> {
    this.clearActivityIndicator(route);
    if (!route.binding || route.binding.paused) return;
    const notification = route.notification;
    const durationMs = notification.startedAt ? Date.now() - notification.startedAt : undefined;
    const durationLabel = durationMs ? `${Math.round(durationMs / 1000)}s` : "unknown time";

    if (status === "completed" && notification.lastAssistantText) {
      const summary = await summarizeForTelegram(notification.lastAssistantText, this.config.summaryMode, route.actions.context);
      notification.lastSummary = summary;
      await this.api.sendPlainText(
        route.binding.chatId,
        `✅ Pi task completed in ${durationLabel}\n\n${summary}\n\nUse /full for the full assistant output.`,
      );
      if (notification.structuredAnswer) {
        await this.api.sendPlainText(route.binding.chatId, summarizeTailForTelegram(notification.structuredAnswer));
      }
      return;
    }

    if (status === "aborted") {
      await this.api.sendPlainText(route.binding.chatId, `⏹️ Pi task aborted after ${durationLabel}.`);
      return;
    }

    const failure = notification.lastFailure || "The Pi task ended without a final assistant response.";
    await this.api.sendPlainText(route.binding.chatId, `❌ Pi task failed after ${durationLabel}\n\n${failure}`);
  }
}

type RuntimeRegistry = Map<string, TunnelRuntime>;

function getRuntimeRegistry(): RuntimeRegistry {
  const globalKey = "__piTelegramTunnelRuntimeRegistry";
  const globalValue = globalThis as typeof globalThis & { [globalKey]?: RuntimeRegistry };
  if (!globalValue[globalKey]) {
    globalValue[globalKey] = new Map();
  }
  return globalValue[globalKey]!;
}

export function getOrCreateTunnelRuntime(config: TelegramTunnelConfig): TunnelRuntime {
  const key = config.botToken;
  const registry = getRuntimeRegistry();
  const existing = registry.get(key);
  if (existing) return existing;
  const runtime = new BrokerTunnelRuntime(config);
  registry.set(key, runtime);
  return runtime;
}

export async function sendSessionNotification(
  runtime: TunnelRuntime,
  route: SessionRoute,
  status: "completed" | "failed" | "aborted",
): Promise<void> {
  if (runtime instanceof InProcessTunnelRuntime) {
    await runtime.notifyTurnCompleted(route, status);
    return;
  }

  if (!route.binding) return;
  if (status === "completed") {
    route.notification.lastSummary = summarizeTextDeterministically(
      route.notification.lastAssistantText ?? "Pi task completed.",
    );
    await runtime.registerRoute(route);
  }
  const fallback = status === "completed"
    ? route.notification.lastSummary ?? summarizeTextDeterministically(route.notification.lastAssistantText ?? "Pi task completed.")
    : route.notification.lastFailure ?? `Pi task ${status}.`;
  await runtime.sendToBoundChat(route.sessionKey, fallback);
}
