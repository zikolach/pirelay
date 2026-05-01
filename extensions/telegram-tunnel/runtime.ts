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
  buildFreeTextChoiceInjection,
  classifyAnswerIntent,
  isGuidedAnswerStart,
  isGuidedAnswerCancel,
  matchChoiceOption,
  renderGuidedAnswerPrompt,
  startGuidedAnswerFlow,
  summarizeTailForTelegram,
} from "./answer-workflow.js";
import {
  buildAnswerAmbiguityKeyboard,
  buildAnswerActionKeyboard,
  buildFullOutputKeyboard,
  buildLatestImagesKeyboard,
  parseTelegramActionCallbackData,
  shouldOfferFullOutputActions,
} from "./telegram-actions.js";
import type {
  LatestTurnImage,
  SessionRoute,
  SessionStatusSnapshot,
  SetupCache,
  TelegramBindingMetadata,
  TelegramDownloadedImage,
  TelegramInboundCallback,
  TelegramInboundImageReference,
  TelegramInboundMessage,
  TelegramInboundUpdate,
  TelegramPromptContent,
  TelegramTunnelConfig,
  TunnelRuntime,
  TelegramUserSummary,
} from "./types.js";
import {
  buildImagePromptContent,
  createTurnId,
  formatModelId,
  getTelegramUserLabel,
  isAllowedImageMimeType,
  modelSupportsImages,
  parseTelegramCommand,
  safeTelegramFilename,
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
  "/images - download latest image outputs or generated image files",
  "/send-image <path> - send a validated workspace image file",
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
const CUSTOM_ANSWER_EXPIRY_MS = 10 * 60_000;
const ANSWER_AMBIGUITY_EXPIRY_MS = 5 * 60_000;

interface PendingCustomAnswerState {
  sessionKey: string;
  chatId: number;
  userId: number;
  turnId: string;
  expiresAt: number;
}

interface PendingAnswerAmbiguityState {
  sessionKey: string;
  chatId: number;
  userId: number;
  turnId: string;
  text: string;
  expiresAt: number;
}

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
  private readonly pendingCustomAnswers = new Map<string, PendingCustomAnswerState>();
  private readonly pendingAnswerAmbiguities = new Map<string, PendingAnswerAmbiguityState>();
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
    if (previousRoute && this.currentTurnId(previousRoute) !== this.currentTurnId(route)) {
      this.clearAnswerStateForRoute(previousRoute);
    } else if (!route.notification.structuredAnswer) {
      this.answerFlows.delete(this.answerFlowKey(route));
    }
    this.clearStaleCustomAnswers(route);
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
      this.clearAnswerStateForRoute(route);
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
    const sourcePrefix = this.sourcePrefixForRoute(route);
    await this.api.sendPlainTextWithKeyboard(route.binding.chatId, `${sourcePrefix}${text}`, this.completionActionKeyboardForRoute(route));
    if (route.notification.lastStatus === "completed" && route.notification.structuredAnswer) {
      await this.api.sendPlainTextWithKeyboard(
        route.binding.chatId,
        summarizeTailForTelegram(route.notification.structuredAnswer, {
          includeFullOutputActions: this.shouldOfferFullOutputActionsForRoute(route),
        }),
        this.answerActionKeyboardForRoute(route),
      );
    }
  }

  private answerFlowKey(route: SessionRoute): string {
    return `${route.sessionKey}:${route.binding?.chatId ?? "unbound"}`;
  }

  private customAnswerKey(sessionKey: string, chatId: number, userId: number): string {
    return `${sessionKey}:${chatId}:${userId}`;
  }

  private currentTurnId(route: SessionRoute): string | undefined {
    return route.notification.structuredAnswer?.turnId ?? route.notification.lastTurnId;
  }

  private ambiguityKey(sessionKey: string, chatId: number, userId: number, token: string): string {
    return `${sessionKey}:${chatId}:${userId}:${token}`;
  }

  private createAmbiguityToken(): string {
    return createTurnId();
  }

  private fullOutputKeyboardForRoute(route: SessionRoute) {
    if (!this.shouldOfferFullOutputActionsForRoute(route)) return undefined;
    const turnId = this.currentTurnId(route);
    return route.notification.lastAssistantText && turnId ? buildFullOutputKeyboard(turnId) : undefined;
  }

  private latestImagesKeyboardForRoute(route: SessionRoute) {
    const latestImages = route.notification.latestImages;
    if (!latestImages || latestImages.count <= 0) return undefined;
    return buildLatestImagesKeyboard(latestImages.turnId, latestImages.count);
  }

  private combineKeyboards(...keyboards: Array<ReturnType<typeof buildFullOutputKeyboard> | undefined>) {
    const rows = keyboards.flatMap((keyboard) => keyboard ?? []);
    return rows.length > 0 ? rows : undefined;
  }

  private completionActionKeyboardForRoute(route: SessionRoute) {
    if (route.notification.structuredAnswer) return undefined;
    return this.combineKeyboards(
      this.fullOutputKeyboardForRoute(route),
      this.latestImagesKeyboardForRoute(route),
    );
  }

  private shouldOfferFullOutputActionsForRoute(route: SessionRoute): boolean {
    return shouldOfferFullOutputActions(route.notification.lastAssistantText);
  }

  private answerActionKeyboardForRoute(route: SessionRoute) {
    if (!route.notification.structuredAnswer) return undefined;
    const keyboard = buildAnswerActionKeyboard(route.notification.structuredAnswer, {
      includeFullOutputActions: this.shouldOfferFullOutputActionsForRoute(route),
    });
    const imageKeyboard = this.latestImagesKeyboardForRoute(route);
    if (imageKeyboard) keyboard.push(...imageKeyboard);
    return keyboard.length > 0 ? keyboard : undefined;
  }

  private clearCustomAnswersForRoute(route: SessionRoute): void {
    for (const [key, pending] of this.pendingCustomAnswers.entries()) {
      if (pending.sessionKey === route.sessionKey) this.pendingCustomAnswers.delete(key);
    }
  }

  private clearAmbiguitiesForRoute(route: SessionRoute): void {
    for (const [key, pending] of this.pendingAnswerAmbiguities.entries()) {
      if (pending.sessionKey === route.sessionKey) this.pendingAnswerAmbiguities.delete(key);
    }
  }

  private clearAnswerStateForRoute(route: SessionRoute): void {
    this.answerFlows.delete(this.answerFlowKey(route));
    this.clearCustomAnswersForRoute(route);
    this.clearAmbiguitiesForRoute(route);
  }

  private clearStaleCustomAnswers(route: SessionRoute): void {
    const currentTurnId = this.currentTurnId(route);
    const now = Date.now();
    for (const [key, pending] of this.pendingCustomAnswers.entries()) {
      if (pending.sessionKey !== route.sessionKey) continue;
      if (pending.expiresAt <= now || pending.turnId !== currentTurnId) {
        this.pendingCustomAnswers.delete(key);
      }
    }
  }

  private setPendingCustomAnswer(route: SessionRoute, user: TelegramUserSummary, turnId: string): void {
    if (!route.binding) return;
    this.pendingCustomAnswers.set(this.customAnswerKey(route.sessionKey, route.binding.chatId, user.id), {
      sessionKey: route.sessionKey,
      chatId: route.binding.chatId,
      userId: user.id,
      turnId,
      expiresAt: Date.now() + CUSTOM_ANSWER_EXPIRY_MS,
    });
  }

  private takePendingCustomAnswer(route: SessionRoute, user: TelegramUserSummary): PendingCustomAnswerState | undefined {
    if (!route.binding) return undefined;
    const key = this.customAnswerKey(route.sessionKey, route.binding.chatId, user.id);
    const pending = this.pendingCustomAnswers.get(key);
    if (!pending) return undefined;
    this.pendingCustomAnswers.delete(key);
    return pending;
  }

  private setPendingAmbiguity(route: SessionRoute, user: TelegramUserSummary, turnId: string, text: string): string | undefined {
    if (!route.binding) return undefined;
    const token = this.createAmbiguityToken();
    this.pendingAnswerAmbiguities.set(this.ambiguityKey(route.sessionKey, route.binding.chatId, user.id, token), {
      sessionKey: route.sessionKey,
      chatId: route.binding.chatId,
      userId: user.id,
      turnId,
      text,
      expiresAt: Date.now() + ANSWER_AMBIGUITY_EXPIRY_MS,
    });
    return token;
  }

  private takePendingAmbiguity(route: SessionRoute, user: TelegramUserSummary, token: string): PendingAnswerAmbiguityState | undefined {
    if (!route.binding) return undefined;
    const key = this.ambiguityKey(route.sessionKey, route.binding.chatId, user.id, token);
    const pending = this.pendingAnswerAmbiguities.get(key);
    if (!pending) return undefined;
    this.pendingAnswerAmbiguities.delete(key);
    return pending;
  }

  private findPendingAmbiguity(route: SessionRoute, user: TelegramUserSummary): [string, PendingAnswerAmbiguityState] | undefined {
    if (!route.binding) return undefined;
    const prefix = `${route.sessionKey}:${route.binding.chatId}:${user.id}:`;
    for (const [key, pending] of this.pendingAnswerAmbiguities.entries()) {
      if (key.startsWith(prefix)) return [key.slice(prefix.length), pending];
    }
    return undefined;
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
        const updates = await this.api.getUpdates(this.updateOffset);
        for (const update of updates) {
          this.updateOffset = update.updateId + 1;
          await this.processInbound(update);
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

  private async processInbound(message: TelegramInboundUpdate): Promise<void> {
    if (message.kind === "callback") {
      await this.processCallback(message);
      return;
    }

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

    await this.handleAuthorizedMessage(route, message);
  }

  private async processCallback(callback: TelegramInboundCallback): Promise<void> {
    const action = parseTelegramActionCallbackData(callback.data);
    if (!action) {
      await this.api.answerCallbackQuery(callback.callbackQueryId, "Unknown action.");
      return;
    }

    const persisted = await this.store.getBindingByChatId(callback.chat.id);
    if (!persisted || persisted.status === "revoked") {
      await this.api.answerCallbackQuery(callback.callbackQueryId, "This chat is not paired.");
      return;
    }

    const route = this.routes.get(persisted.sessionKey);
    if (!route) {
      await this.api.answerCallbackQuery(callback.callbackQueryId, "Pi session is offline.");
      await this.api.sendPlainText(callback.chat.id, `The paired Pi session (${persisted.sessionLabel}) is currently offline. Resume it locally, then try again.`);
      return;
    }

    if (!route.binding || !(await this.isAuthorized(route, callback.user))) {
      await this.api.answerCallbackQuery(callback.callbackQueryId, "Unauthorized.");
      return;
    }

    if (route.binding.paused) {
      await this.api.answerCallbackQuery(callback.callbackQueryId, "Tunnel paused.");
      return;
    }

    const currentTurnId = this.currentTurnId(route);
    if (!currentTurnId || action.turnId !== currentTurnId) {
      await this.api.answerCallbackQuery(callback.callbackQueryId, "This action is no longer current.");
      await this.api.sendPlainText(
        callback.chat.id,
        action.kind === "latest-images"
          ? "That image action belongs to an older Pi output. Use the latest buttons or /images."
          : "That Telegram action belongs to an older Pi output. Use the latest buttons or /full.",
      );
      return;
    }

    switch (action.kind) {
      case "answer-option": {
        const metadata = hasAnswerableLatestOutput(route) ? route.notification.structuredAnswer : undefined;
        const option = metadata?.kind === "choice" ? matchChoiceOption(metadata, action.optionId) : undefined;
        if (!metadata || !option) {
          await this.api.answerCallbackQuery(callback.callbackQueryId, "No matching option.");
          return;
        }
        this.answerFlows.delete(this.answerFlowKey(route));
        this.takePendingCustomAnswer(route, callback.user);
        await this.startActivityIndicator(route);
        route.actions.sendUserMessage(buildChoiceInjection(metadata, option), isEffectivelyIdle(route)
          ? undefined
          : { deliverAs: this.config.busyDeliveryMode });
        route.actions.appendAudit(`Telegram ${getTelegramUserLabel(callback.user)} selected an inline answer option.`);
        await this.api.answerCallbackQuery(callback.callbackQueryId, `Selected ${option.id}`);
        return;
      }
      case "answer-custom": {
        const metadata = hasAnswerableLatestOutput(route) ? route.notification.structuredAnswer : undefined;
        if (!metadata || metadata.kind !== "choice") {
          await this.api.answerCallbackQuery(callback.callbackQueryId, "No custom answer is available.");
          return;
        }
        this.setPendingCustomAnswer(route, callback.user, action.turnId);
        await this.api.answerCallbackQuery(callback.callbackQueryId, "Send your custom answer.");
        await this.api.sendPlainText(callback.chat.id, "Send your custom answer as the next message, or send 'cancel' to stop.");
        return;
      }
      case "answer-ambiguity": {
        const pending = this.takePendingAmbiguity(route, callback.user, action.token);
        if (!pending || pending.expiresAt <= Date.now() || pending.turnId !== currentTurnId) {
          await this.api.answerCallbackQuery(callback.callbackQueryId, "This confirmation is no longer current.");
          await this.api.sendPlainText(callback.chat.id, "That answer confirmation is no longer current. Send your message again if needed.");
          return;
        }
        await this.api.answerCallbackQuery(callback.callbackQueryId, action.resolution === "prompt" ? "Sending as prompt." : action.resolution === "answer" ? "Answering previous." : "Cancelled.");
        await this.resolveAmbiguity(route, {
          kind: "message",
          updateId: callback.updateId,
          messageId: callback.messageId ?? 0,
          text: pending.text,
          chat: callback.chat,
          user: callback.user,
        }, pending, action.resolution);
        return;
      }
      case "full-chat": {
        const text = route.notification.lastAssistantText;
        await this.api.answerCallbackQuery(callback.callbackQueryId, text ? "Sending full output." : "No output available.");
        await this.api.sendPlainText(callback.chat.id, text ? text : "No completed assistant output is available yet for this session.");
        return;
      }
      case "full-markdown": {
        const text = route.notification.lastAssistantText;
        if (!text) {
          await this.api.answerCallbackQuery(callback.callbackQueryId, "No output available.");
          await this.api.sendPlainText(callback.chat.id, "No completed assistant output is available yet for this session.");
          return;
        }
        await this.api.answerCallbackQuery(callback.callbackQueryId, "Sending Markdown file.");
        await this.api.sendMarkdownDocument(
          callback.chat.id,
          safeTelegramFilename(`pi-output-${route.sessionId}-${currentTurnId}`, "md"),
          text,
          "Latest assistant output",
        );
        return;
      }
      case "latest-images": {
        const latest = route.notification.latestImages;
        if (!latest || latest.turnId !== action.turnId) {
          await this.api.answerCallbackQuery(callback.callbackQueryId, "No current images.");
          await this.api.sendPlainText(callback.chat.id, "That image action is no longer current. Use the latest buttons or /images.");
          return;
        }
        await this.api.answerCallbackQuery(callback.callbackQueryId, "Sending image outputs.");
        await this.sendLatestImages(route, callback.chat.id);
        return;
      }
    }
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

  private acceptedImageFormatsText(): string {
    return this.config.allowedImageMimeTypes.join(", ");
  }

  private messageImages(message: TelegramInboundMessage): TelegramInboundImageReference[] {
    return message.images ?? [];
  }

  private hasImageAttachments(message: TelegramInboundMessage): boolean {
    return this.messageImages(message).length > 0;
  }

  private promptTextForMessage(message: TelegramInboundMessage, fallback?: string): string {
    const text = message.text.trim();
    if (text) return text;
    if (fallback) return fallback;
    return this.messageImages(message).length > 1 ? "Please inspect the attached images." : "Please inspect the attached image.";
  }

  private async downloadAuthorizedImages(route: SessionRoute, message: TelegramInboundMessage): Promise<TelegramDownloadedImage[] | undefined> {
    const references = this.messageImages(message);
    if (references.length === 0) return [];

    const unsupported = references.filter((reference) => !reference.supported);
    if (unsupported.length > 0) {
      await this.api.sendPlainText(
        message.chat.id,
        `Unsupported image attachment. Accepted image formats: ${this.acceptedImageFormatsText()}.`,
      );
      return undefined;
    }

    if (!modelSupportsImages(route.actions.getModel())) {
      await this.api.sendPlainText(
        message.chat.id,
        "The current Pi model does not support image input. Switch to an image-capable model or resend text only.",
      );
      return undefined;
    }

    const downloaded: TelegramDownloadedImage[] = [];
    try {
      for (const reference of references) {
        downloaded.push(await this.api.downloadImage(reference));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.api.sendPlainText(message.chat.id, `Could not fetch the Telegram image: ${detail}`);
      return undefined;
    }
    return downloaded;
  }

  private async deliverAuthorizedPrompt(
    route: SessionRoute,
    message: TelegramInboundMessage,
    text: string,
    options: { deliverAs?: "followUp" | "steer"; auditMessage: string; busyAck?: string; idleAck?: string },
  ): Promise<void> {
    const downloadedImages = await this.downloadAuthorizedImages(route, message);
    if (!downloadedImages) return;
    const hasImages = downloadedImages.length > 0;
    const content: TelegramPromptContent = hasImages
      ? buildImagePromptContent(text || "Please inspect the attached image.", downloadedImages.map((image) => image.image))
      : text;
    const activityStarted = await this.startActivityIndicator(route);
    route.actions.sendUserMessage(content, options.deliverAs ? { deliverAs: options.deliverAs } : undefined);
    route.actions.appendAudit(options.auditMessage);
    if (options.busyAck) {
      await this.api.sendPlainText(message.chat.id, options.busyAck);
      return;
    }
    if (options.idleAck) {
      await this.api.sendPlainText(message.chat.id, options.idleAck);
      return;
    }
    if (!activityStarted) {
      await this.api.sendPlainText(message.chat.id, "Prompt delivered to Pi.");
    }
  }

  private emptyImagesMessage(hasCandidates = false): string {
    if (hasCandidates) {
      return "The latest Pi output mentioned image-like file paths, but none could be sent. They may be missing, outside the workspace, hidden, unsupported, or too large. Try /send-image <relative-path> for a specific workspace PNG/JPEG/WebP file, or ask Pi to regenerate the image.";
    }
    return "No image outputs are available for the latest completed Pi turn. /images can send captured image outputs or safe workspace image files mentioned in the latest Pi reply. If Pi saved an image file, use /send-image <relative-path>.";
  }

  private async sendImageByPath(route: SessionRoute, chatId: number, relativePath: string): Promise<void> {
    const loaded = await route.actions.getImageByPath(relativePath);
    if (!loaded.ok) {
      await this.api.sendPlainText(chatId, loaded.error);
      return;
    }
    if (!isAllowedImageMimeType(loaded.image.mimeType, this.config.allowedImageMimeTypes) || loaded.image.byteSize > this.config.maxOutboundImageBytes) {
      await this.api.sendPlainText(chatId, "Image file is too large or unsupported for Telegram delivery.");
      return;
    }
    await this.api.sendImageDocument(chatId, loaded.image, "Pi image file");
  }

  private async sendLatestImages(route: SessionRoute, chatId: number): Promise<void> {
    const latest = route.notification.latestImages;
    const images = await route.actions.getLatestImages();
    if (!latest || latest.count <= 0) {
      await this.api.sendPlainText(chatId, this.emptyImagesMessage(false));
      return;
    }
    if (images.length === 0) {
      await this.api.sendPlainText(chatId, this.emptyImagesMessage(Boolean(latest.fileCount && latest.fileCount > 0)));
      return;
    }

    let sent = 0;
    let skipped = latest.skipped;
    for (const image of images) {
      if (!isAllowedImageMimeType(image.mimeType, this.config.allowedImageMimeTypes) || image.byteSize > this.config.maxOutboundImageBytes) {
        skipped += 1;
        continue;
      }
      await this.api.sendImageDocument(
        chatId,
        image,
        images.length === 1 ? "Latest Pi image output" : `Latest Pi image output ${sent + 1}/${images.length}`,
      );
      sent += 1;
    }

    if (sent === 0) {
      await this.api.sendPlainText(chatId, "Latest image outputs are too large or unsupported for Telegram delivery.");
      return;
    }
    if (skipped > 0) {
      await this.api.sendPlainText(chatId, `Skipped ${skipped} image output(s) because they were too large or unsupported.`);
    }
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
      case "images": {
        await this.sendLatestImages(route, message.chat.id);
        return;
      }
      case "send-image":
      case "sendimage": {
        if (!args) {
          await this.api.sendPlainText(message.chat.id, "Usage: /send-image <relative-image-path>");
          return;
        }
        await this.sendImageByPath(route, message.chat.id, args);
        return;
      }
      case "steer": {
        if (!args && !this.hasImageAttachments(message)) {
          await this.api.sendPlainText(message.chat.id, "Usage: /steer <text>");
          return;
        }
        const idle = isEffectivelyIdle(route);
        await this.deliverAuthorizedPrompt(route, message, args || "Please inspect the attached image.", {
          deliverAs: idle ? undefined : "steer",
          auditMessage: `Telegram ${getTelegramUserLabel(message.user)} sent a steering instruction.`,
          idleAck: idle ? "Sent as a prompt." : undefined,
          busyAck: idle ? undefined : "Steering queued.",
        });
        return;
      }
      case "followup": {
        if (!args && !this.hasImageAttachments(message)) {
          await this.api.sendPlainText(message.chat.id, "Usage: /followup <text>");
          return;
        }
        const idle = isEffectivelyIdle(route);
        await this.deliverAuthorizedPrompt(route, message, args || "Please inspect the attached image.", {
          deliverAs: idle ? undefined : "followUp",
          auditMessage: `Telegram ${getTelegramUserLabel(message.user)} queued a follow-up.`,
          idleAck: idle ? "Sent as a prompt." : undefined,
          busyAck: idle ? undefined : "Follow-up queued.",
        });
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
        this.clearAnswerStateForRoute(route);
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

  private async deliverPlainPrompt(route: SessionRoute, message: TelegramInboundMessage, text: string): Promise<void> {
    this.clearAnswerStateForRoute(route);
    const idle = isEffectivelyIdle(route);
    const deliverAs = idle ? undefined : this.config.busyDeliveryMode;
    const activityStarted = await this.startActivityIndicator(route);
    route.actions.sendUserMessage(text, deliverAs ? { deliverAs } : undefined);
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

  private ambiguityTextChoice(text: string): "prompt" | "answer" | "cancel" | undefined {
    const normalized = text.trim().toLowerCase();
    if (["send as prompt", "as prompt", "prompt"].includes(normalized)) return "prompt";
    if (["answer previous", "as answer", "answer"].includes(normalized)) return "answer";
    if (isGuidedAnswerCancel(normalized)) return "cancel";
    return undefined;
  }

  private async resolveAmbiguity(route: SessionRoute, message: TelegramInboundMessage, pending: PendingAnswerAmbiguityState, resolution: "prompt" | "answer" | "cancel"): Promise<void> {
    const currentTurnId = this.currentTurnId(route);
    const metadata = hasAnswerableLatestOutput(route) ? route.notification.structuredAnswer : undefined;
    if (resolution === "cancel") {
      await this.api.sendPlainText(message.chat.id, "Cancelled.");
      return;
    }
    if (pending.expiresAt <= Date.now() || pending.turnId !== currentTurnId) {
      await this.api.sendPlainText(message.chat.id, "That answer confirmation is no longer current. Send your message again if needed.");
      return;
    }
    if (resolution === "prompt") {
      await this.deliverPlainPrompt(route, message, pending.text);
      return;
    }
    if (!metadata) {
      await this.api.sendPlainText(message.chat.id, "There is no current answerable output. Send your message again as a normal prompt.");
      return;
    }
    const result = advanceGuidedAnswerFlow(metadata, startGuidedAnswerFlow(), pending.text);
    if (!result.done || !result.injectionText) {
      await this.api.sendPlainText(message.chat.id, "I could not use that text as a complete answer. Send 'answer' to open the guided answer flow.");
      return;
    }
    this.clearAnswerStateForRoute(route);
    await this.startActivityIndicator(route);
    route.actions.sendUserMessage(result.injectionText, isEffectivelyIdle(route) ? undefined : { deliverAs: this.config.busyDeliveryMode });
    route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} answered a guided Telegram question flow.`);
    await this.api.sendPlainText(message.chat.id, result.responseText);
  }

  private async handleAuthorizedMessage(route: SessionRoute, message: TelegramInboundMessage): Promise<void> {
    const binding = route.binding;
    if (!binding) return;
    if (binding.paused) {
      await this.api.sendPlainText(message.chat.id, "The tunnel is paused. Use /resume first.");
      return;
    }

    if (this.hasImageAttachments(message)) {
      this.clearAnswerStateForRoute(route);
      const idle = isEffectivelyIdle(route);
      const deliverAs = idle ? undefined : this.config.busyDeliveryMode;
      await this.deliverAuthorizedPrompt(route, message, this.promptTextForMessage(message), {
        deliverAs,
        auditMessage: idle
          ? `Telegram ${getTelegramUserLabel(message.user)} sent an image prompt.`
          : `Telegram ${getTelegramUserLabel(message.user)} queued an image ${deliverAs} message.`,
        busyAck: idle ? undefined : `Pi is busy; your message was queued as ${deliverAs}.`,
      });
      return;
    }

    const pendingAmbiguity = this.findPendingAmbiguity(route, message.user);
    const ambiguityResolution = pendingAmbiguity ? this.ambiguityTextChoice(message.text) : undefined;
    if (pendingAmbiguity && ambiguityResolution) {
      this.pendingAnswerAmbiguities.delete(this.ambiguityKey(route.sessionKey, message.chat.id, message.user.id, pendingAmbiguity[0]));
      await this.resolveAmbiguity(route, message, pendingAmbiguity[1], ambiguityResolution);
      return;
    }

    const pendingCustom = this.takePendingCustomAnswer(route, message.user);
    if (pendingCustom) {
      if (isGuidedAnswerCancel(message.text)) {
        await this.api.sendPlainText(message.chat.id, "Custom answer cancelled.");
        return;
      }
      const currentTurnId = this.currentTurnId(route);
      const metadata = hasAnswerableLatestOutput(route) ? route.notification.structuredAnswer : undefined;
      if (pendingCustom.expiresAt <= Date.now() || pendingCustom.turnId !== currentTurnId || !metadata || metadata.kind !== "choice") {
        await this.api.sendPlainText(message.chat.id, "That custom answer request is no longer current. Use the latest buttons or send a normal prompt.");
        return;
      }
      await this.startActivityIndicator(route);
      route.actions.sendUserMessage(buildFreeTextChoiceInjection(metadata, message.text), isEffectivelyIdle(route)
        ? undefined
        : { deliverAs: this.config.busyDeliveryMode });
      route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} sent a custom inline answer.`);
      await this.api.sendPlainText(message.chat.id, "Sent your custom answer to Pi.");
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

    const intent = classifyAnswerIntent(metadata, message.text);
    if (intent.kind === "start-flow") {
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

    if (metadata && (intent.kind === "bare-option" || (intent.kind === "explicit-answer" && intent.option))) {
      const option = intent.kind === "bare-option" ? intent.option : intent.option!;
      this.clearAnswerStateForRoute(route);
      await this.startActivityIndicator(route);
      route.actions.sendUserMessage(buildChoiceInjection(metadata, option), isEffectivelyIdle(route)
        ? undefined
        : { deliverAs: this.config.busyDeliveryMode });
      route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} answered a guided Telegram question flow.`);
      await this.api.sendPlainText(message.chat.id, `Selected option ${option.id}: ${option.label}`);
      return;
    }

    if (metadata && intent.kind === "explicit-answer") {
      const result = advanceGuidedAnswerFlow(metadata, startGuidedAnswerFlow(), message.text);
      if (result.done && result.injectionText) {
        this.clearAnswerStateForRoute(route);
        await this.startActivityIndicator(route);
        route.actions.sendUserMessage(result.injectionText, isEffectivelyIdle(route) ? undefined : { deliverAs: this.config.busyDeliveryMode });
        route.actions.appendAudit(`Telegram ${getTelegramUserLabel(message.user)} answered a guided Telegram question flow.`);
        await this.api.sendPlainText(message.chat.id, result.responseText);
        return;
      }
    }

    if (metadata && intent.kind === "ambiguous") {
      const turnId = this.currentTurnId(route);
      const token = turnId ? this.setPendingAmbiguity(route, message.user, turnId, message.text) : undefined;
      if (turnId && token) {
        await this.api.sendPlainTextWithKeyboard(
          message.chat.id,
          "This could be an answer to the previous Pi question or a new prompt. What should I do?\n\nYou can also reply: 'send as prompt', 'answer previous', or 'cancel'.",
          buildAnswerAmbiguityKeyboard(turnId, token),
        );
        return;
      }
    }

    await this.deliverPlainPrompt(route, message, message.text);
  }

  private async revokeBinding(route: SessionRoute, auditMessage: string): Promise<void> {
    route.binding = undefined;
    await this.store.revokeBinding(route.sessionKey);
    route.actions.persistBinding(null, true);
    route.actions.appendAudit(auditMessage);
  }

  private hasMultipleLiveSessionsForRoute(route: SessionRoute): boolean {
    if (!route.binding) return false;
    let count = 0;
    for (const candidate of this.routes.values()) {
      if (candidate.binding?.chatId !== route.binding.chatId || candidate.binding?.userId !== route.binding.userId) continue;
      count += 1;
      if (count > 1) return true;
    }
    return false;
  }

  private sourcePrefixForRoute(route: SessionRoute): string {
    return this.hasMultipleLiveSessionsForRoute(route) ? `Session ${route.sessionLabel}\n\n` : "";
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
    this.clearAnswerStateForRoute(route);
    if (!route.binding || route.binding.paused) return;
    const notification = route.notification;
    const durationMs = notification.startedAt ? Date.now() - notification.startedAt : undefined;
    const durationLabel = durationMs ? `${Math.round(durationMs / 1000)}s` : "unknown time";

    const sourcePrefix = this.sourcePrefixForRoute(route);

    if (status === "completed" && notification.lastAssistantText) {
      const summary = await summarizeForTelegram(notification.lastAssistantText, this.config.summaryMode, route.actions.context);
      notification.lastSummary = summary;
      const fullOutputKeyboard = route.notification.structuredAnswer ? undefined : this.fullOutputKeyboardForRoute(route);
      const actionKeyboard = route.notification.structuredAnswer
        ? undefined
        : this.combineKeyboards(fullOutputKeyboard, this.latestImagesKeyboardForRoute(route));
      const fullOutputHint = fullOutputKeyboard ? "\n\nUse /full for the full assistant output." : "";
      const imageHint = !route.notification.structuredAnswer && notification.latestImages?.count
        ? `\n\n🖼 ${notification.latestImages.count} image output/file(s) available. Use /images to download.`
        : "";
      await this.api.sendPlainTextWithKeyboard(
        route.binding.chatId,
        `${sourcePrefix}✅ Pi task completed in ${durationLabel}\n\n${summary}${fullOutputHint}${imageHint}`,
        actionKeyboard,
      );
      if (notification.structuredAnswer) {
        await this.api.sendPlainTextWithKeyboard(
          route.binding.chatId,
          summarizeTailForTelegram(notification.structuredAnswer, {
            includeFullOutputActions: this.shouldOfferFullOutputActionsForRoute(route),
          }),
          this.answerActionKeyboardForRoute(route),
        );
      }
      return;
    }

    if (status === "aborted") {
      await this.api.sendPlainText(route.binding.chatId, `${sourcePrefix}⏹️ Pi task aborted after ${durationLabel}.`);
      return;
    }

    const failure = notification.lastFailure || "The Pi task ended without a final assistant response.";
    await this.api.sendPlainText(route.binding.chatId, `${sourcePrefix}❌ Pi task failed after ${durationLabel}\n\n${failure}`);
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
  const imageHint = status === "completed" && !route.notification.structuredAnswer && route.notification.latestImages?.count
    ? `\n\n🖼 ${route.notification.latestImages.count} image output/file(s) available. Use /images to download.`
    : "";
  await runtime.sendToBoundChat(route.sessionKey, `${fallback}${imageHint}`);
}
