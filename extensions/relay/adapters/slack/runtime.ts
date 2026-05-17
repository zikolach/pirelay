import { appendFileSync } from "node:fs";
import type { ChannelButtonLayout, ChannelInboundAction, ChannelInboundEvent, ChannelInboundMessage, ChannelOutboundFile, ChannelRouteAddress } from "../../core/channel-adapter.js";
import type { ChannelPersistedBindingRecord, LatestTurnImage, PairingApprovalDecision, ProgressMode, SessionRoute, TelegramTunnelConfig } from "../../core/types.js";
import { redactSecrets } from "../../config/setup.js";
import { completeSlackPairing } from "../channel-pairing.js";
import { TunnelStateStore } from "../../state/tunnel-store.js";
import { buildHelpText, commandAllowsWhilePaused, normalizeAliasArg, parseRemoteCommandInvocation } from "../../commands/remote.js";
import { delegationTaskActionButtons, parseDelegationInvocation, renderDelegationTaskCard } from "../../commands/delegation.js";
import { formatFullOutput, formatLatestImageEmptyMessage, formatRelayRecentActivity, formatRelayStatusForRoute, formatSessionSelectorError, formatSummaryOutput, sessionEntryForRoute } from "../../formatting/presenters.js";
import { formatSessionList, resolveSessionSelector, resolveSessionTargetArgs, type SessionListEntry } from "../../core/session-selection.js";
import { displayProgressMode, formatProgressUpdate, normalizeProgressMode, progressIntervalMsFor, progressModeFor, shouldSendNonTerminalProgress } from "../../notifications/progress.js";
import { sendFinalOutputWithFallback, shouldSendFullFinalOutput } from "../../core/final-output.js";
import { deliverWorkspaceFileToRequester, formatRequesterFileDeliveryResult, parseRemoteSendFileArgs, type RelayFileDeliveryRequester } from "../../core/requester-file-delivery.js";
import { abortRouteSafely, compactRouteSafely, deliverRoutePrompt, latestRouteImagesSafely, probeRouteAvailability, routeActionDisplayMessage, routeIdleState, routeImageByPathSafely, routeWorkspaceRootSafely, unavailableRouteMessage } from "../../core/route-actions.js";
import { statusSnapshotForRoute } from "../../core/relay-core.js";
import { authorityOutcomeAllowsDelivery, bindingAuthorityDiagnostic, channelDestinationKey, resolveChannelBindingAuthority } from "../../core/binding-authority.js";
import { formatRelayLifecycleNotification, type RelayLifecycleEventKind } from "../../notifications/lifecycle.js";
import { SlackChannelAdapter, isSlackIdentityAllowed, slackEnvelopeToChannelEvent, slackEventToChannelEvent, slackMentionedUserIds, type SlackApiOperations, type SlackAuthTestResult, type SlackEnvelope, type SlackMessageEvent } from "./adapter.js";
import { createSlackLiveOperations, type SlackMessageEventFromHistory } from "./live-client.js";
import { delegationCommandFromAction, delegationIngressEventKey, delegationRoomFromMessage, evaluateDelegationIngress, isPeerBotIdentity } from "../../core/agent-delegation-runtime.js";
import { transitionDelegationTask, type DelegationTaskRecord } from "../../core/agent-delegation.js";

const SLACK_CHANNEL = "slack" as const;
const SLACK_HELP_TEXT = buildHelpText({
  title: "PiRelay Slack commands:",
  commandPrefix: "relay",
  includeSharedRoomHints: false,
  footerLines: ["", "Tip: do not prefix commands with `/` in Slack; Slack treats leading slash text as slash commands for apps."],
});
const SLACK_THINKING_REACTION = "thinking_face";
const SLACK_RESPONSE_URL_TTL_MS = 30 * 60 * 1000;

function slackRouteAvailability(route: SessionRoute): { online: boolean; busy: boolean } {
  const probe = probeRouteAvailability(route);
  if (probe.kind === "unavailable") return { online: false, busy: false };
  return { online: true, busy: probe.busy };
}

export interface SlackRuntimeOptions {
  operations?: SlackApiOperations;
}

export interface SlackRuntimeStatus {
  enabled: boolean;
  started: boolean;
  error?: string;
  appId?: string;
  teamId?: string;
  botUserId?: string;
}

export class SlackRuntime {
  private readonly store: TunnelStateStore;
  private readonly adapter?: SlackChannelAdapter;
  private readonly operations?: SlackApiOperations;
  private readonly operationsInjected: boolean;
  private readonly routes = new Map<string, SessionRoute>();
  private readonly ownedBindingSessionKeys = new Set<string>();
  private readonly recentBindingBySessionKey = new Map<string, ChannelPersistedBindingRecord>();
  private readonly activeSessionByConversationUser = new Map<string, string>();
  private historyPollTimer?: ReturnType<typeof setInterval>;
  private historyPollInFlight = false;
  private latestHistoryTs = initialSlackHistoryTimestamp();
  private readonly seenEventKeys = new Map<string, number>();
  private readonly consumedResponseUrls = new Map<string, number>();
  private readonly thinkingReactions = new Map<string, { channel: string; timestamp: string; name: string }>();
  private readonly progressStates = new Map<string, { lastEventId?: string; pending: NonNullable<SessionRoute["notification"]["recentActivity"]>; timer?: ReturnType<typeof setTimeout>; lastSentAt?: number }>();
  private readonly activeDelegationTaskBySessionKey = new Map<string, string>();
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
    this.operationsInjected = Boolean(options.operations);
    const operations = options.operations ?? (slackConfig?.enabled && slackConfig.botToken ? createSlackLiveOperations(slackConfig) : undefined);
    this.operations = operations;
    if (slackConfig?.enabled && slackConfig.botToken && operations) {
      this.adapter = new SlackChannelAdapter(slackConfig, operations);
    }
  }

  getStatus(): SlackRuntimeStatus {
    const slackConfig = this.config.slackInstances?.[this.instanceId] ?? this.config.slack;
    return {
      enabled: Boolean(slackConfig?.enabled && slackConfig.botToken),
      started: this.started,
      error: this.lastError,
      appId: this.botIdentity?.appId ?? slackConfig?.appId,
      teamId: this.botIdentity?.teamId ?? slackConfig?.workspaceId,
      botUserId: this.botIdentity?.userId ?? slackConfig?.botUserId,
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    const startError = this.operationsInjected ? undefined : slackRuntimeStartError(this.configForInstance());
    if (startError) {
      this.lastError = startError;
      throw new Error(this.lastError);
    }
    if (!this.adapter || !this.operations?.startSocketMode) {
      this.lastError = "Slack runtime operations are unavailable.";
      throw new Error(this.lastError);
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.store.markInFlightDelegationTasksStaleAfterRestart()
      .then(() => this.initializeRuntime())
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
    await this.clearThinkingReactions();
    this.clearAllProgressStates();
    this.activeSessionByConversationUser.clear();
    if (this.historyPollTimer) clearInterval(this.historyPollTimer);
    this.historyPollTimer = undefined;
    this.historyPollInFlight = false;
    await this.adapter?.stopPolling?.();
  }

  async registerRoute(route: SessionRoute): Promise<void> {
    this.routes.set(route.sessionKey, route);
    const binding = await this.store.getChannelBindingBySessionKey(SLACK_CHANNEL, route.sessionKey, this.instanceId);
    if (binding) {
      this.ownedBindingSessionKeys.add(route.sessionKey);
      this.recentBindingBySessionKey.set(route.sessionKey, binding);
    }
    this.syncProgressDelivery(route);
  }

  async unregisterRoute(sessionKey: string): Promise<void> {
    await this.stopThinkingReaction(sessionKey);
    this.clearProgressStateBySessionKey(sessionKey);
    this.clearActiveSelectionsForSession(sessionKey);
    this.routes.delete(sessionKey);
    this.ownedBindingSessionKeys.delete(sessionKey);
    this.recentBindingBySessionKey.delete(sessionKey);
    if (this.routes.size === 0) await this.stop();
  }

  private async activeBindingForRoute(route: SessionRoute, options: { includePaused?: boolean; address?: ChannelRouteAddress } = {}): Promise<ChannelPersistedBindingRecord | undefined> {
    const recent = this.recentBindingBySessionKey.get(route.sessionKey);
    const outcome = resolveChannelBindingAuthority(
      await this.store.loadBindingAuthoritySnapshot(),
      {
        channel: SLACK_CHANNEL,
        instanceId: this.instanceId,
        sessionKey: route.sessionKey,
        conversationId: options.address?.conversationId ?? recent?.conversationId,
        userId: options.address?.userId ?? recent?.userId,
        includePaused: options.includePaused,
        allowVolatileFallback: true,
      },
      recent,
    );
    if (authorityOutcomeAllowsDelivery(outcome) && "status" in outcome.binding) {
      route.actions.clearLocalStatus?.("relay-binding-authority");
      return outcome.binding;
    }
    if (outcome.kind === "state-unavailable") route.actions.setLocalStatus?.("relay-binding-authority", bindingAuthorityDiagnostic(outcome) ?? "Relay state is unavailable; protected messenger delivery was suppressed.");
    if (outcome.kind === "revoked" || outcome.kind === "moved" || outcome.kind === "state-unavailable") {
      this.ownedBindingSessionKeys.delete(route.sessionKey);
      this.recentBindingBySessionKey.delete(route.sessionKey);
    }
    return undefined;
  }

  async notifyTurnCompleted(route: SessionRoute, status: "completed" | "failed" | "aborted"): Promise<void> {
    await this.stopThinkingReaction(route.sessionKey);
    this.clearProgressState(route);
    if (await this.finishActiveDelegationTask(route, status)) return;
    if (!this.adapter) return;
    const binding = await this.activeBindingForRoute(route, { includePaused: true });
    if (!binding || binding.paused && status === "completed") return;
    const address = bindingAddress(binding);
    if (status === "completed" && route.notification.lastAssistantText) {
      const mode = progressModeFor({ progressMode: channelProgressMode(binding) }, this.config);
      if (shouldSendFullFinalOutput(mode)) {
        await this.adapter.sendText(address, `✅ Pi session ${route.sessionLabel} completed. Final output:`);
        await sendFinalOutputWithFallback(this.adapter, address, route, route.notification.lastAssistantText);
        return;
      }
    }
    await this.adapter.sendText(address, slackTurnNotificationText(route, status));
  }

  async sendFileToBoundRoute(route: SessionRoute, file: ChannelOutboundFile, options: { kind: "document" | "image"; caption?: string } = { kind: "document" }): Promise<boolean> {
    if (!this.adapter) throw new Error("Slack file delivery is not configured for this instance. Add files:write, reinstall the app, and ensure Slack runtime operations are available.");
    const binding = await this.activeBindingForRoute(route, { includePaused: true });
    if (!binding || binding.paused) return false;
    const address = bindingAddress(binding);
    if (options.kind === "image") await this.adapter.sendImage(address, file, { caption: options.caption });
    else await this.adapter.sendDocument(address, file, { caption: options.caption });
    return true;
  }

  async notifyLifecycle(route: SessionRoute, kind: RelayLifecycleEventKind): Promise<void> {
    if (!this.adapter) return;
    const binding = await this.activeBindingForRoute(route, { includePaused: true });
    if (!binding || binding.paused) return;
    const decision = await this.store.recordLifecycleNotification({
      channel: SLACK_CHANNEL,
      instanceId: this.instanceId,
      sessionKey: route.sessionKey,
      conversationId: binding.conversationId,
      userId: binding.userId,
      kind,
    });
    if (!decision.shouldNotify) return;
    await this.adapter.sendText(bindingAddress(binding), formatRelayLifecycleNotification({ kind, sessionLabel: route.sessionLabel, channel: SLACK_CHANNEL }));
    await this.store.markLifecycleNotificationDelivered({
      channel: SLACK_CHANNEL,
      instanceId: this.instanceId,
      sessionKey: route.sessionKey,
      conversationId: binding.conversationId,
      userId: binding.userId,
      kind,
    });
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
      this.runHistoryPoll(channelId);
    }, 2_000);
    this.historyPollTimer.unref?.();
  }

  private runHistoryPoll(channelId: string): void {
    if (this.historyPollInFlight) return;
    this.historyPollInFlight = true;
    void this.pollHistory(channelId)
      .catch((error: unknown) => {
        this.lastError = safeSlackRuntimeError(error);
      })
      .finally(() => {
        this.historyPollInFlight = false;
      });
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
        if (actionFromDelegationSurface(event)) {
          await this.handleDelegationAction(event);
          return;
        }
        await this.handleAction(event);
        return;
      }
      await this.handleMessage(event);
    } catch (error) {
      this.lastError = safeSlackRuntimeError(error);
      if (event.kind === "message") {
        await this.sendText(event, `PiRelay Slack error: ${this.lastError}`).catch(() => undefined);
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

  private async handleDelegationAction(action: ChannelInboundAction): Promise<void> {
    const slackConfig = this.configForInstance();
    if (!this.adapter || action.conversation.kind === "private") return;
    const command = delegationCommandFromAction(action);
    if (!command) return;
    const taskId = command.kind === "create" ? undefined : command.taskId;
    if (taskId) {
      const existing = await this.store.getDelegationTask(taskId, { runningTimeoutMs: slackConfig?.delegation?.runningTimeoutMs });
      if (!existing) {
        await this.adapter.answerAction(action.actionId, { text: "Delegation action was ignored or stale." });
        return;
      }
    }
    const message: ChannelInboundMessage = {
      kind: "message",
      channel: action.channel,
      updateId: action.updateId,
      messageId: action.messageId ?? action.actionId,
      text: action.actionData,
      attachments: [],
      conversation: action.conversation,
      sender: action.sender,
      metadata: action.metadata,
    };
    const handled = await this.handleDelegationMessage(message, command);
    await this.adapter.answerAction(action.actionId, { text: handled ? "Delegation action handled." : "Delegation action was ignored or stale." });
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
    const delegatedCommand = parseDelegationInvocation(message.text, { prefixes: ["relay", "pirelay"] }) ?? parseDelegationInvocation(stripLeadingSlackMentions(message.text), { prefixes: ["relay", "pirelay"] });
    if (isPeerBotIdentity(message.sender) && !delegatedCommand) return;
    const delegationSourceScoped = delegatedCommand?.kind === "create" ? this.isSlackDelegationSourceScopedToLocal(message) : false;
    const routedMessage = await this.applySharedRoomPreRouting(message);
    if (!routedMessage) {
      if (delegatedCommand) return;
      return;
    }
    if (delegatedCommand && routedMessage.conversation.kind !== "private") {
      if (isPeerBotIdentity(message.sender) || (slackConfig && isSlackIdentityAllowed(message.sender, slackConfig))) {
        await this.findSlackBinding(routedMessage);
        await this.livePreseededBinding(routedMessage, { setActiveSelection: false });
      }
      const scopedMessage = delegationSourceScoped ? { ...routedMessage, metadata: { ...routedMessage.metadata, delegationSourceScoped: true } } : routedMessage;
      if (await this.handleDelegationMessage(scopedMessage, delegatedCommand)) return;
      return;
    }
    if (isPeerBotIdentity(message.sender)) return;
    if (!slackConfig || !isSlackIdentityAllowed(message.sender, slackConfig)) return;
    const binding = await this.findSlackBinding(routedMessage) ?? await this.livePreseededBinding(routedMessage);
    if (!binding) {
      await this.sendText(message, message.conversation.kind === "private"
        ? "This Slack chat is not paired with a Pi session. Run /relay connect slack locally first."
        : "This Slack channel/thread is not paired with a Pi session. To control Pi from this channel, enable slack.allowChannelMessages, run /relay connect slack locally, then send the highlighted `relay pair <pin>` command in this channel. Otherwise use the paired Slack app DM.");
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
      const entries = await this.sessionEntriesForMessage(message);
      const sessionOnlyTarget = resolveSessionTargetArgs(entries, command.args);
      if (sessionOnlyTarget.result.kind === "matched" || sessionOnlyTarget.result.kind === "offline" || sessionOnlyTarget.result.kind === "ambiguous") return message;
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
      const active = await this.activeSelectionRecordForMessage(message);
      if (active?.machineId && active.machineId !== (this.config.machineId ?? "local")) return undefined;
      if (!active) {
        const bindings = await this.store.getChannelBindingsForConversation(SLACK_CHANNEL, message.conversation.id, this.instanceId);
        if (bindings.length === 0) {
          if (process.env.PI_RELAY_SLACK_LIVE_PRESEEDED_BINDING === "true" && command) return message;
          return undefined;
        }
        if (!command) return undefined;
      }
    }
    return hasLocalMention ? { ...message, text: stripLeadingSlackMentions(message.text) } : message;
  }


  private async handleDelegationMessage(message: ChannelInboundMessage, command: NonNullable<ReturnType<typeof parseDelegationInvocation>>): Promise<boolean> {
    const slackConfig = this.configForInstance();
    if (!this.adapter || !slackConfig?.delegation?.enabled || !slackConfig.sharedRoom?.enabled || !slackConfig.allowChannelMessages) return false;
    if (command.kind === "create" && command.target.kind === "machine" && !isLocalSlackMachineSelector(command.target.machineId, this.config, slackConfig)) {
      return false;
    }
    if ("taskId" in command && command.taskId) {
      const existing = await this.store.getDelegationTask(command.taskId, { runningTimeoutMs: slackConfig.delegation?.runningTimeoutMs });
      if (!existing) return false;
    }
    const pairedBindings = await this.store.getChannelBindingsForConversation(SLACK_CHANNEL, message.conversation.id, this.instanceId);
    const canHandleWithoutBinding = process.env.PI_RELAY_SLACK_LIVE_PRESEEDED_BINDING === "true" && command.kind === "create";
    if (pairedBindings.length === 0 && !canHandleWithoutBinding) return false;
    const room = delegationRoomFromMessage(message, this.instanceId);
    const duplicate = await this.store.rememberDelegationEvent(delegationIngressEventKey({ message, room, command }));
    const decision = await evaluateDelegationIngress({
      command,
      message,
      policy: { ...slackConfig.delegation, localCapabilities: [...(this.config.machineCapabilities ?? []), ...(slackConfig.delegation.localCapabilities ?? [])] },
      room,
      localMachineId: this.config.machineId ?? "local",
      localMachineLabel: this.config.machineDisplayName,
      localBotUserId: this.localBotUserId(),
      isAuthorizedHuman: isSlackIdentityAllowed(message.sender, slackConfig),
      eventAlreadyHandled: duplicate,
      requireCapabilityCreateSourceScope: true,
      createSourceScoped: message.metadata?.delegationSourceScoped === true,
      lookup: {
        get: (taskId) => this.store.getDelegationTask(taskId, { runningTimeoutMs: slackConfig.delegation?.runningTimeoutMs }),
        list: (options) => this.store.listDelegationTasks({ ...options, runningTimeoutMs: slackConfig.delegation?.runningTimeoutMs }),
      },
      eligibleRoutes: this.routes.size === 1 ? [...this.routes.values()] : this.routes.size === 0 ? undefined : [],
    });
    switch (decision.kind) {
      case "ignore":
        if (decision.reason === "not-delegation" || decision.reason === "self-authored" || decision.reason === "not-eligible") return false;
        if (decision.message && isSlackIdentityAllowed(message.sender, slackConfig)) await this.sendText(message, decision.message);
        return true;
      case "reject":
        await this.sendText(message, decision.message);
        return true;
      case "render-task":
        await this.store.upsertDelegationTask(decision.task);
        await this.sendDelegationTaskCard(message, decision.task);
        return true;
      case "status":
      case "history":
        await this.sendText(message, decision.text);
        return true;
      case "approve":
      case "cancel":
      case "decline":
        await this.persistDelegationTaskMutation(message, decision.task);
        return true;
      case "claim":
        await this.startClaimedDelegationTask(message, decision.task, decision.prompt, decision.requiresHuman);
        return true;
    }
  }

  private async persistDelegationTaskMutation(message: ChannelInboundMessage, task: DelegationTaskRecord): Promise<DelegationTaskRecord | undefined> {
    const result = await this.store.tryUpsertDelegationTask(task);
    if (!result.applied) {
      await this.sendText(message, `Delegation task ${task.id} changed before this action could be applied.`);
      await this.sendDelegationTaskCard(message, result.task);
      return undefined;
    }
    await this.sendDelegationTaskCard(message, result.task);
    return result.task;
  }

  private async startClaimedDelegationTask(message: ChannelInboundMessage, task: DelegationTaskRecord, prompt: string, requiresHuman: boolean): Promise<void> {
    if (requiresHuman) {
      await this.sendText(message, `Delegation task ${task.id} requires human approval before execution.`);
      return;
    }
    const route = task.claimedBy?.sessionKey ? this.routes.get(task.claimedBy.sessionKey) : this.routes.size === 1 ? [...this.routes.values()][0] : undefined;
    if (route && this.activeDelegationTaskBySessionKey.has(route.sessionKey)) {
      const blocked = transitionDelegationTask(task, { kind: "block", reason: "The target session already has active delegated work." });
      const next = blocked.ok ? blocked.task : task;
      await this.store.upsertDelegationTask(next);
      await this.sendDelegationTaskCard(message, next);
      return;
    }
    if (!route) {
      const blocked = transitionDelegationTask(task, { kind: "block", reason: "No eligible online local session is available." });
      const next = blocked.ok ? blocked.task : task;
      await this.store.upsertDelegationTask(next);
      await this.sendDelegationTaskCard(message, next);
      return;
    }
    const persisted = await this.store.tryUpsertDelegationTask(task);
    if (!persisted.applied) {
      await this.sendText(message, `Delegation task ${task.id} changed before this claim could be applied.`);
      await this.sendDelegationTaskCard(message, persisted.task);
      return;
    }
    const claimedTask = persisted.task;
    const outcome = await deliverRoutePrompt(route, {
      content: prompt,
      deliverAs: this.config.busyDeliveryMode === "steer" ? "steer" : "followUp",
      onCommit: async () => {
        route.lastActivityAt = Date.now();
        this.activeDelegationTaskBySessionKey.set(route.sessionKey, claimedTask.id);
      },
    });
    if (outcome.kind === "unavailable") {
      const blocked = transitionDelegationTask(claimedTask, { kind: "block", reason: routeActionDisplayMessage(outcome) });
      const next = blocked.ok ? blocked.task : claimedTask;
      await this.store.upsertDelegationTask(next);
      await this.sendDelegationTaskCard(message, next);
      return;
    }
    if (outcome.kind === "failed") {
      const blocked = transitionDelegationTask(claimedTask, { kind: "block", reason: routeActionDisplayMessage(outcome) });
      const next = blocked.ok ? blocked.task : claimedTask;
      await this.store.upsertDelegationTask(next);
      await this.sendDelegationTaskCard(message, next);
      return;
    }
    if (outcome.kind !== "success") return;
    const started = transitionDelegationTask(claimedTask, { kind: "start", summary: `Started in ${route.sessionLabel}.` });
    const next = started.ok ? started.task : claimedTask;
    await this.store.upsertDelegationTask(next);
    await this.sendDelegationTaskCard(message, next);
  }

  private async finishActiveDelegationTask(route: SessionRoute, status: "completed" | "failed" | "aborted"): Promise<boolean> {
    if (!this.adapter) return false;
    const taskId = this.activeDelegationTaskBySessionKey.get(route.sessionKey);
    if (!taskId) return false;
    this.activeDelegationTaskBySessionKey.delete(route.sessionKey);
    const task = await this.store.getDelegationTask(taskId);
    if (!task) return false;
    const summary = route.notification.lastAssistantText ?? route.notification.lastFailure ?? status;
    const transition = status === "completed"
      ? transitionDelegationTask(task, { kind: "complete", summary })
      : transitionDelegationTask(task, { kind: "fail", reason: summary });
    const next = transition.ok ? transition.task : task;
    await this.store.upsertDelegationTask(next);
    const card = renderDelegationTaskCard(next, { commandPrefix: "relay task" });
    await this.adapter.sendText({ channel: SLACK_CHANNEL, conversationId: next.room.conversationId, userId: "delegation", ...(next.room.threadId ? { threadTs: next.room.threadId } : {}) } as ChannelRouteAddress, card.text, { buttons: delegationTaskActionButtons(card.actions) });
    return true;
  }

  private async sendDelegationTaskCard(message: ChannelInboundMessage, task: DelegationTaskRecord): Promise<void> {
    const card = renderDelegationTaskCard(task, { commandPrefix: "relay task" });
    await this.sendText(message, card.text, delegationTaskActionButtons(card.actions));
  }

  private async handleBoundMessage(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute): Promise<void> {
    const command = parseSlackCommand(message.text);
    if (command) {
      const activeBinding = await this.rememberThreadContext(binding, message);
      await this.handleSlackCommand(message, activeBinding, route, command);
      return;
    }
    if (binding.paused) {
      await this.sendText(message, "Remote delivery is paused for this Slack binding. Use `relay resume` to re-enable prompts.");
      return;
    }
    const mode = this.config.busyDeliveryMode === "steer" ? "steer" : "followUp";
    const outcome = await deliverRoutePrompt(route, {
      content: message.text,
      deliverAs: mode,
      requester: this.slackRequester(route, message),
      onStart: async ({ idle }) => {
        if (idle) {
          await this.rememberThreadContext(binding, message);
          await this.startThinkingReaction(route, message);
        } else {
          this.sendActivityBestEffort(slackAddress(message));
        }
      },
      onRollback: () => this.stopThinkingReaction(route.sessionKey),
      onCommit: async () => {
        route.lastActivityAt = Date.now();
        await this.setActiveSelection(message, route.sessionKey);
      },
    });
    if (outcome.kind === "unavailable") {
      await this.sendText(message, routeActionDisplayMessage(outcome));
      return;
    }
    if (outcome.kind === "failed") throw outcome.error;
    if (outcome.kind !== "success") return;
    if (!outcome.result.idle) {
      await this.sendText(message, outcome.result.deliverAs === "steer"
        ? "Slack steering queued for the active Pi run."
        : "Slack follow-up queued for after the active Pi run. The current turn may complete separately before this prompt runs.");
      return;
    }
    await this.sendText(message, `Sent to ${route.sessionLabel}.`);
  }

  private async handleSlackCommand(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute, command: SlackCommand): Promise<void> {
    if (binding.paused && !commandAllowsWhilePaused(command.name)) {
      await this.sendText(message, "Remote delivery is paused for this Slack binding. Use `relay resume` first.");
      return;
    }
    switch (command.name) {
      case "help":
        await this.sendText(message, SLACK_HELP_TEXT);
        return;
      case "status": {
        const availability = slackRouteAvailability(route);
        await this.sendText(message, formatRelayStatusForRoute(route, { online: availability.online, busy: availability.busy, binding }));
        return;
      }
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
        await this.setActiveSelection(message, result.entry.sessionKey);
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
          await this.sendText(message, "Usage: relay to <session> <prompt>");
          return;
        }
        const targetRoute = this.routes.get(target.result.entry.sessionKey);
        if (!targetRoute) {
          await this.sendText(message, `Pi session ${target.result.entry.alias || target.result.entry.sessionLabel} is offline.`);
          return;
        }
        const outcome = await deliverRoutePrompt(targetRoute, {
          content: target.prompt,
          deliverAs: this.config.busyDeliveryMode === "steer" ? "steer" : "followUp",
          requester: this.slackRequester(targetRoute, message),
          passUndefinedOptions: true,
          onStart: async ({ idle }) => {
            if (idle) await this.startThinkingReaction(targetRoute, message);
            else this.sendActivityBestEffort(slackAddress(message));
          },
          onRollback: () => this.stopThinkingReaction(targetRoute.sessionKey),
        });
        if (outcome.kind === "unavailable") {
          await this.sendText(message, routeActionDisplayMessage(outcome));
          return;
        }
        if (outcome.kind === "failed") throw outcome.error;
        if (outcome.kind !== "success") return;
        await this.sendText(message, `Sent to ${target.result.entry.alias || target.result.entry.sessionLabel}.`);
        return;
      }
      case "summary":
        await this.sendText(message, formatSummaryOutput(route));
        return;
      case "images":
        await this.sendLatestImages(message, route);
        return;
      case "send-file":
      case "sendfile":
        await this.sendFileByPath(message, route, command.args);
        return;
      case "send-image":
      case "sendimage":
        await this.sendImageByPath(message, route, command.args);
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
          const currentMode = displayProgressMode(progressModeFor({ progressMode: channelProgressMode(binding) }, this.config));
          await this.sendText(message, `Progress mode: ${currentMode}\nUsage: relay progress <quiet|normal|verbose|completion-only>`);
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
      case "abort": {
        const outcome = abortRouteSafely(route);
        if (outcome.kind === "unavailable" || outcome.kind === "already-idle") {
          await this.sendText(message, routeActionDisplayMessage(outcome));
          return;
        }
        if (outcome.kind === "failed") throw outcome.error;
        await this.sendText(message, "Abort requested.");
        return;
      }
      case "compact": {
        const outcome = await compactRouteSafely(route);
        if (outcome.kind === "unavailable") {
          await this.sendText(message, routeActionDisplayMessage(outcome));
          return;
        }
        if (outcome.kind === "failed") throw outcome.error;
        await this.sendText(message, "Compaction requested.");
        return;
      }
      case "pause":
        await this.updateBinding(binding, { paused: true });
        route.actions.refreshLocalStatus?.();
        await this.sendText(message, "Slack remote delivery paused. Use `relay resume` to re-enable it.");
        return;
      case "resume":
        await this.updateBinding(binding, { paused: false });
        route.actions.refreshLocalStatus?.();
        await this.sendText(message, "Slack remote delivery resumed.");
        return;
      case "disconnect":
        await this.store.revokeChannelBinding(SLACK_CHANNEL, route.sessionKey, undefined, this.instanceId);
        await this.clearActiveSelection(message, route.sessionKey);
        this.ownedBindingSessionKeys.delete(route.sessionKey);
        this.recentBindingBySessionKey.delete(route.sessionKey);
        route.actions.refreshLocalStatus?.();
        await this.sendText(message, "Slack binding disconnected for this Pi session.");
        return;
      default:
        await this.sendText(message, `Unknown Slack command: ${command.name}. Send \`relay help\` for available commands.`);
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
    await this.setActiveSelection(message, binding.sessionKey);
    route.lastActivityAt = Date.now();
    const pairedUser = binding.identity?.displayName ?? binding.userId;
    route.actions.appendAudit(`Slack paired with ${pairedUser}.`);
    route.actions.notifyLocal?.(`Slack paired with ${pairedUser} for ${route.sessionLabel}.`, "info");
    await this.sendText(message, `Slack paired with ${route.sessionLabel}. Send \`relay status\` or a prompt to control Pi.`);
  }

  private slackRequester(route: SessionRoute, message: ChannelInboundMessage): RelayFileDeliveryRequester {
    const threadId = typeof message.metadata?.threadTs === "string" ? message.metadata.threadTs : undefined;
    return {
      channel: SLACK_CHANNEL,
      instanceId: this.instanceId,
      conversationId: message.conversation.id,
      userId: message.sender.userId,
      sessionKey: route.sessionKey,
      safeLabel: `Slack ${message.sender.displayName ?? message.sender.username ?? message.sender.userId}`,
      threadId,
      messageId: message.messageId,
      conversationKind: message.conversation.kind,
      createdAt: Date.now(),
    };
  }

  private async sendFileByPath(message: ChannelInboundMessage, route: SessionRoute, args: string, source: "remote-command" | "assistant-tool" = "remote-command"): Promise<string | undefined> {
    const request = parseRemoteSendFileArgs(args);
    if (!request) {
      const usage = "Usage: relay send-file <relative-path> [caption]";
      if (source === "remote-command") await this.sendText(message, usage);
      return usage;
    }
    if (!this.adapter) {
      const error = "Slack file delivery is not configured for this instance. Add files:write, reinstall the app, and ensure Slack runtime operations are available.";
      if (source === "remote-command") await this.sendText(message, error);
      return error;
    }
    const workspace = routeWorkspaceRootSafely(route);
    if (workspace.kind !== "success") {
      const text = routeActionDisplayMessage(workspace);
      if (source === "remote-command") await this.sendText(message, text);
      return text;
    }
    const workspaceRoot = workspace.result;
    const requester = this.slackRequester(route, message);
    route.remoteRequester = requester;
    const result = await deliverWorkspaceFileToRequester({
      route,
      requester,
      adapter: this.adapter,
      workspaceRoot: workspaceRoot,
      relativePath: request.relativePath,
      caption: request.caption,
      source,
      maxDocumentBytes: this.adapter.capabilities.maxDocumentBytes,
      maxImageBytes: this.adapter.capabilities.maxImageBytes,
      allowedImageMimeTypes: this.adapter.capabilities.supportedImageMimeTypes,
      authoritySnapshot: await this.store.loadBindingAuthoritySnapshot(),
    });
    route.actions.appendAudit(`Slack send-file ${result.ok ? "delivered" : "failed"}: ${result.ok ? result.relativePath : result.error}`);
    const text = formatRequesterFileDeliveryResult(result);
    if (!result.ok && source === "remote-command") await this.sendText(message, text);
    return text;
  }

  async sendFileToRequester(route: SessionRoute, requester: RelayFileDeliveryRequester, relativePath: string, caption?: string): Promise<string> {
    if (!this.adapter) return "Slack file delivery is not configured for this instance. Add files:write, reinstall the app, and ensure Slack runtime operations are available.";
    const workspace = routeWorkspaceRootSafely(route);
    if (workspace.kind !== "success") return routeActionDisplayMessage(workspace);
    const workspaceRoot = workspace.result;
    const result = await deliverWorkspaceFileToRequester({
      route,
      requester,
      adapter: this.adapter,
      workspaceRoot: workspaceRoot,
      relativePath,
      caption,
      source: "assistant-tool",
      maxDocumentBytes: this.adapter.capabilities.maxDocumentBytes,
      maxImageBytes: this.adapter.capabilities.maxImageBytes,
      allowedImageMimeTypes: this.adapter.capabilities.supportedImageMimeTypes,
      authoritySnapshot: await this.store.loadBindingAuthoritySnapshot(),
    });
    route.actions.appendAudit(`Slack assistant send-file ${result.ok ? "delivered" : "failed"}: ${result.ok ? result.relativePath : result.error}`);
    return formatRequesterFileDeliveryResult(result);
  }

  private async sendLatestImages(message: ChannelInboundMessage, route: SessionRoute): Promise<void> {
    const imagesOutcome = await latestRouteImagesSafely(route);
    if (imagesOutcome.kind !== "success") {
      await this.sendText(message, routeActionDisplayMessage(imagesOutcome));
      return;
    }
    const images = imagesOutcome.result;
    if (images.length === 0) {
      await this.sendText(message, formatLatestImageEmptyMessage().replaceAll("/images", "relay images").replaceAll("/send-image", "relay send-image"));
      return;
    }
    let sent = 0;
    let skipped = 0;
    for (const image of images) {
      try {
        await this.sendSlackImage(message, image, images.length === 1 ? "Latest Pi image output" : `Latest Pi image output ${sent + 1}/${images.length}`);
        sent += 1;
      } catch (error) {
        skipped += 1;
        if (sent === 0) {
          await this.sendText(message, slackUploadFailureMessage(error));
          return;
        }
      }
    }
    if (skipped > 0) await this.sendText(message, `Skipped ${skipped} image output(s) because Slack upload failed or the file was unsupported.`);
  }

  private async sendImageByPath(message: ChannelInboundMessage, route: SessionRoute, args: string): Promise<void> {
    const relativePath = args.trim();
    if (!relativePath) {
      await this.sendText(message, "Usage: relay send-image <relative-image-path>");
      return;
    }
    const imageOutcome = await routeImageByPathSafely(route, relativePath);
    if (imageOutcome.kind !== "success") {
      await this.sendText(message, routeActionDisplayMessage(imageOutcome));
      return;
    }
    const result = imageOutcome.result;
    if (!result.ok) {
      await this.sendText(message, result.error);
      return;
    }
    try {
      await this.sendSlackImage(message, result.image, "Pi image file");
    } catch (error) {
      await this.sendText(message, slackUploadFailureMessage(error));
    }
  }

  private async sendSlackImage(message: ChannelInboundMessage, image: LatestTurnImage, caption: string): Promise<void> {
    if (!this.adapter) throw new Error("Slack file delivery is not configured for this instance. Add files:write, reinstall the app, and ensure Slack runtime operations are available.");
    await this.adapter.sendImage(
      slackAddress(message),
      { fileName: image.fileName, mimeType: image.mimeType, data: image.data, byteSize: image.byteSize },
      { caption },
    );
  }

  private async livePreseededBinding(message: ChannelInboundMessage, options: { setActiveSelection?: boolean } = {}): Promise<ChannelPersistedBindingRecord | undefined> {
    if (process.env.PI_RELAY_SLACK_LIVE_PRESEEDED_BINDING !== "true" || message.conversation.kind === "private") return undefined;
    const firstRoute = [...this.routes.values()][0];
    const now = new Date().toISOString();
    const routeSeed = `${message.conversation.id}:${message.sender.userId}`;
    const binding = await this.store.upsertChannelBinding({
      channel: SLACK_CHANNEL,
      instanceId: this.instanceId,
      conversationId: message.conversation.id,
      userId: message.sender.userId,
      sessionKey: firstRoute?.sessionKey ?? `live-preseed:${routeSeed}`,
      sessionId: firstRoute?.sessionId ?? `live-preseed:${routeSeed}`,
      sessionFile: firstRoute?.sessionFile,
      sessionLabel: firstRoute?.sessionLabel ?? "shared-room",
      boundAt: now,
      lastSeenAt: now,
      identity: { username: message.sender.username, displayName: message.sender.displayName, metadata: message.sender.metadata },
      metadata: { conversationKind: message.conversation.kind, livePreseeded: true, threadTs: message.metadata?.threadTs },
    });
    this.ownedBindingSessionKeys.add(binding.sessionKey);
    this.recentBindingBySessionKey.set(binding.sessionKey, binding);
    if (options.setActiveSelection !== false) await this.setActiveSelection(message, binding.sessionKey);
    return binding;
  }

  private activeSelectionKey(message: Pick<ChannelInboundMessage, "conversation" | "sender">): string {
    return `${message.conversation.id}:${message.sender.userId}`;
  }

  private async setActiveSelection(message: Pick<ChannelInboundMessage, "conversation" | "sender">, sessionKey: string): Promise<void> {
    this.activeSessionByConversationUser.set(this.activeSelectionKey(message), sessionKey);
    await this.store.setActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId, sessionKey);
  }

  private async clearActiveSelection(message: Pick<ChannelInboundMessage, "conversation" | "sender">, sessionKey?: string): Promise<void> {
    this.activeSessionByConversationUser.delete(this.activeSelectionKey(message));
    await this.store.clearActiveChannelSelection(SLACK_CHANNEL, message.conversation.id, message.sender.userId, sessionKey);
  }

  private clearActiveSelectionsForSession(sessionKey: string): void {
    for (const [key, activeSessionKey] of this.activeSessionByConversationUser) {
      if (activeSessionKey === sessionKey) this.activeSessionByConversationUser.delete(key);
    }
  }

  private isSlackDelegationSourceScopedToLocal(message: ChannelInboundMessage): boolean {
    const localBotUserId = this.localBotUserId();
    return Boolean(localBotUserId && slackMentionedUserIds(message.text).includes(localBotUserId));
  }

  private async activeSelectionRecordForMessage(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<{ sessionKey: string; machineId?: string } | undefined> {
    const snapshot = await this.store.loadBindingAuthoritySnapshot();
    const key = this.activeSelectionKey(message);
    if (snapshot.kind === "state-unavailable") {
      this.activeSessionByConversationUser.delete(key);
      return undefined;
    }
    const persisted = snapshot.data.activeChannelSelections[`${SLACK_CHANNEL}:${message.conversation.id}:${message.sender.userId}`];
    if (persisted) return persisted;
    const inMemorySessionKey = this.activeSessionByConversationUser.get(key);
    if (!inMemorySessionKey) return undefined;
    const recent = this.recentBindingBySessionKey.get(inMemorySessionKey);
    const outcome = resolveChannelBindingAuthority(
      snapshot,
      { channel: SLACK_CHANNEL, instanceId: this.instanceId, sessionKey: inMemorySessionKey, conversationId: message.conversation.id, userId: message.sender.userId, allowVolatileFallback: true },
      recent,
    );
    if (authorityOutcomeAllowsDelivery(outcome)) return { sessionKey: inMemorySessionKey };
    this.activeSessionByConversationUser.delete(key);
    return undefined;
  }

  private async findSlackBinding(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<ChannelPersistedBindingRecord | undefined> {
    const snapshot = await this.store.loadBindingAuthoritySnapshot();
    if (snapshot.kind === "state-unavailable") return undefined;
    const active = await this.activeSelectionRecordForMessage(message);
    if (active) {
      const outcome = resolveChannelBindingAuthority(
        snapshot,
        { channel: SLACK_CHANNEL, instanceId: this.instanceId, sessionKey: active.sessionKey, conversationId: message.conversation.id, userId: message.sender.userId },
      );
      if (authorityOutcomeAllowsDelivery(outcome) && "status" in outcome.binding) return outcome.binding;
    }
    const bindings = Object.values(snapshot.data.channelBindings)
      .filter((binding) => binding.channel === SLACK_CHANNEL && (binding.instanceId ?? "default") === this.instanceId && binding.conversationId === message.conversation.id && binding.userId === message.sender.userId && binding.status !== "revoked");
    const latest = message.conversation.kind !== "private" && this.configForInstance()?.allowChannelMessages
      ? latestChannelBinding(bindings)
      : latestChannelBinding(bindings.filter((binding) => binding.userId === message.sender.userId));
    if (latest) {
      this.recentBindingBySessionKey.set(latest.sessionKey, latest);
      return latest;
    }
    return undefined;
  }

  private async sendText(message: Pick<ChannelInboundMessage, "conversation" | "sender"> & { metadata?: Record<string, unknown> }, text: string, buttons?: ChannelButtonLayout): Promise<void> {
    const responseUrl = typeof message.metadata?.responseUrl === "string" ? message.metadata.responseUrl : undefined;
    if (responseUrl && this.operations?.postResponse && !this.wasResponseUrlConsumed(responseUrl)) {
      this.rememberConsumedResponseUrl(responseUrl);
      try {
        await this.operations.postResponse(responseUrl, { text, ephemeral: true });
        return;
      } catch (error) {
        debugSlackRuntime(`Slack response_url delivery failed: ${safeSlackRuntimeError(error)}`);
      }
    }
    await this.adapter?.sendText(slackAddress(message), text, { buttons });
  }

  private wasResponseUrlConsumed(responseUrl: string): boolean {
    const expiresAt = this.consumedResponseUrls.get(responseUrl);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.consumedResponseUrls.delete(responseUrl);
      return false;
    }
    return true;
  }

  private rememberConsumedResponseUrl(responseUrl: string): void {
    this.consumedResponseUrls.set(responseUrl, Date.now() + SLACK_RESPONSE_URL_TTL_MS);
    for (const [url, expiresAt] of this.consumedResponseUrls) {
      if (expiresAt <= Date.now()) this.consumedResponseUrls.delete(url);
    }
  }

  private async sessionEntriesForMessage(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<SessionListEntry[]> {
    const entries: SessionListEntry[] = [];
    for (const route of this.routes.values()) {
      const binding = await this.activeBindingForRoute(route, { includePaused: true });
      if (!binding || binding.conversationId !== message.conversation.id || binding.userId !== message.sender.userId) continue;
      const availability = slackRouteAvailability(route);
      const snapshot = statusSnapshotForRoute(route, availability);
      entries.push(sessionEntryForRoute(route, { online: snapshot.online, busy: snapshot.busy, binding, modelId: snapshot.modelId }));
    }
    return entries;
  }

  private async activeSelectionForMessage(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<string | undefined> {
    return (await this.activeSelectionRecordForMessage(message))?.sessionKey;
  }

  private async rememberThreadContext(binding: ChannelPersistedBindingRecord, message: ChannelInboundMessage): Promise<ChannelPersistedBindingRecord> {
    const threadTs = typeof message.metadata?.threadTs === "string" ? message.metadata.threadTs : undefined;
    if (!threadTs || binding.metadata?.threadTs === threadTs) return binding;
    const next = await this.store.upsertChannelBinding({ ...binding, metadata: { ...binding.metadata, threadTs }, instanceId: this.instanceId, lastSeenAt: new Date().toISOString() });
    this.recentBindingBySessionKey.set(next.sessionKey, next);
    return next;
  }

  private progressKey(route: SessionRoute): string | undefined {
    const binding = this.recentBindingBySessionKey.get(route.sessionKey);
    return binding ? channelDestinationKey({ channel: SLACK_CHANNEL, instanceId: this.instanceId, sessionKey: route.sessionKey, conversationId: binding.conversationId, userId: binding.userId }) : undefined;
  }

  private clearAllProgressStates(): void {
    for (const state of this.progressStates.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.progressStates.clear();
  }

  private clearProgressState(route: SessionRoute): void {
    const key = this.progressKey(route);
    if (!key) return;
    const state = this.progressStates.get(key);
    if (state?.timer) clearTimeout(state.timer);
    this.progressStates.delete(key);
  }

  private clearProgressStateByKey(key: string): void {
    const state = this.progressStates.get(key);
    if (state?.timer) clearTimeout(state.timer);
    this.progressStates.delete(key);
  }

  private clearProgressStateBySessionKey(sessionKey: string): void {
    const prefix = `${SLACK_CHANNEL}:${this.instanceId}:${sessionKey}:`;
    for (const [key] of this.progressStates) {
      if (!key.startsWith(prefix)) continue;
      this.clearProgressStateByKey(key);
    }
  }

  private syncProgressDelivery(route: SessionRoute): void {
    const event = route.notification.progressEvent;
    const binding = this.recentBindingBySessionKey.get(route.sessionKey);
    const key = this.progressKey(route);
    if (!key || !event || !binding || binding.paused || route.notification.lastStatus !== "running") {
      if (route.notification.lastStatus && isTerminalStatus(route.notification.lastStatus)) this.clearProgressState(route);
      return;
    }
    const mode = progressModeFor({ progressMode: channelProgressMode(binding) }, this.config);
    if (!shouldSendNonTerminalProgress(mode)) {
      this.clearProgressState(route);
      return;
    }
    let state = this.progressStates.get(key);
    if (!state) {
      state = { pending: [] };
      this.progressStates.set(key, state);
    }
    if (state.lastEventId === event.id) return;
    state.lastEventId = event.id;
    state.pending.push(event);
    if (state.timer) return;
    const interval = progressIntervalMsFor(mode, this.config);
    const elapsed = state.lastSentAt ? Date.now() - state.lastSentAt : interval;
    const delay = Math.max(0, interval - elapsed);
    state.timer = setTimeout(() => {
      void this.flushProgress(route.sessionKey, binding, key).catch((error: unknown) => {
        debugSlackRuntime(`Slack progress delivery failed: ${safeSlackRuntimeError(error)}`);
      });
    }, delay);
    unrefTimer(state.timer);
  }

  private async flushProgress(sessionKey: string, expectedBinding: ChannelPersistedBindingRecord, key: string): Promise<void> {
    const state = this.progressStates.get(key);
    if (!state) return;
    state.timer = undefined;
    const route = this.routes.get(sessionKey);
    const binding = route ? await this.activeBindingForRoute(route, { includePaused: true, address: bindingAddress(expectedBinding) }) : undefined;
    if (!route || !binding || binding.conversationId !== expectedBinding.conversationId || binding.userId !== expectedBinding.userId || binding.paused || route.notification.lastStatus !== "running") {
      this.clearProgressStateByKey(key);
      return;
    }
    const mode = progressModeFor({ progressMode: channelProgressMode(binding) }, this.config);
    if (!shouldSendNonTerminalProgress(mode)) {
      this.clearProgressState(route);
      return;
    }
    const pending = state.pending.splice(0);
    const text = formatProgressUpdate(pending, this.config);
    if (!text || !this.adapter) return;
    state.lastSentAt = Date.now();
    await this.adapter.sendText(bindingAddress(binding), text);
  }

  private async startThinkingReaction(route: SessionRoute, message: ChannelInboundMessage): Promise<void> {
    const timestamp = message.messageId;
    if (!timestamp || !this.operations?.addReaction) {
      this.sendActivityBestEffort(slackAddress(message));
      return;
    }
    await this.stopThinkingReaction(route.sessionKey);
    const reaction = { channel: message.conversation.id, timestamp, name: SLACK_THINKING_REACTION };
    try {
      await this.operations.addReaction(reaction);
      this.thinkingReactions.set(route.sessionKey, reaction);
    } catch (error) {
      debugSlackRuntime(`Slack thinking reaction failed: ${safeSlackRuntimeError(error)}`);
      this.sendActivityBestEffort(slackAddress(message));
    }
  }

  private async stopThinkingReaction(sessionKey: string): Promise<void> {
    const reaction = this.thinkingReactions.get(sessionKey);
    if (!reaction) return;
    this.thinkingReactions.delete(sessionKey);
    if (!this.operations?.removeReaction) return;
    try {
      await this.operations.removeReaction(reaction);
    } catch (error) {
      debugSlackRuntime(`Slack thinking reaction cleanup failed: ${safeSlackRuntimeError(error)}`);
    }
  }

  private async clearThinkingReactions(): Promise<void> {
    await Promise.all([...this.thinkingReactions.keys()].map((sessionKey) => this.stopThinkingReaction(sessionKey)));
  }

  private sendActivityBestEffort(address: ChannelRouteAddress): void {
    void this.adapter?.sendActivity(address, "typing").catch((error: unknown) => {
      debugSlackRuntime(`Slack activity indicator failed: ${safeSlackRuntimeError(error)}`);
    });
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
  const messageTs = event.ts;
  const conversation = {
    channel: SLACK_CHANNEL,
    id: event.channel,
    kind: event.channel_type === "im" ? "private" : event.channel_type === "channel" || event.channel_type === "group" ? "channel" : event.channel_type === "mpim" ? "group" : "unknown",
  } as const;
  return {
    kind: "message",
    channel: SLACK_CHANNEL,
    updateId: messageTs,
    messageId: messageTs,
    text: event.text ?? "",
    attachments: [],
    conversation,
    sender: {
      channel: SLACK_CHANNEL,
      userId: senderUser,
      username: event.username,
      displayName: event.username,
      metadata: { teamId: event.team, botId: event.bot_id },
    },
    metadata: { teamId: event.team, botId: event.bot_id, liveStubBotMessage: true, threadTs: pickSlackThreadTs(messageTs, (event as { thread_ts?: string }).thread_ts, conversation.kind === "private") },
  };
}

function pickSlackThreadTs(messageTs: string | undefined, threadTs: string | undefined, isPrivateConversation = false): string | undefined {
  if (typeof threadTs === "string" && threadTs && threadTs !== messageTs) return threadTs;
  if (isPrivateConversation && messageTs) return messageTs;
  return undefined;
}

function parseSlackPairingCode(text: string): string | undefined {
  const trimmed = text.trim();
  const explicit = trimmed.match(/^relay\s+pair\s+(\S+)$/i);
  if (explicit) return explicit[1];
  const legacy = trimmed.match(/^(?:\/relay|relay)\s+(\S+)$/i);
  const candidate = legacy?.[1];
  return candidate && isSlackPairingCodeCandidate(candidate) ? candidate : undefined;
}

function isSlackPairingCodeCandidate(value: string): boolean {
  return /^\d{3}-\d{3}$/.test(value) || /^[A-Za-z0-9_-]{20,}$/.test(value);
}

interface SlackCommand {
  name: string;
  args: string;
}

function parseSlackCommand(text: string): SlackCommand | undefined {
  const cleaned = stripLeadingSlackMentions(text);
  const parsed = parseRemoteCommandInvocation(cleaned, { prefixes: ["relay"] });
  return parsed ? { name: parsed.command, args: parsed.args } : undefined;
}

function stripLeadingSlackMentions(text: string): string {
  return text.replace(/^(?:\s*<@[A-Z0-9_]+>)+\s*/, "");
}

function actionFromDelegationSurface(action: ChannelInboundAction): boolean {
  return !!delegationCommandFromAction(action);
}

function isLocalSlackMachineSelector(selector: string, config: TelegramTunnelConfig, slackConfig: NonNullable<TelegramTunnelConfig["slack"]>): boolean {
  const normalized = normalizeSlackMachineSelector(selector);
  const aliases = [
    config.machineId ?? "local",
    config.machineDisplayName,
    ...(config.machineAliases ?? []),
    ...(slackConfig.sharedRoom?.machineAliases ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeSlackMachineSelector(value))
    .filter(Boolean);
  return aliases.includes(normalized);
}

function normalizeSlackMachineSelector(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
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

function latestChannelBinding(bindings: readonly ChannelPersistedBindingRecord[]): ChannelPersistedBindingRecord | undefined {
  return [...bindings].sort((a, b) => Date.parse(b.lastSeenAt || b.boundAt) - Date.parse(a.lastSeenAt || a.boundAt))[0];
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

function channelProgressMode(binding: ChannelPersistedBindingRecord): ProgressMode | undefined {
  const mode = binding.metadata?.progressMode;
  if (mode === "quiet" || mode === "normal" || mode === "verbose" || mode === "completionOnly") return mode;
  return undefined;
}

function isTerminalStatus(status: SessionRoute["notification"]["lastStatus"]): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") timer.unref();
}

function slackRuntimeStartError(config: TelegramTunnelConfig["slack"] | undefined): string | undefined {
  if (!config?.enabled) return "Slack runtime is not enabled.";
  if (!config.botToken) return "Slack runtime is missing a bot token.";
  if ((config.eventMode ?? "socket") === "socket" && !config.appToken && !process.env.PI_RELAY_SLACK_APP_TOKEN) {
    return "Slack Socket Mode requires an app-level token.";
  }
  if (config.eventMode === "webhook") return "Slack webhook runtime ingress is not available in this process.";
  return undefined;
}

function slackUploadFailureMessage(error: unknown): string {
  const message = safeSlackRuntimeError(error);
  if (/missing_scope|not_allowed_token_type|file_uploads_disabled|not_in_channel|channel_not_found|permission|scope/i.test(message)) {
    return `Slack file upload failed. Add the \`files:write\` bot scope, reinstall the Slack app, invite it to the channel if needed, then retry. (${message})`;
  }
  return `Slack file upload failed: ${message}`;
}

function safeSlackRuntimeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

function initialSlackHistoryTimestamp(): string {
  const configuredOldest = process.env.PI_RELAY_SLACK_HISTORY_OLDEST_TS?.trim();
  if (configuredOldest && Number.isFinite(Number(configuredOldest))) return configuredOldest;
  return (Date.now() / 1_000).toFixed(6);
}

function debugSlackRuntime(message: string): void {
  const path = process.env.PI_RELAY_SLACK_DEBUG_LOG;
  if (!path) return;
  appendFileSync(path, `${new Date().toISOString()} ${redactSecrets(message)}\n`);
}
