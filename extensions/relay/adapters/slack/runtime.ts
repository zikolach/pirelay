import { appendFileSync } from "node:fs";
import type { ChannelInboundAction, ChannelInboundEvent, ChannelInboundMessage, ChannelRouteAddress } from "../../core/channel-adapter.js";
import type { ChannelPersistedBindingRecord, PairingApprovalDecision, SessionRoute, TelegramTunnelConfig } from "../../core/types.js";
import { redactSecrets } from "../../config/setup.js";
import { completeSlackPairing } from "../channel-pairing.js";
import { TunnelStateStore } from "../../state/tunnel-store.js";
import { buildHelpText, commandAllowsWhilePaused, normalizeAliasArg, parseRemoteCommandInvocation } from "../../commands/remote.js";
import { formatFullOutput, formatRelayRecentActivity, formatRelayStatusForRoute, formatSessionSelectorError, formatSummaryOutput, sessionEntryForRoute } from "../../formatting/presenters.js";
import { formatSessionList, resolveSessionSelector, resolveSessionTargetArgs, type SessionListEntry } from "../../core/session-selection.js";
import { normalizeProgressMode } from "../../notifications/progress.js";
import { SlackChannelAdapter, isSlackIdentityAllowed, slackEnvelopeToChannelEvent, slackEventToChannelEvent, slackMentionedUserIds, type SlackApiOperations, type SlackAuthTestResult, type SlackEnvelope, type SlackMessageEvent } from "./adapter.js";
import { createSlackLiveOperations, type SlackMessageEventFromHistory } from "./live-client.js";

const SLACK_CHANNEL = "slack" as const;
const SLACK_HELP_TEXT = buildHelpText({ title: "PiRelay Slack commands:", commandPrefix: "/" });

export interface SlackRuntimeOptions {
  operations?: SlackApiOperations;
}

export interface SlackRuntimeStatus {
  enabled: boolean;
  started: boolean;
  error?: string;
}

export class SlackRuntime {
  private readonly store: TunnelStateStore;
  private readonly adapter?: SlackChannelAdapter;
  private readonly operations?: SlackApiOperations;
  private readonly routes = new Map<string, SessionRoute>();
  private readonly ownedBindingSessionKeys = new Set<string>();
  private readonly recentBindingBySessionKey = new Map<string, ChannelPersistedBindingRecord>();
  private historyPollTimer?: ReturnType<typeof setInterval>;
  private latestHistoryTs = (Date.now() / 1_000).toFixed(6);
  private readonly seenEventKeys = new Map<string, number>();
  private botIdentity?: SlackAuthTestResult;
  private started = false;
  private startPromise?: Promise<void>;
  private lastError?: string;

  constructor(
    private readonly config: TelegramTunnelConfig,
    options: SlackRuntimeOptions = {},
    private readonly instanceId = "default",
  ) {
    this.store = new TunnelStateStore(config.stateDir);
    const slackConfig = config.slackInstances?.[this.instanceId] ?? config.slack;
    const operations = options.operations ?? (slackConfig?.enabled && slackConfig.botToken ? createSlackLiveOperations(slackConfig) : undefined);
    this.operations = operations;
    if (slackConfig?.enabled && slackConfig.botToken && operations) {
      this.adapter = new SlackChannelAdapter(slackConfig, operations);
    }
  }

  getStatus(): SlackRuntimeStatus {
    const slackConfig = this.config.slackInstances?.[this.instanceId] ?? this.config.slack;
    return { enabled: Boolean(slackConfig?.enabled && slackConfig.botToken), started: this.started, error: this.lastError };
  }

  async start(): Promise<void> {
    if (!this.adapter || !this.operations?.startSocketMode || this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initializeRuntime()
      .then(() => this.operations!.startSocketMode!(async (envelope) => this.handleEnvelope(envelope)))
      .then(() => {
        this.started = true;
        this.lastError = undefined;
        this.startHistoryPollingFallback();
      })
      .catch((error: unknown) => {
        this.started = false;
        this.lastError = safeSlackRuntimeError(error);
        throw new Error(this.lastError);
      })
      .finally(() => {
        this.startPromise = undefined;
      });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.historyPollTimer) clearInterval(this.historyPollTimer);
    this.historyPollTimer = undefined;
    await this.adapter?.stopPolling?.();
  }

  async registerRoute(route: SessionRoute): Promise<void> {
    this.routes.set(route.sessionKey, route);
    const binding = await this.store.getChannelBindingBySessionKey(SLACK_CHANNEL, route.sessionKey, this.instanceId);
    if (binding) {
      this.ownedBindingSessionKeys.add(route.sessionKey);
      this.recentBindingBySessionKey.set(route.sessionKey, binding);
    }
  }

  async unregisterRoute(sessionKey: string): Promise<void> {
    this.routes.delete(sessionKey);
    this.ownedBindingSessionKeys.delete(sessionKey);
    if (this.routes.size === 0) await this.stop();
  }

  async notifyTurnCompleted(route: SessionRoute, status: "completed" | "failed" | "aborted"): Promise<void> {
    if (!this.adapter) return;
    const binding = await this.store.getChannelBindingBySessionKey(SLACK_CHANNEL, route.sessionKey, this.instanceId)
      ?? this.recentBindingBySessionKey.get(route.sessionKey);
    if (!binding || binding.paused && status === "completed") return;
    await this.adapter.sendText(bindingAddress(binding), slackTurnNotificationText(route, status));
  }

  private async initializeRuntime(): Promise<void> {
    const slackConfig = this.configForInstance();
    if (this.operations?.authTest) {
      this.botIdentity = await this.operations.authTest();
      if (slackConfig?.workspaceId && this.botIdentity.teamId !== slackConfig.workspaceId) {
        throw new Error(`Slack workspace mismatch: authenticated workspace ${this.botIdentity.teamId || "unknown"} does not match configured workspace ${slackConfig.workspaceId}.`);
      }
      return;
    }
    const override = slackConfig?.botUserId ?? process.env.PI_RELAY_SLACK_BOT_USER_ID;
    if (override) {
      this.botIdentity = { teamId: slackConfig?.workspaceId ?? "", userId: override };
    }
  }

  private async handleEnvelope(envelope: SlackEnvelope): Promise<void> {
    if (this.isDuplicateEnvelope(envelope)) return;
    const event = this.normalizeEnvelope(envelope);
    if (!event) return;
    if (this.isDuplicateEvent(event)) return;
    await this.handleEvent(event);
  }

  private startHistoryPollingFallback(): void {
    if (this.historyPollTimer) return;
    const slackConfig = this.configForInstance();
    const channelId = slackConfig?.sharedRoom?.roomHint;
    if (!channelId || !hasHistoryReader(this.operations) || process.env.PI_RELAY_SLACK_HISTORY_FALLBACK !== "true") return;
    debugSlackRuntime(`Starting Slack history polling fallback for ${channelId} (local bot ${this.localBotUserId() ?? "unset"}).`);
    this.historyPollTimer = setInterval(() => {
      void this.pollHistory(channelId).catch((error: unknown) => {
        this.lastError = safeSlackRuntimeError(error);
      });
    }, 2_000);
    this.historyPollTimer.unref?.();
  }

  private async pollHistory(channelId: string): Promise<void> {
    if (!hasHistoryReader(this.operations)) return;
    const messages = await this.operations.listChannelMessages(channelId, this.latestHistoryTs);
    debugSlackRuntime(`Slack history polling saw ${messages.length} message(s) after ${this.latestHistoryTs}.`);
    const ordered = [...messages].sort((left, right) => Number(left.ts) - Number(right.ts));
    for (const message of ordered) {
      if (Number(message.ts) <= Number(this.latestHistoryTs)) continue;
      this.latestHistoryTs = message.ts;
      const slackConfig = this.configForInstance();
      if (!slackConfig) continue;
      const event = slackEventToChannelEventIncludingBotMessages(message, slackConfig);
      if (event) await this.handleEvent(event);
    }
  }

  private isDuplicateEnvelope(envelope: SlackEnvelope): boolean {
    const keys = [envelope.envelopeId, envelope.eventId].filter((key): key is string => Boolean(key));
    return keys.some((key) => this.rememberEventKey(`envelope:${key}`));
  }

  private isDuplicateEvent(event: ChannelInboundEvent): boolean {
    return this.rememberEventKey(`${event.kind}:${event.updateId}`);
  }

  private rememberEventKey(key: string): boolean {
    const now = Date.now();
    this.pruneEventKeys(now);
    if (this.seenEventKeys.has(key)) return true;
    this.seenEventKeys.set(key, now + 10 * 60_000);
    return false;
  }

  private pruneEventKeys(now = Date.now()): void {
    for (const [key, expiresAt] of this.seenEventKeys) {
      if (expiresAt <= now) this.seenEventKeys.delete(key);
    }
  }

  private normalizeEnvelope(envelope: SlackEnvelope): ChannelInboundEvent | undefined {
    try {
      const normalized = this.adapterEvent(envelope);
      if (normalized) return normalized;
    } catch {
      // Fall back to stub bot-message handling below.
    }
    const slackConfig = this.configForInstance();
    if (envelope.type !== "event_callback" || !envelope.event || !slackConfig) return undefined;
    return slackEventToChannelEventIncludingBotMessages(envelope.event, slackConfig);
  }

  private adapterEvent(envelope: SlackEnvelope): ChannelInboundEvent | undefined {
    const slackConfig = this.configForInstance();
    const adapter = this.adapter;
    if (!adapter) return undefined;
    if (envelope.type === "event_callback" && envelope.event?.bot_id) return undefined;
    // Let the adapter keep normal user-message/action behavior identical to the
    // core Slack adapter. Bot-message fallback is only for the live driver app.
    return slackConfig ? slackEnvelopeToChannelEvent(envelope, slackConfig) : undefined;
  }

  private async handleEvent(event: ChannelInboundEvent): Promise<void> {
    if (!this.adapter || event.channel !== SLACK_CHANNEL) return;
    try {
      if (event.kind === "action") {
        await this.handleAction(event);
        return;
      }
      await this.handleMessage(event);
    } catch (error) {
      this.lastError = safeSlackRuntimeError(error);
      if (event.kind === "message") {
        await this.adapter.sendText({ channel: SLACK_CHANNEL, conversationId: event.conversation.id, userId: event.sender.userId }, `PiRelay Slack error: ${this.lastError}`).catch(() => undefined);
      }
    }
  }

  private async handleAction(action: ChannelInboundAction): Promise<void> {
    const slackConfig = this.configForInstance();
    if (!this.adapter || !slackConfig) return;
    const trusted = await this.store.getTrustedRelayUser(SLACK_CHANNEL, action.sender.userId, this.instanceId);
    if (!isSlackIdentityAllowed(action.sender, slackConfig) && !trusted) {
      await this.adapter.answerAction(action.actionId, { text: "This Slack identity is not authorized to control PiRelay." });
      return;
    }
    const binding = await this.findSlackBinding(action);
    const route = binding ? this.routes.get(binding.sessionKey) : undefined;
    if (!binding || !route) {
      await this.adapter.answerAction(action.actionId, { text: "This Slack action is stale. Re-run the command from the paired chat." });
      return;
    }
    if (action.actionData.startsWith("summary")) {
      await this.adapter.answerAction(action.actionId, { text: formatSummaryOutput(route) });
      return;
    }
    if (action.actionData.startsWith("full")) {
      await this.adapter.answerAction(action.actionId, { text: formatFullOutput(route) });
      return;
    }
    await this.adapter.answerAction(action.actionId, { text: "Slack action received." });
  }

  private async handleMessage(message: ChannelInboundMessage): Promise<void> {
    const slackConfig = this.configForInstance();
    const localBotUserId = this.localBotUserId();
    if (localBotUserId && message.sender.userId === localBotUserId) return;
    const pairingCode = parseSlackPairingCode(message.text.trim());
    if (pairingCode) {
      await this.handlePairing(message, pairingCode);
      return;
    }
    if (!slackConfig || !isSlackIdentityAllowed(message.sender, slackConfig)) return;
    const routedMessage = await this.applySharedRoomPreRouting(message);
    if (!routedMessage) return;
    const binding = await this.findSlackBinding(routedMessage) ?? await this.livePreseededBinding(routedMessage);
    if (!binding) {
      await this.sendText(message, "This Slack chat is not paired with a Pi session. Run /relay connect slack locally first.");
      return;
    }
    const route = this.routes.get(binding.sessionKey);
    if (!route) {
      if (!this.ownedBindingSessionKeys.has(binding.sessionKey)) return;
      await this.sendText(routedMessage, `The target Pi session (${binding.sessionLabel}) is not online. Re-run /relay connect slack locally.`);
      return;
    }
    await this.handleBoundMessage(routedMessage, binding, route);
  }

  private async applySharedRoomPreRouting(message: ChannelInboundMessage): Promise<ChannelInboundMessage | undefined> {
    const slackConfig = this.configForInstance();
    if (message.conversation.kind === "private") return message;
    if (!slackConfig?.allowChannelMessages) return undefined;
    const localBotUserId = this.localBotUserId();
    const mentions = slackMentionedUserIds(message.text);
    const hasLocalMention = Boolean(localBotUserId && mentions.includes(localBotUserId));
    const remoteMentions = localBotUserId ? mentions.filter((mention) => mention !== localBotUserId) : mentions;
    const command = parseSlackCommand(message.text);
    if (!hasLocalMention && command?.name === "use") {
      const [machineSelector, ...sessionParts] = command.args.trim().split(/\s+/).filter(Boolean);
      if (machineSelector && sessionParts.length > 0) {
        const sessionSelector = sessionParts.join(" ");
        if (isLocalSlackMachineSelector(machineSelector, this.config, slackConfig)) {
          return { ...message, text: `/use ${sessionSelector}` };
        }
        await this.store.setActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId, `remote:${machineSelector}:${sessionSelector}`, { machineId: machineSelector, machineDisplayName: machineSelector });
        return undefined;
      }
    }
    if (!hasLocalMention && command?.name === "to") {
      const [machineSelector, ...sessionAndPromptParts] = command.args.trim().split(/\s+/).filter(Boolean);
      if (machineSelector && sessionAndPromptParts.length > 0) {
        if (isLocalSlackMachineSelector(machineSelector, this.config, slackConfig)) {
          return { ...message, text: `/to ${sessionAndPromptParts.join(" ")}` };
        }
        return undefined;
      }
    }
    if (hasLocalMention && remoteMentions.length > 0) {
      await this.sendText(message, "I could not determine which PiRelay Slack machine bot was addressed: multiple bot mentions.");
      return undefined;
    }
    if (remoteMentions.length > 0 && !hasLocalMention) return undefined;
    if (!hasLocalMention) {
      const active = await this.store.getActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId);
      if (!active || active.machineId && active.machineId !== (this.config.machineId ?? "local")) return undefined;
    }
    return hasLocalMention ? { ...message, text: stripLeadingSlackMentions(message.text) } : message;
  }

  private async handleBoundMessage(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute): Promise<void> {
    const activeBinding = await this.rememberThreadContext(binding, message);
    const command = parseSlackCommand(message.text);
    if (command) {
      await this.handleSlackCommand(message, activeBinding, route, command);
      return;
    }
    if (activeBinding.paused) {
      await this.sendText(message, "Remote delivery is paused for this Slack binding. Use /resume to re-enable prompts.");
      return;
    }
    if (!route.actions.context.isIdle()) {
      const mode = this.config.busyDeliveryMode === "steer" ? "steer" : "followUp";
      route.actions.sendUserMessage(message.text, { deliverAs: mode });
      await this.sendText(message, mode === "steer" ? "Slack steering queued for the active Pi run." : "Slack follow-up queued for after the active Pi run.");
      return;
    }
    route.actions.sendUserMessage(message.text);
    route.lastActivityAt = Date.now();
    await this.store.setActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId, route.sessionKey);
    await this.sendText(message, `Sent to ${route.sessionLabel}.`);
  }

  private async handleSlackCommand(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute, command: SlackCommand): Promise<void> {
    if (binding.paused && !commandAllowsWhilePaused(command.name)) {
      await this.sendText(message, "Remote delivery is paused for this Slack binding. Use /resume first.");
      return;
    }
    switch (command.name) {
      case "help":
        await this.sendText(message, SLACK_HELP_TEXT);
        return;
      case "status":
        await this.sendText(message, formatRelayStatusForRoute(route, { online: true, busy: !route.actions.context.isIdle(), binding }));
        return;
      case "sessions":
        await this.sendText(message, formatSessionList(await this.sessionEntriesForMessage(message), await this.activeSelectionForMessage(message)));
        return;
      case "use": {
        const entries = await this.sessionEntriesForMessage(message);
        const result = resolveSessionSelector(entries, command.args);
        if (result.kind !== "matched") {
          await this.sendText(message, formatSessionSelectorError(result, command.args));
          return;
        }
        await this.store.setActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId, result.entry.sessionKey);
        await this.sendText(message, `Active session set to ${result.entry.alias || result.entry.sessionLabel}.`);
        return;
      }
      case "to": {
        const target = resolveSessionTargetArgs(await this.sessionEntriesForMessage(message), command.args);
        if (target.result.kind !== "matched") {
          await this.sendText(message, formatSessionSelectorError(target.result, target.selector));
          return;
        }
        if (!target.prompt) {
          await this.sendText(message, "Usage: /to <session> <prompt>");
          return;
        }
        const targetRoute = this.routes.get(target.result.entry.sessionKey);
        if (!targetRoute) {
          await this.sendText(message, `Pi session ${target.result.entry.alias || target.result.entry.sessionLabel} is offline.`);
          return;
        }
        targetRoute.actions.sendUserMessage(target.prompt, targetRoute.actions.context.isIdle() ? undefined : { deliverAs: this.config.busyDeliveryMode === "steer" ? "steer" : "followUp" });
        await this.sendText(message, `Sent to ${target.result.entry.alias || target.result.entry.sessionLabel}.`);
        return;
      }
      case "summary":
        await this.sendText(message, formatSummaryOutput(route));
        return;
      case "images":
      case "send-image":
        await this.sendText(message, "Slack image/file upload delivery is not available in this runtime yet. Use /summary or /full for text output, or retrieve generated files locally.");
        return;
      case "full":
        await this.sendText(message, formatFullOutput(route));
        return;
      case "alias": {
        const alias = normalizeAliasArg(command.args);
        await this.updateBinding(binding, { alias });
        await this.sendText(message, alias ? `Slack session alias set to ${alias}.` : "Slack session alias cleared.");
        return;
      }
      case "progress":
      case "notify": {
        const mode = normalizeProgressMode(command.args);
        if (!mode) {
          await this.sendText(message, "Usage: /progress <quiet|normal|verbose|completion-only>");
          return;
        }
        const next = await this.store.upsertChannelBinding({ ...binding, metadata: { ...binding.metadata, progressMode: mode }, instanceId: this.instanceId, lastSeenAt: new Date().toISOString() });
        this.recentBindingBySessionKey.set(next.sessionKey, next);
        await this.sendText(message, `Progress notifications set to ${command.args.trim()}.`);
        return;
      }
      case "recent":
      case "activity":
        await this.sendText(message, formatRelayRecentActivity(route, this.config));
        return;
      case "abort":
        route.actions.abort();
        await this.sendText(message, "Abort requested.");
        return;
      case "compact":
        await route.actions.compact();
        await this.sendText(message, "Compaction requested.");
        return;
      case "pause":
        await this.updateBinding(binding, { paused: true });
        await this.sendText(message, "Slack remote delivery paused. Use /resume to re-enable it.");
        return;
      case "resume":
        await this.updateBinding(binding, { paused: false });
        await this.sendText(message, "Slack remote delivery resumed.");
        return;
      case "disconnect":
        await this.store.revokeChannelBinding(SLACK_CHANNEL, route.sessionKey, undefined, this.instanceId);
        this.ownedBindingSessionKeys.delete(route.sessionKey);
        this.recentBindingBySessionKey.delete(route.sessionKey);
        await this.sendText(message, "Slack binding disconnected for this Pi session.");
        return;
      default:
        await this.sendText(message, `Unknown Slack command: /${command.name}. Send /help for available commands.`);
    }
  }

  private async handlePairing(message: ChannelInboundMessage, code: string): Promise<void> {
    const slackConfig = this.configForInstance();
    if (!slackConfig) return;
    const pending = await this.store.inspectPendingPairing(code, { channel: SLACK_CHANNEL });
    if (pending.status === "consumed") return;
    if (pending.status !== "active") {
      await this.sendText(message, "This Slack pairing code is invalid or expired. Run /relay connect slack again in Pi.");
      return;
    }

    const route = this.routes.get(pending.pairing.sessionKey);
    if (!route) return;
    const result = completeSlackPairing(message, { ...pending.pairing, consumedAt: undefined }, code, slackConfig);
    if (!result.ok) {
      await this.sendText(message, slackPairingFailureMessage(result.reason));
      return;
    }

    const allowedByConfig = (slackConfig.allowUserIds ?? []).includes(message.sender.userId);
    const alreadyTrusted = Boolean(await this.store.getTrustedRelayUser(SLACK_CHANNEL, message.sender.userId, this.instanceId));
    const approval = allowedByConfig || alreadyTrusted ? "allow" : normalizePairingApproval(await route.actions.promptLocalConfirmation({
      channel: SLACK_CHANNEL,
      userId: message.sender.userId,
      username: message.sender.username,
      displayName: message.sender.displayName,
      firstName: message.sender.firstName,
      lastName: message.sender.lastName,
      conversationKind: message.conversation.kind,
      instanceId: this.instanceId,
    }));

    if (approval === "deny") {
      await this.store.markPendingPairingConsumed(code, { channel: SLACK_CHANNEL });
      await this.sendText(message, "Slack pairing was declined locally. Ask the Pi user to retry /relay connect slack.");
      return;
    }

    const consumed = await this.store.markPendingPairingConsumed(code, { channel: SLACK_CHANNEL });
    if (!consumed) return;
    if (approval === "trust") {
      await this.store.trustRelayUser({
        channel: SLACK_CHANNEL,
        instanceId: this.instanceId,
        userId: message.sender.userId,
        username: message.sender.username,
        displayName: message.sender.displayName,
        trustedBySessionLabel: route.sessionLabel,
      });
    }

    const binding = await this.store.upsertChannelBinding({ ...result.binding, instanceId: this.instanceId });
    this.recentBindingBySessionKey.set(binding.sessionKey, binding);
    this.ownedBindingSessionKeys.add(binding.sessionKey);
    await this.store.setActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId, binding.sessionKey);
    route.lastActivityAt = Date.now();
    route.actions.appendAudit(`Slack paired with ${binding.identity?.displayName ?? binding.userId}.`);
    await this.sendText(message, `Slack paired with ${route.sessionLabel}. Send /status or a prompt to control Pi.`);
  }

  private async livePreseededBinding(message: ChannelInboundMessage): Promise<ChannelPersistedBindingRecord | undefined> {
    if (process.env.PI_RELAY_SLACK_LIVE_PRESEEDED_BINDING !== "true" || message.conversation.kind === "private" || this.routes.size !== 1) return undefined;
    const route = [...this.routes.values()][0];
    if (!route) return undefined;
    const now = new Date().toISOString();
    const binding = await this.store.upsertChannelBinding({
      channel: SLACK_CHANNEL,
      instanceId: this.instanceId,
      conversationId: message.conversation.id,
      userId: message.sender.userId,
      sessionKey: route.sessionKey,
      sessionId: route.sessionId,
      sessionFile: route.sessionFile,
      sessionLabel: route.sessionLabel,
      boundAt: now,
      lastSeenAt: now,
      identity: { username: message.sender.username, displayName: message.sender.displayName, metadata: message.sender.metadata },
      metadata: { conversationKind: message.conversation.kind, livePreseeded: true, threadTs: message.metadata?.threadTs },
    });
    this.ownedBindingSessionKeys.add(binding.sessionKey);
    this.recentBindingBySessionKey.set(binding.sessionKey, binding);
    await this.store.setActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId, binding.sessionKey);
    return binding;
  }

  private async findSlackBinding(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<ChannelPersistedBindingRecord | undefined> {
    const active = await this.store.getActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId);
    if (active) {
      const binding = await this.store.getChannelBindingBySessionKey(SLACK_CHANNEL, active.sessionKey, this.instanceId);
      if (binding && binding.conversationId === message.conversation.id && binding.userId === message.sender.userId) return binding;
    }
    const binding = await this.store.getChannelBinding(SLACK_CHANNEL, message.conversation.id, message.sender.userId, this.instanceId);
    if (binding) this.recentBindingBySessionKey.set(binding.sessionKey, binding);
    return binding;
  }

  private async sendText(message: Pick<ChannelInboundMessage, "conversation" | "sender">, text: string): Promise<void> {
    await this.adapter?.sendText(slackAddress(message), text);
  }

  private async sessionEntriesForMessage(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<SessionListEntry[]> {
    const entries: SessionListEntry[] = [];
    for (const route of this.routes.values()) {
      const binding = await this.store.getChannelBindingBySessionKey(SLACK_CHANNEL, route.sessionKey, this.instanceId) ?? this.recentBindingBySessionKey.get(route.sessionKey);
      if (!binding || binding.conversationId !== message.conversation.id || binding.userId !== message.sender.userId) continue;
      entries.push(sessionEntryForRoute(route, { online: true, busy: !route.actions.context.isIdle(), binding, modelId: route.actions.getModel()?.id }));
    }
    return entries;
  }

  private async activeSelectionForMessage(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<string | undefined> {
    return (await this.store.getActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId))?.sessionKey;
  }

  private async rememberThreadContext(binding: ChannelPersistedBindingRecord, message: ChannelInboundMessage): Promise<ChannelPersistedBindingRecord> {
    const threadTs = typeof message.metadata?.threadTs === "string" ? message.metadata.threadTs : undefined;
    if (!threadTs || binding.metadata?.threadTs === threadTs) return binding;
    const next = await this.store.upsertChannelBinding({ ...binding, metadata: { ...binding.metadata, threadTs }, instanceId: this.instanceId, lastSeenAt: new Date().toISOString() });
    this.recentBindingBySessionKey.set(next.sessionKey, next);
    return next;
  }

  private async updateBinding(binding: ChannelPersistedBindingRecord, update: Partial<Pick<ChannelPersistedBindingRecord, "paused">> & { alias?: string | undefined }): Promise<ChannelPersistedBindingRecord> {
    const nextMetadata = update.alias === undefined ? binding.metadata : { ...binding.metadata, alias: update.alias || undefined };
    const next = await this.store.upsertChannelBinding({ ...binding, ...update, metadata: nextMetadata, instanceId: this.instanceId, lastSeenAt: new Date().toISOString() });
    this.recentBindingBySessionKey.set(next.sessionKey, next);
    return next;
  }

  private localBotUserId(): string | undefined {
    return this.botIdentity?.userId ?? this.configForInstance()?.botUserId ?? process.env.PI_RELAY_SLACK_BOT_USER_ID;
  }

  private configForInstance() {
    return this.config.slackInstances?.[this.instanceId] ?? this.config.slack;
  }
}

export function getOrCreateSlackRuntime(config: TelegramTunnelConfig, options?: SlackRuntimeOptions, instanceId = "default"): SlackRuntime | undefined {
  const slackConfig = config.slackInstances?.[instanceId] ?? config.slack;
  if (!slackConfig?.enabled || !slackConfig.botToken) return undefined;
  return new SlackRuntime(config, options, instanceId);
}

function hasHistoryReader(operations: SlackApiOperations | undefined): operations is SlackApiOperations & { listChannelMessages(channel: string, oldest?: string): Promise<SlackMessageEventFromHistory[]> } {
  return Boolean(operations && "listChannelMessages" in operations && typeof operations.listChannelMessages === "function");
}

function slackEventToChannelEventIncludingBotMessages(event: SlackMessageEvent | SlackMessageEventFromHistory, config: Parameters<typeof slackEventToChannelEvent>[1]): ChannelInboundMessage | undefined {
  if (!event.bot_id) return slackEventToChannelEvent(event, config);
  const senderUser = event.user;
  if (!senderUser || event.subtype && event.subtype !== "bot_message") return undefined;
  return {
    kind: "message",
    channel: SLACK_CHANNEL,
    updateId: event.ts,
    messageId: event.ts,
    text: event.text ?? "",
    attachments: [],
    conversation: {
      channel: SLACK_CHANNEL,
      id: event.channel,
      kind: event.channel_type === "im" ? "private" : event.channel_type === "channel" || event.channel_type === "group" ? "channel" : event.channel_type === "mpim" ? "group" : "unknown",
    },
    sender: {
      channel: SLACK_CHANNEL,
      userId: senderUser,
      username: event.username,
      displayName: event.username,
      metadata: { teamId: event.team, botId: event.bot_id },
    },
    metadata: { teamId: event.team, botId: event.bot_id, liveStubBotMessage: true },
  };
}

function parseSlackPairingCode(text: string): string | undefined {
  const match = text.trim().match(/^\/pirelay\s+(\S+)$/i);
  return match?.[1];
}

interface SlackCommand {
  name: string;
  args: string;
}

function parseSlackCommand(text: string): SlackCommand | undefined {
  const cleaned = stripLeadingSlackMentions(text);
  const parsed = parseRemoteCommandInvocation(cleaned, { prefixes: ["relay", "pirelay"] });
  return parsed ? { name: parsed.command, args: parsed.args } : undefined;
}

function stripLeadingSlackMentions(text: string): string {
  return text.replace(/^(?:\s*<@[A-Z0-9_]+>)+\s*/, "");
}

function isLocalSlackMachineSelector(selector: string, config: TelegramTunnelConfig, slackConfig: NonNullable<TelegramTunnelConfig["slack"]>): boolean {
  const normalized = selector.trim().toLowerCase();
  const aliases = [config.machineId ?? "local", config.machineDisplayName, ...(config.machineAliases ?? []), ...(slackConfig.sharedRoom?.machineAliases ?? [])]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return aliases.includes(normalized);
}

function slackPairingFailureMessage(reason: "wrong-channel" | "unsupported-conversation" | "unauthorized" | "command-mismatch" | "expired"): string {
  switch (reason) {
    case "wrong-channel":
      return "This pairing code is not for Slack.";
    case "unsupported-conversation":
      return "Slack pairing is allowed only in DMs unless channel pairing is explicitly enabled.";
    case "unauthorized":
      return "This Slack identity is not authorized to pair with PiRelay.";
    case "command-mismatch":
    case "expired":
      return "This Slack pairing code is invalid or expired. Run /relay connect slack again in Pi.";
  }
}

function normalizePairingApproval(decision: PairingApprovalDecision | boolean | undefined): "allow" | "deny" | "trust" {
  if (decision === true || decision === "allow" || decision === "trust") return decision === true ? "allow" : decision;
  return "deny";
}

function slackAddress(message: Pick<ChannelInboundMessage, "conversation" | "sender"> & { metadata?: Record<string, unknown> }): ChannelRouteAddress {
  const threadTs = typeof message.metadata?.threadTs === "string" ? message.metadata.threadTs : undefined;
  return { channel: SLACK_CHANNEL, conversationId: message.conversation.id, userId: message.sender.userId, ...(threadTs ? { threadTs } : {}) } as ChannelRouteAddress;
}

function bindingAddress(binding: ChannelPersistedBindingRecord): ChannelRouteAddress {
  const threadTs = typeof binding.metadata?.threadTs === "string" ? binding.metadata.threadTs : undefined;
  return { channel: SLACK_CHANNEL, conversationId: binding.conversationId, userId: binding.userId, ...(threadTs ? { threadTs } : {}) } as ChannelRouteAddress;
}

function slackTurnNotificationText(route: SessionRoute, status: "completed" | "failed" | "aborted"): string {
  if (status === "completed") return route.notification.lastSummary || route.notification.lastAssistantText || `Pi session ${route.sessionLabel} completed.`;
  if (status === "failed") return route.notification.lastFailure || `Pi session ${route.sessionLabel} failed.`;
  return `Pi session ${route.sessionLabel} was aborted.`;
}

function safeSlackRuntimeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

function debugSlackRuntime(message: string): void {
  const path = process.env.PI_RELAY_SLACK_DEBUG_LOG;
  if (!path) return;
  appendFileSync(path, `${new Date().toISOString()} ${redactSecrets(message)}\n`);
}
