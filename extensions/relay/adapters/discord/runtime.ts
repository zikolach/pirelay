import type { ChannelBinding, ChannelInboundAction, ChannelInboundEvent, ChannelInboundMessage, ChannelOutboundFile, ChannelRouteAddress } from "../../core/channel-adapter.js";
import { completeDiscordPairing } from "../channel-pairing.js";
import { DiscordChannelAdapter, discordMentionsSharedRoomAddressing, discordPairingCommand, discordRelayPairingCommand, isDiscordIdentityAllowed, type DiscordApiOperations } from "./adapter.js";
import { createDiscordLiveOperations } from "./live-client.js";
import { TunnelStateStore } from "../../state/tunnel-store.js";
import type { ChannelPersistedBindingRecord, LatestTurnImage, PairingApprovalDecision, ProgressMode, SessionRoute, TelegramTunnelConfig } from "../../core/types.js";
import { commandAllowsWhilePaused, normalizeAliasArg, parseRemoteCommandInvocation, buildHelpText } from "../../commands/remote.js";
import { formatFullOutput, formatLatestImageEmptyMessage, formatRelayRecentActivity, formatRelayStatusForRoute, formatSessionSelectorError, formatSummaryOutput } from "../../formatting/presenters.js";
import { formatSessionList, resolveSessionSelector, resolveSessionTargetArgs, type SessionListEntry } from "../../core/session-selection.js";
import { displayProgressMode, normalizeProgressMode, progressModeFor } from "../../notifications/progress.js";
import { sendFinalOutputWithFallback, shouldSendFullFinalOutput } from "../../core/final-output.js";
import { formatRelayLifecycleNotification, type RelayLifecycleEventKind } from "../../notifications/lifecycle.js";
import { statusSnapshotForRoute } from "../../core/relay-core.js";
import { redactSecrets } from "../../config/setup.js";
import { buildImagePromptContent, modelSupportsImages, summarizeTextDeterministically } from "../../core/utils.js";
import { deliverWorkspaceFileToRequester, formatRequesterFileDeliveryResult, parseRemoteSendFileArgs, type RelayFileDeliveryRequester } from "../../core/requester-file-delivery.js";
import { classifySharedRoomEvent, normalizeMachineSelector, parseSharedRoomSessionsArgs, parseSharedRoomToArgs, parseSharedRoomUseArgs, resolveSharedRoomMachineTarget, sharedRoomAddressingFromEvent, sharedRoomMachineIdentity, type SharedRoomAddressing, type SharedRoomMachineIdentity } from "../../core/shared-room.js";

const DISCORD_CHANNEL = "discord" as const;
const IMAGE_PROMPT_FALLBACK = "Please inspect the attached image.";
const DISCORD_TYPING_REFRESH_MS = 7_000;
const DISCORD_PAIRING_MAX_INVALID_ATTEMPTS = 5;
const DISCORD_PAIRING_ATTEMPT_WINDOW_MS = 60_000;
const DISCORD_HELP_TEXT = buildHelpText({
  title: "PiRelay Discord commands:",
  commandPrefix: "relay",
  footerLines: ["", "Tip: prefer `relay <command>` in Discord DMs. Bare `/status`-style aliases are best-effort because Discord may route slash commands to another app."],
});

export interface DiscordRuntimeOptions {
  operations?: DiscordApiOperations;
}

export interface DiscordRuntimeStatus {
  enabled: boolean;
  started: boolean;
  error?: string;
}

export class DiscordRuntime {
  private readonly store: TunnelStateStore;
  private readonly adapter?: DiscordChannelAdapter;
  private readonly routes = new Map<string, SessionRoute>();
  private readonly ownedBindingSessionKeys = new Set<string>();
  private readonly activeSessionByConversationUser = new Map<string, string>();
  private readonly recentBindingBySessionKey = new Map<string, ChannelPersistedBindingRecord>();
  private readonly typingStates = new Map<string, { address: ChannelRouteAddress; timer?: ReturnType<typeof setTimeout> }>();
  private readonly invalidPairingAttempts = new Map<string, { count: number; resetAt: number }>();
  private started = false;
  private startPromise?: Promise<void>;
  private lastError?: string;

  constructor(
    private readonly config: TelegramTunnelConfig,
    options: DiscordRuntimeOptions = {},
    private readonly instanceId = "default",
  ) {
    this.store = new TunnelStateStore(config.stateDir);
    const discordConfig = config.discordInstances?.[this.instanceId] ?? config.discord;
    const operations = options.operations ?? (discordConfig?.enabled && discordConfig.botToken ? createDiscordLiveOperations(discordConfig) : undefined);
    if (discordConfig?.enabled && discordConfig.botToken && operations) {
      this.adapter = new DiscordChannelAdapter(discordConfig, operations);
    }
  }

  getStatus(): DiscordRuntimeStatus {
    const discordConfig = this.config.discordInstances?.[this.instanceId] ?? this.config.discord;
    return { enabled: Boolean(discordConfig?.enabled && discordConfig.botToken), started: this.started, error: this.lastError };
  }

  async start(): Promise<void> {
    if (!this.adapter || this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.adapter.startPolling(async (event) => this.handleEvent(event))
      .then(() => {
        this.started = true;
        this.lastError = undefined;
      })
      .catch((error: unknown) => {
        this.started = false;
        this.lastError = safeDiscordRuntimeError(error);
        throw new Error(this.lastError);
      })
      .finally(() => {
        this.startPromise = undefined;
      });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.clearAllTypingActivity();
    await this.adapter?.stopPolling?.();
  }

  async registerRoute(route: SessionRoute): Promise<void> {
    this.routes.set(route.sessionKey, route);
    const binding = await this.store.getChannelBindingBySessionKey(DISCORD_CHANNEL, route.sessionKey, this.instanceId);
    if (binding) {
      this.ownedBindingSessionKeys.add(route.sessionKey);
      this.recentBindingBySessionKey.set(route.sessionKey, binding);
    }
  }

  async unregisterRoute(sessionKey: string): Promise<void> {
    this.stopTypingActivity(sessionKey);
    this.routes.delete(sessionKey);
    this.ownedBindingSessionKeys.delete(sessionKey);
    this.recentBindingBySessionKey.delete(sessionKey);
    this.clearActiveSelectionsForSession(sessionKey);
    if (this.routes.size === 0) await this.stop();
  }

  private async activeBindingForRoute(route: SessionRoute, options: { includePaused?: boolean } = {}): Promise<ChannelPersistedBindingRecord | undefined> {
    const stored = await this.store.getActiveChannelBindingForSession(DISCORD_CHANNEL, route.sessionKey, { instanceId: this.instanceId, includePaused: options.includePaused });
    if (stored) return stored;
    const raw = await this.store.getChannelBindingRecordBySessionKey(DISCORD_CHANNEL, route.sessionKey, this.instanceId);
    if (raw) {
      this.recentBindingBySessionKey.delete(route.sessionKey);
      return undefined;
    }
    const recent = this.recentBindingBySessionKey.get(route.sessionKey);
    if (!recent || recent.status === "revoked" || (!options.includePaused && recent.paused)) return undefined;
    return recent;
  }

  async notifyTurnCompleted(route: SessionRoute, status: "completed" | "failed" | "aborted"): Promise<void> {
    this.stopTypingActivity(route.sessionKey);
    if (!this.adapter) return;
    const binding = await this.activeBindingForRoute(route, { includePaused: true });
    if (!binding) return;
    const address = bindingAddress(binding);
    if (status === "completed" && route.notification.lastAssistantText) {
      const mode = progressModeFor({ progressMode: channelProgressMode(binding) }, this.config);
      if (shouldSendFullFinalOutput(mode)) {
        await this.adapter.sendText(address, `✅ Pi session ${route.sessionLabel} completed. Final output:`);
        await sendFinalOutputWithFallback(this.adapter, address, route, route.notification.lastAssistantText);
        return;
      }
    }
    const text = discordTurnNotificationText(route, status);
    await this.adapter.sendText(address, text);
  }

  async sendFileToBoundRoute(route: SessionRoute, file: ChannelOutboundFile, options: { kind: "document" | "image"; caption?: string } = { kind: "document" }): Promise<boolean> {
    if (!this.adapter) throw new Error("Discord file delivery is not configured for this instance.");
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
      channel: DISCORD_CHANNEL,
      instanceId: this.instanceId,
      sessionKey: route.sessionKey,
      conversationId: binding.conversationId,
      userId: binding.userId,
      kind,
    });
    if (!decision.shouldNotify) return;
    await this.adapter.sendText(bindingAddress(binding), formatRelayLifecycleNotification({ kind, sessionLabel: route.sessionLabel, channel: DISCORD_CHANNEL }));
    await this.store.markLifecycleNotificationDelivered({
      channel: DISCORD_CHANNEL,
      instanceId: this.instanceId,
      sessionKey: route.sessionKey,
      conversationId: binding.conversationId,
      userId: binding.userId,
      kind,
    });
  }

  private async handleEvent(event: ChannelInboundEvent): Promise<void> {
    if (!this.adapter || event.channel !== DISCORD_CHANNEL) return;
    try {
      if (event.kind === "action") {
        await this.handleAction(event);
        return;
      }
      await this.handleMessage(event);
    } catch (error) {
      const safeMessage = safeDiscordRuntimeError(error);
      this.lastError = safeMessage;
      if (event.kind === "action") {
        await this.adapter.answerAction(event.actionId, { text: `Discord relay error: ${safeMessage}`, alert: true }).catch(() => undefined);
      } else {
        await this.sendText(event, `Discord relay error: ${safeMessage}`).catch(() => undefined);
      }
    }
  }

  private async handleMessage(message: ChannelInboundMessage): Promise<void> {
    if (!this.config.discord) return;
    const text = message.text.trim();
    const pairingCode = parseDiscordPairingCode(text);
    if (pairingCode) {
      await this.handlePairing(message, pairingCode);
      return;
    }

    const command = parseDiscordCommand(text) ?? parseDiscordCommand(stripLeadingDiscordMentions(text));
    if (this.isSharedRoomMessage(message) && !isDiscordIdentityAllowed(message.sender, this.config.discord)) {
      if (this.shouldRejectUnauthorizedSharedRoomEvent(message, command)) {
        await this.sendText(message, "This Discord identity is not authorized to control this PiRelay machine bot.");
      }
      return;
    }
    const sharedRoomDecision = await this.applySharedRoomPreRouting(message, command);
    if (sharedRoomDecision.kind === "silent") return;
    const routedMessage = sharedRoomDecision.message ?? message;
    const routedCommand = sharedRoomDecision.command ?? command;
    const preferredSessionKey = routedCommand?.name === "to" ? await this.targetSessionKeyForToCommand(routedMessage, routedCommand.args) : await this.sharedRoomPreferredSessionKey(routedMessage);
    const binding = await this.findDiscordBinding(routedMessage, { preferredSessionKey });
    if (!binding || !isDiscordIdentityAllowed(routedMessage.sender, this.config.discord)) {
      await this.sendText(routedMessage, "This Discord chat is not paired with a Pi session. Run /relay connect discord locally first.");
      return;
    }

    const route = this.routes.get(binding.sessionKey);
    if (!route) {
      // Multiple Pi sessions can run Discord gateway clients for the same bot.
      // Let the runtime that paired or restored the binding answer. Other
      // clients (including route-less stale clients) must stay silent instead
      // of sending a false offline response before the owner handles it.
      if (!this.ownedBindingSessionKeys.has(binding.sessionKey)) return;
      await this.sendText(routedMessage, `The target Pi session (${binding.sessionLabel}) is not online. Re-run /relay connect discord locally.`);
      return;
    }

    await this.handleBoundMessage(routedMessage, binding, route);
  }

  private async applySharedRoomPreRouting(message: ChannelInboundMessage, command: DiscordCommand | undefined): Promise<{ kind: "continue"; message?: ChannelInboundMessage; command?: DiscordCommand } | { kind: "silent" }> {
    if (!this.isSharedRoomMessage(message)) return { kind: "continue" };
    const localMachine = this.sharedRoomMachineIdentity();
    const explicitAddressing = this.sharedRoomAddressing(message);
    if (command?.name === "use") {
      const parsed = parseSharedRoomUseArgs(command.args);
      if (!parsed) {
        return explicitAddressing?.kind === "local"
          ? { kind: "continue", message: { ...message, text: stripLeadingDiscordMentions(message.text) } }
          : { kind: "silent" };
      }
      const target = resolveSharedRoomMachineTarget({ selector: parsed.machineSelector, localMachine });
      if (target.kind === "local") {
        const rewritten = { name: "use" as const, args: parsed.sessionSelector };
        return { kind: "continue", command: rewritten, message: { ...message, text: `relay use ${parsed.sessionSelector}` } };
      }
      const remoteMachineId = target.kind === "remote" ? target.machineId ?? normalizeMachineSelector(parsed.machineSelector) : normalizeMachineSelector(parsed.machineSelector);
      await this.setActiveSelection(message, `remote:${remoteMachineId}:${parsed.sessionSelector}`, { machineId: remoteMachineId, machineDisplayName: parsed.machineSelector });
      return { kind: "silent" };
    }

    if (command?.name === "to") {
      const parsed = parseSharedRoomToArgs(command.args);
      if (!parsed) {
        return explicitAddressing?.kind === "local"
          ? { kind: "continue", message: { ...message, text: stripLeadingDiscordMentions(message.text) } }
          : { kind: "silent" };
      }
      const target = resolveSharedRoomMachineTarget({ selector: parsed.machineSelector, localMachine });
      if (target.kind === "local") {
        const rewritten = { name: "to" as const, args: parsed.sessionAndPrompt };
        return { kind: "continue", command: rewritten, message: { ...message, text: `relay to ${parsed.sessionAndPrompt}` } };
      }
      return { kind: "silent" };
    }

    if (command?.name === "sessions") {
      const parsed = parseSharedRoomSessionsArgs(command.args);
      if (parsed.kind === "local" && command.args.trim() === "" && explicitAddressing?.kind !== "local") {
        return { kind: "silent" };
      }
      if (parsed.kind === "machine") {
        const target = resolveSharedRoomMachineTarget({ selector: parsed.machineSelector ?? "", localMachine });
        if (target.kind !== "local") return { kind: "silent" };
        return { kind: "continue", command: { name: "sessions", args: "" }, message: { ...message, text: "relay sessions" } };
      }
      return { kind: "continue" };
    }

    const active = await this.store.getActiveChannelSelection(DISCORD_CHANNEL, message.conversation.id, message.sender.userId);
    const classification = classifySharedRoomEvent({ explicitAddressing, activeSelection: active, localMachine });
    switch (classification.kind) {
      case "explicit-local":
      case "active-local":
        return { kind: "continue" };
      case "explicit-ambiguous":
        await this.sendText(message, `I could not determine which PiRelay machine bot was addressed${classification.reason ? `: ${classification.reason}` : "."}`);
        return { kind: "silent" };
      case "explicit-remote":
      case "active-remote":
      case "no-target":
        return { kind: "silent" };
    }
  }

  private shouldRejectUnauthorizedSharedRoomEvent(message: ChannelInboundMessage, command: DiscordCommand | undefined): boolean {
    if (!this.isSharedRoomMessage(message)) return false;
    const localMachine = this.sharedRoomMachineIdentity();
    const targetSelector = command?.name === "use"
      ? parseSharedRoomUseArgs(command.args)?.machineSelector
      : command?.name === "to"
        ? parseSharedRoomToArgs(command.args)?.machineSelector
        : command?.name === "sessions"
          ? parseSharedRoomSessionsArgs(command.args).machineSelector
          : undefined;
    if (targetSelector) {
      return resolveSharedRoomMachineTarget({ selector: targetSelector, localMachine }).kind === "local";
    }
    return this.sharedRoomAddressing(message)?.kind === "local";
  }

  private sharedRoomAddressing(message: ChannelInboundMessage): SharedRoomAddressing | undefined {
    const explicit = sharedRoomAddressingFromEvent(message);
    if (explicit) return explicit;
    const rawMentions = message.metadata?.mentions;
    const mentions = Array.isArray(rawMentions) ? rawMentions.filter((mention): mention is string => typeof mention === "string") : [];
    if (mentions.length === 0) return undefined;
    return discordMentionsSharedRoomAddressing(mentions, this.config.discord?.applicationId ?? this.config.discord?.clientId);
  }

  private isSharedRoomMessage(message: Pick<ChannelInboundMessage, "conversation">): boolean {
    return Boolean(this.config.discord?.sharedRoom?.enabled) && message.conversation.kind !== "private";
  }

  private sharedRoomMachineIdentity(): SharedRoomMachineIdentity {
    const aliases = [
      ...(this.config.machineAliases ?? []),
      ...(this.config.discord?.sharedRoom?.machineAliases ?? []),
    ];
    return sharedRoomMachineIdentity({
      machineId: this.config.machineId ?? "local",
      displayName: this.config.machineDisplayName,
      aliases,
    });
  }

  private async sharedRoomPreferredSessionKey(message: ChannelInboundMessage): Promise<string | undefined> {
    if (!this.isSharedRoomMessage(message)) return undefined;
    const active = await this.store.getActiveChannelSelection(DISCORD_CHANNEL, message.conversation.id, message.sender.userId);
    return active?.machineId && active.machineId !== this.sharedRoomMachineIdentity().machineId ? undefined : active?.sessionKey;
  }

  private async handlePairing(message: ChannelInboundMessage, code: string): Promise<void> {
    if (!this.config.discord) return;
    if (this.isPairingAttemptThrottled(message)) {
      await this.sendText(message, "Too many invalid Discord pairing attempts. Wait a minute, then run /relay connect discord again if needed.");
      return;
    }
    const pending = await this.store.inspectPendingPairing(code, { channel: DISCORD_CHANNEL });
    if (pending.status === "consumed") return;
    if (pending.status !== "active") {
      this.recordInvalidPairingAttempt(message);
      await this.sendText(message, "This Discord pairing code is invalid or expired. Run /relay connect discord again in Pi.");
      return;
    }

    const pairing = pending.pairing;
    const route = this.routes.get(pairing.sessionKey);
    if (!route) return;

    const result = completeDiscordPairing(message, { ...pairing, consumedAt: undefined }, code, this.config.discord);
    if (!result.ok) {
      if (result.reason === "command-mismatch") this.recordInvalidPairingAttempt(message);
      await this.sendText(message, discordPairingFailureMessage(result.reason));
      return;
    }

    const allowedByConfig = (this.config.discord.allowUserIds ?? []).includes(message.sender.userId);
    const trusted = await this.store.getTrustedRelayUser(DISCORD_CHANNEL, message.sender.userId);
    const approval = allowedByConfig || trusted ? "allow" : normalizePairingApproval(await route.actions.promptLocalConfirmation({
      channel: DISCORD_CHANNEL,
      userId: message.sender.userId,
      username: message.sender.username,
      displayName: message.sender.displayName,
      firstName: message.sender.firstName,
      lastName: message.sender.lastName,
      conversationKind: message.conversation.kind,
      instanceId: "default",
    }));

    if (approval === "deny") {
      await this.store.markPendingPairingConsumed(code, { channel: DISCORD_CHANNEL });
      await this.sendText(message, "Discord pairing was declined locally. Ask the Pi user to retry /relay connect discord.");
      return;
    }

    const consumed = await this.store.markPendingPairingConsumed(code, { channel: DISCORD_CHANNEL });
    if (!consumed) return;

    if (approval === "trust") {
      await this.store.trustRelayUser({
        channel: DISCORD_CHANNEL,
        instanceId: "default",
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
    route.actions.appendAudit(`Discord paired with ${pairedUser}.`);
    route.actions.notifyLocal?.(`Discord paired with ${pairedUser} for ${route.sessionLabel}.`, "info");
    await this.sendText(message, `Discord paired with ${route.sessionLabel}. Send relay status or a prompt to control Pi.`);
  }

  private async findDiscordBinding(message: Pick<ChannelInboundMessage, "conversation" | "sender">, options: { preferredSessionKey?: string } = {}): Promise<ChannelPersistedBindingRecord | undefined> {
    const candidates = await this.discordBindingsForMessage(message);
    if (candidates.length === 0) return undefined;

    const activeKey = options.preferredSessionKey ?? await this.activeSelectionForMessage(message);
    const active = activeKey ? candidates.find((binding) => binding.sessionKey === activeKey) : undefined;
    const selected = active ?? latestDiscordBinding(candidates);
    if (!selected) return undefined;

    if (selected.conversationId === message.conversation.id) return selected;
    const refreshed = { ...selected, conversationId: message.conversation.id, lastSeenAt: new Date().toISOString() };
    await this.store.upsertChannelBinding(refreshed);
    this.recentBindingBySessionKey.set(refreshed.sessionKey, refreshed);
    if (activeKey === selected.sessionKey) await this.setActiveSelection(message, selected.sessionKey);
    return refreshed;
  }

  private async handleBoundMessage(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute): Promise<void> {
    this.recentBindingBySessionKey.set(binding.sessionKey, binding);
    const command = parseDiscordCommand(message.text);
    if (binding.paused && (!command || !commandAllowsWhilePaused(command.name))) {
      await this.sendText(message, "The relay is currently paused. Use /resume or disconnect locally.");
      return;
    }
    if (command) {
      await this.handleCommand(message, binding, route, command);
      return;
    }

    const unsupported = message.attachments.find((attachment) => attachment.supported === false);
    if (unsupported) {
      await this.sendText(message, unsupported.unsupportedReason ?? "Attachment is not supported by the Discord relay.");
      return;
    }

    const imageAttachments = message.attachments.filter((attachment) => attachment.kind === "image");
    if (imageAttachments.length > 0 && !modelSupportsImages(route.actions.getModel())) {
      await this.sendText(message, "The current Pi model does not support image input. Switch to an image-capable model and retry.");
      return;
    }

    const promptText = message.text.trim() || (imageAttachments.length > 0 ? IMAGE_PROMPT_FALLBACK : "");
    if (!promptText) {
      await this.sendText(message, "Send text or a supported image with a caption to prompt Pi.");
      return;
    }

    await this.deliverDiscordPrompt(message, binding, route, promptText);
  }

  private async handleCommand(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute, command: DiscordCommand): Promise<void> {
    switch (command.name) {
      case "help":
        await this.sendText(message, DISCORD_HELP_TEXT);
        return;
      case "status":
        await this.sendText(message, this.statusTextForRoute(route, binding, true));
        return;
      case "sessions":
        await this.sendText(message, this.formatSessionListForMessage(message, await this.sessionEntriesForMessage(message), await this.activeSelectionForMessage(message) ?? route.sessionKey));
        return;
      case "use":
        await this.handleUseCommand(message, command.args);
        return;
      case "to":
        await this.handleToCommand(message, command.args);
        return;
      case "progress":
      case "notify":
        await this.handleProgressCommand(message, binding, command.args);
        return;
      case "alias":
        await this.handleAliasCommand(message, binding, route, command.args);
        return;
      case "forget":
        await this.handleForgetCommand(message, command.args);
        return;
      case "recent":
      case "activity":
        await this.sendText(message, formatRelayRecentActivity(route, this.config));
        return;
      case "summary":
        await this.sendText(message, formatSummaryOutput(route));
        return;
      case "full":
        await this.sendText(message, formatFullOutput(route));
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
      case "steer":
        await this.handlePromptCommand(message, binding, route, command.args, "steer");
        return;
      case "followup":
        await this.handlePromptCommand(message, binding, route, command.args, "followUp");
        return;
      case "abort":
        if (route.actions.context.isIdle()) {
          await this.sendText(message, "The Pi session is already idle.");
          return;
        }
        route.notification.abortRequested = true;
        this.stopTypingActivity(route.sessionKey);
        route.actions.abort();
        route.actions.appendAudit("Discord requested abort.");
        await this.sendText(message, "Abort requested.");
        return;
      case "compact":
        route.actions.appendAudit("Discord requested compaction.");
        await route.actions.compact();
        await this.sendText(message, "Compaction requested.");
        return;
      case "pause":
        this.stopTypingActivity(route.sessionKey);
        await this.setPaused(message, binding, route, true);
        return;
      case "resume":
        await this.setPaused(message, binding, route, false);
        return;
      case "disconnect":
        this.stopTypingActivity(binding.sessionKey);
        await this.store.revokeChannelBinding(DISCORD_CHANNEL, binding.sessionKey, new Date().toISOString(), this.instanceId);
        this.recentBindingBySessionKey.delete(binding.sessionKey);
        await this.clearActiveSelection(message, binding.sessionKey);
        route.actions.appendAudit("Discord relay disconnected remotely.");
        route.actions.refreshLocalStatus?.();
        await this.sendText(message, "Discord relay disconnected for this Pi session.");
        return;
      default:
        await this.sendText(message, `Unknown command: /${command.name}. Use /help.`);
    }
  }

  private discordRequester(route: SessionRoute, message: ChannelInboundMessage): RelayFileDeliveryRequester {
    return {
      channel: DISCORD_CHANNEL,
      instanceId: this.instanceId,
      conversationId: message.conversation.id,
      userId: message.sender.userId,
      sessionKey: route.sessionKey,
      safeLabel: `Discord ${message.sender.displayName ?? message.sender.username ?? message.sender.userId}`,
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
      const error = "Discord file delivery is not configured for this instance.";
      if (source === "remote-command") await this.sendText(message, error);
      return error;
    }
    const requester = this.discordRequester(route, message);
    route.remoteRequester = requester;
    const result = await deliverWorkspaceFileToRequester({
      route,
      requester,
      adapter: this.adapter,
      workspaceRoot: route.actions.context.cwd,
      relativePath: request.relativePath,
      caption: request.caption,
      source,
      maxDocumentBytes: this.adapter.capabilities.maxDocumentBytes,
      maxImageBytes: this.adapter.capabilities.maxImageBytes,
      allowedImageMimeTypes: this.adapter.capabilities.supportedImageMimeTypes,
    });
    route.actions.appendAudit(`Discord send-file ${result.ok ? "delivered" : "failed"}: ${result.ok ? result.relativePath : result.error}`);
    const text = formatRequesterFileDeliveryResult(result);
    if (!result.ok && source === "remote-command") await this.sendText(message, text);
    return text;
  }

  async sendFileToRequester(route: SessionRoute, requester: RelayFileDeliveryRequester, relativePath: string, caption?: string): Promise<string> {
    if (!this.adapter) return "Discord file delivery is not configured for this instance.";
    const result = await deliverWorkspaceFileToRequester({
      route,
      requester,
      adapter: this.adapter,
      workspaceRoot: route.actions.context.cwd,
      relativePath,
      caption,
      source: "assistant-tool",
      maxDocumentBytes: this.adapter.capabilities.maxDocumentBytes,
      maxImageBytes: this.adapter.capabilities.maxImageBytes,
      allowedImageMimeTypes: this.adapter.capabilities.supportedImageMimeTypes,
    });
    route.actions.appendAudit(`Discord assistant send-file ${result.ok ? "delivered" : "failed"}: ${result.ok ? result.relativePath : result.error}`);
    return formatRequesterFileDeliveryResult(result);
  }

  private async deliverDiscordPrompt(
    message: ChannelInboundMessage,
    binding: ChannelPersistedBindingRecord,
    route: SessionRoute,
    promptText: string,
    options: { deliverAs?: "followUp" | "steer"; idleAck?: string; busyAck?: string; auditAction?: string } = {},
  ): Promise<void> {
    const content = buildImagePromptContent(promptText, []);
    this.startTypingActivity(route, bindingAddress(binding));
    const wasIdle = route.actions.context.isIdle();
    const deliverAs = wasIdle ? undefined : options.deliverAs ?? this.config.busyDeliveryMode;
    try {
      route.remoteRequester = this.discordRequester(route, message);
      route.actions.sendUserMessage(content, deliverAs ? { deliverAs } : undefined);
    } catch (error) {
      this.stopTypingActivity(route.sessionKey);
      const safeMessage = safeDiscordRuntimeError(error);
      this.lastError = safeMessage;
      await this.sendText(message, `Could not deliver the Discord prompt to Pi: ${safeMessage}`);
      return;
    }
    route.lastActivityAt = Date.now();
    try {
      await this.store.upsertChannelBinding({ ...binding, lastSeenAt: new Date().toISOString() });
      this.recentBindingBySessionKey.set(binding.sessionKey, { ...binding, lastSeenAt: new Date().toISOString() });
    } catch (error) {
      this.lastError = safeDiscordRuntimeError(error);
    }
    const auditAction = options.auditAction ?? "prompt";
    route.actions.appendAudit(`Discord ${auditAction} from ${message.sender.displayName ?? message.sender.userId}: ${summarizeTextDeterministically(promptText, 120)}`);
    await this.sendText(message, wasIdle ? options.idleAck ?? "Prompt delivered to Pi." : options.busyAck ?? `Pi is busy; queued as ${deliverAs}.`);
  }

  private async handlePromptCommand(
    message: ChannelInboundMessage,
    binding: ChannelPersistedBindingRecord,
    route: SessionRoute,
    args: string,
    deliverAs: "followUp" | "steer",
  ): Promise<void> {
    if (!args) {
      await this.sendText(message, `Usage: /${deliverAs === "steer" ? "steer" : "followup"} <text>`);
      return;
    }
    const idle = route.actions.context.isIdle();
    await this.deliverDiscordPrompt(message, binding, route, args, {
      deliverAs: idle ? undefined : deliverAs,
      auditAction: deliverAs === "steer" ? "steering instruction" : "follow-up",
      idleAck: idle ? "Sent as a prompt." : undefined,
      busyAck: idle ? undefined : deliverAs === "steer" ? "Steering queued." : "Follow-up queued.",
    });
  }

  private async handleUseCommand(message: ChannelInboundMessage, args: string): Promise<void> {
    const entries = await this.sessionEntriesForMessage(message);
    const result = resolveSessionSelector(entries, args);
    if (result.kind !== "matched") {
      await this.sendText(message, formatSessionSelectorError(result, args));
      return;
    }
    await this.setActiveSelection(message, result.entry.sessionKey, this.isSharedRoomMessage(message) ? { machineId: this.sharedRoomMachineIdentity().machineId, machineDisplayName: this.sharedRoomMachineIdentity().displayName } : {});
    const binding = await this.findBindingForSession(message, result.entry.sessionKey);
    const route = this.routes.get(result.entry.sessionKey);
    await this.sendText(message, route && binding ? this.statusTextForRoute(route, binding, true) : `Active session selected: ${result.entry.sessionLabel}`);
  }

  private async handleToCommand(message: ChannelInboundMessage, args: string): Promise<void> {
    const entries = await this.sessionEntriesForMessage(message);
    const resolution = resolveSessionTargetArgs(entries, args);
    if (resolution.result.kind !== "matched") {
      await this.sendText(message, formatSessionSelectorError(resolution.result, resolution.selector || args));
      return;
    }
    if (!resolution.prompt) {
      await this.sendText(message, "Usage: /to <session> <prompt>");
      return;
    }
    const route = this.routes.get(resolution.result.entry.sessionKey);
    const binding = await this.findBindingForSession(message, resolution.result.entry.sessionKey);
    if (!route || !binding) {
      await this.sendText(message, `Pi session ${resolution.result.entry.sessionLabel} is offline. Resume it locally, then try again.`);
      return;
    }
    await this.deliverDiscordPrompt(message, binding, route, resolution.prompt);
  }

  private async handleAliasCommand(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute, args: string): Promise<void> {
    const alias = normalizeAliasArg(args);
    const updated = await this.store.upsertChannelBinding({ ...binding, metadata: { ...binding.metadata, alias } });
    this.recentBindingBySessionKey.set(updated.sessionKey, updated);
    route.actions.appendAudit(alias ? `Discord set session alias to ${alias}.` : "Discord cleared session alias.");
    await this.sendText(message, alias ? `Session alias set to ${alias}.` : "Session alias cleared.");
  }

  private async handleProgressCommand(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, args: string): Promise<void> {
    const parsed = args ? normalizeProgressMode(args) : undefined;
    if (!args || !parsed) {
      await this.sendText(message, `Progress mode: ${displayProgressMode(channelProgressMode(binding) ?? this.config.progressMode)}\nUsage: /progress <quiet|normal|verbose|completion-only>`);
      return;
    }
    const mode = progressModeFor({ progressMode: parsed }, this.config);
    const updated = await this.store.upsertChannelBinding({ ...binding, metadata: { ...binding.metadata, progressMode: mode } });
    this.recentBindingBySessionKey.set(updated.sessionKey, updated);
    await this.sendText(message, `Progress notifications set to ${displayProgressMode(mode)}.`);
  }

  private async handleForgetCommand(message: ChannelInboundMessage, args: string): Promise<void> {
    const entries = await this.sessionEntriesForMessage(message);
    const result = resolveSessionSelector(entries, args);
    if (result.kind !== "offline") {
      await this.sendText(message, result.kind === "matched" ? "Use /disconnect for an online active session. /forget only removes offline sessions." : formatSessionSelectorError(result, args));
      return;
    }
    await this.store.revokeChannelBinding(DISCORD_CHANNEL, result.entry.sessionKey, new Date().toISOString(), this.instanceId);
    await this.sendText(message, `Forgot offline session ${result.entry.sessionLabel}.`);
  }

  private async setPaused(message: ChannelInboundMessage, binding: ChannelPersistedBindingRecord, route: SessionRoute, paused: boolean): Promise<void> {
    const updated = await this.store.upsertChannelBinding({ ...binding, paused });
    this.recentBindingBySessionKey.set(updated.sessionKey, updated);
    route.actions.appendAudit(paused ? "Discord relay paused remotely." : "Discord relay resumed remotely.");
    route.actions.refreshLocalStatus?.();
    await this.sendText(message, paused ? "Relay paused. Remote prompts and notifications are suspended until /resume." : "Relay resumed.");
  }

  private async sendLatestImages(message: ChannelInboundMessage, route: SessionRoute): Promise<void> {
    const images = await route.actions.getLatestImages();
    if (images.length === 0) {
      await this.sendText(message, formatLatestImageEmptyMessage());
      return;
    }
    let sent = 0;
    for (const image of images) {
      await this.sendDiscordImage(message, image, images.length === 1 ? "Latest Pi image output" : `Latest Pi image output ${sent + 1}/${images.length}`);
      sent += 1;
    }
  }

  private async sendImageByPath(message: ChannelInboundMessage, route: SessionRoute, args: string): Promise<void> {
    const relativePath = args.trim();
    if (!relativePath) {
      await this.sendText(message, "Usage: /send-image <relative-image-path>");
      return;
    }
    const result = await route.actions.getImageByPath(relativePath);
    if (!result.ok) {
      await this.sendText(message, result.error);
      return;
    }
    await this.sendDiscordImage(message, result.image, "Pi image file");
  }

  private async sendDiscordImage(message: ChannelInboundMessage, image: LatestTurnImage, caption: string): Promise<void> {
    await this.adapter?.sendImage(
      { channel: DISCORD_CHANNEL, conversationId: message.conversation.id, userId: message.sender.userId },
      { fileName: image.fileName, mimeType: image.mimeType, data: image.data, byteSize: image.byteSize },
      { caption },
    );
  }

  private async sessionEntriesForMessage(message: ChannelInboundMessage): Promise<SessionListEntry[]> {
    const bindings = await this.discordBindingsForMessage(message);
    const byKey = new Map<string, SessionListEntry>();
    for (const binding of bindings) {
      const route = this.routes.get(binding.sessionKey);
      if (route) {
        const busy = !route.actions.context.isIdle();
        byKey.set(binding.sessionKey, {
          sessionKey: route.sessionKey,
          sessionId: route.sessionId,
          sessionFile: route.sessionFile,
          sessionLabel: route.sessionLabel,
          alias: channelAlias(binding),
          online: true,
          busy,
          paused: Boolean(binding.paused),
          modelId: statusSnapshotForRoute(route, { online: true, busy }).modelId,
          lastActivityAt: route.lastActivityAt,
        });
        continue;
      }
      byKey.set(binding.sessionKey, {
        sessionKey: binding.sessionKey,
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        sessionLabel: binding.sessionLabel,
        alias: channelAlias(binding),
        online: false,
        busy: false,
        paused: Boolean(binding.paused),
        lastActivityAt: Date.parse(binding.lastSeenAt) || undefined,
      });
    }
    return [...byKey.values()];
  }

  private formatSessionListForMessage(message: ChannelInboundMessage, entries: SessionListEntry[], activeSessionKey: string | undefined): string {
    const list = formatSessionList(entries, activeSessionKey);
    if (!this.isSharedRoomMessage(message)) return list;
    const machine = this.sharedRoomMachineIdentity();
    const aliasText = machine.aliases.length > 0 ? `\nAliases: ${machine.aliases.join(", ")}` : "";
    return [`Machine: ${machine.displayName ?? machine.machineId} (${machine.machineId})${aliasText}`, "", list].join("\n");
  }

  private async discordBindingsForMessage(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<ChannelPersistedBindingRecord[]> {
    const persisted = Object.values((await this.store.load()).channelBindings)
      .filter((binding) => binding.channel === DISCORD_CHANNEL && (binding.instanceId ?? "default") === this.instanceId && binding.userId === message.sender.userId && binding.status !== "revoked");
    const recent: ChannelPersistedBindingRecord[] = [];
    for (const binding of this.recentBindingBySessionKey.values()) {
      if (binding.channel !== DISCORD_CHANNEL || (binding.instanceId ?? "default") !== this.instanceId || binding.userId !== message.sender.userId || binding.status === "revoked") continue;
      const raw = await this.store.getChannelBindingRecordBySessionKey(DISCORD_CHANNEL, binding.sessionKey, this.instanceId);
      if (raw) continue;
      recent.push(binding);
    }
    const bindings = [...new Map([...persisted, ...recent].map((binding) => [binding.sessionKey, binding])).values()];
    const exactConversation = bindings.filter((binding) => binding.conversationId === message.conversation.id);
    return exactConversation.length > 0 ? exactConversation : bindings;
  }

  private async findBindingForSession(message: ChannelInboundMessage, sessionKey: string): Promise<ChannelPersistedBindingRecord | undefined> {
    return (await this.discordBindingsForMessage(message)).find((binding) => binding.sessionKey === sessionKey);
  }

  private statusTextForRoute(route: SessionRoute, binding: ChannelPersistedBindingRecord, online: boolean): string {
    const busy = !route.actions.context.isIdle();
    return formatRelayStatusForRoute(route, {
      online,
      busy,
      binding,
      progressMode: channelProgressMode(binding) ?? this.config.progressMode,
      includeLastStatus: true,
    });
  }

  private activeSelectionKey(message: Pick<ChannelInboundMessage, "conversation" | "sender">): string {
    return `${message.conversation.id}:${message.sender.userId}`;
  }

  private async activeSelectionForMessage(message: Pick<ChannelInboundMessage, "conversation" | "sender">): Promise<string | undefined> {
    const persisted = await this.store.getActiveChannelSelection(DISCORD_CHANNEL, message.conversation.id, message.sender.userId);
    return persisted?.sessionKey ?? this.activeSessionByConversationUser.get(this.activeSelectionKey(message));
  }

  private async setActiveSelection(message: Pick<ChannelInboundMessage, "conversation" | "sender">, sessionKey: string, options: { machineId?: string; machineDisplayName?: string } = {}): Promise<void> {
    this.activeSessionByConversationUser.set(this.activeSelectionKey(message), sessionKey);
    await this.store.setActiveChannelSelection(DISCORD_CHANNEL, message.conversation.id, message.sender.userId, sessionKey, options);
  }

  private async clearActiveSelection(message: Pick<ChannelInboundMessage, "conversation" | "sender">, sessionKey?: string): Promise<void> {
    this.activeSessionByConversationUser.delete(this.activeSelectionKey(message));
    await this.store.clearActiveChannelSelection(DISCORD_CHANNEL, message.conversation.id, message.sender.userId, sessionKey);
  }

  private clearActiveSelectionsForSession(sessionKey: string): void {
    for (const [key, activeSessionKey] of this.activeSessionByConversationUser) {
      if (activeSessionKey === sessionKey) this.activeSessionByConversationUser.delete(key);
    }
  }

  private async targetSessionKeyForToCommand(message: ChannelInboundMessage, args: string): Promise<string | undefined> {
    const resolution = resolveSessionTargetArgs(await this.sessionEntriesForMessage(message), args);
    return resolution.result.kind === "matched" || resolution.result.kind === "offline" ? resolution.result.entry.sessionKey : undefined;
  }

  private async handleAction(action: ChannelInboundAction): Promise<void> {
    const binding = await this.findDiscordBinding(action);
    if (!binding || !this.config.discord || !isDiscordIdentityAllowed(action.sender, this.config.discord)) {
      await this.adapter?.answerAction(action.actionId, { text: "This Discord action is not authorized.", alert: true });
      return;
    }
    if (!this.routes.has(binding.sessionKey)) {
      await this.adapter?.answerAction(action.actionId, { text: "This Discord action is no longer current.", alert: true });
      return;
    }
    await this.adapter?.answerAction(action.actionId, { text: "Action received." });
  }

  private async sendText(message: ChannelInboundMessage, text: string): Promise<void> {
    await this.adapter?.sendText({ channel: DISCORD_CHANNEL, conversationId: message.conversation.id, userId: message.sender.userId }, text);
  }

  private pairingAttemptKey(message: ChannelInboundMessage): string {
    return `${message.conversation.id}:${message.sender.userId}`;
  }

  private isPairingAttemptThrottled(message: ChannelInboundMessage): boolean {
    const key = this.pairingAttemptKey(message);
    const now = Date.now();
    const attempts = this.invalidPairingAttempts.get(key);
    if (!attempts || attempts.resetAt <= now) return false;
    return attempts.count >= DISCORD_PAIRING_MAX_INVALID_ATTEMPTS;
  }

  private recordInvalidPairingAttempt(message: ChannelInboundMessage): void {
    const key = this.pairingAttemptKey(message);
    const now = Date.now();
    const current = this.invalidPairingAttempts.get(key);
    if (!current || current.resetAt <= now) {
      this.invalidPairingAttempts.set(key, { count: 1, resetAt: now + DISCORD_PAIRING_ATTEMPT_WINDOW_MS });
      return;
    }
    this.invalidPairingAttempts.set(key, { ...current, count: current.count + 1 });
  }

  private startTypingActivity(route: SessionRoute, address: ChannelRouteAddress): void {
    this.stopTypingActivity(route.sessionKey);
    this.typingStates.set(route.sessionKey, { address });
    this.sendActivityBestEffort(address);
    this.scheduleTypingRefresh(route.sessionKey);
  }

  private scheduleTypingRefresh(sessionKey: string): void {
    const state = this.typingStates.get(sessionKey);
    if (!state) return;
    state.timer = setTimeout(() => this.refreshTypingActivity(sessionKey), DISCORD_TYPING_REFRESH_MS);
    unrefTimer(state.timer);
  }

  private refreshTypingActivity(sessionKey: string): void {
    const current = this.typingStates.get(sessionKey);
    const route = this.routes.get(sessionKey);
    const raw = this.store.getChannelBindingRecordBySessionKeySync(DISCORD_CHANNEL, sessionKey, this.instanceId);
    const binding = raw?.status === "revoked"
      ? undefined
      : this.store.getActiveChannelBindingForSessionSync(DISCORD_CHANNEL, sessionKey, { instanceId: this.instanceId, includePaused: true }) ?? (!raw ? this.recentBindingBySessionKey.get(sessionKey) : undefined);
    if (!current || !route || !binding || binding.paused || isTerminalStatus(route.notification.lastStatus)) {
      this.stopTypingActivity(sessionKey);
      return;
    }
    this.sendActivityBestEffort(bindingAddress(binding));
    this.scheduleTypingRefresh(sessionKey);
  }

  private stopTypingActivity(sessionKey: string): void {
    const state = this.typingStates.get(sessionKey);
    if (state?.timer) clearTimeout(state.timer);
    this.typingStates.delete(sessionKey);
  }

  private clearAllTypingActivity(): void {
    for (const sessionKey of this.typingStates.keys()) this.stopTypingActivity(sessionKey);
  }

  private sendActivityBestEffort(address: ChannelRouteAddress): void {
    void this.adapter?.sendActivity(address, "typing").catch((error: unknown) => {
      this.lastError = safeDiscordRuntimeError(error);
    });
  }
}

export type DiscordCommandName = "help" | "status" | "sessions" | "use" | "to" | "progress" | "notify" | "alias" | "forget" | "recent" | "activity" | "summary" | "full" | "images" | "send-file" | "sendfile" | "send-image" | "sendimage" | "steer" | "followup" | "abort" | "compact" | "pause" | "resume" | "disconnect";

type DiscordCommand = { name: DiscordCommandName; args: string };

export const DISCORD_SUPPORTED_COMMANDS: readonly DiscordCommandName[] = [
  "help",
  "status",
  "sessions",
  "use",
  "to",
  "progress",
  "notify",
  "alias",
  "forget",
  "recent",
  "activity",
  "summary",
  "full",
  "images",
  "send-file",
  "sendfile",
  "send-image",
  "sendimage",
  "steer",
  "followup",
  "abort",
  "compact",
  "pause",
  "resume",
  "disconnect",
];

export function createDiscordRuntime(config: TelegramTunnelConfig, options?: DiscordRuntimeOptions): DiscordRuntime | undefined {
  if (!config.discord?.enabled || !config.discord.botToken) return undefined;
  return new DiscordRuntime(config, options);
}

type DiscordRuntimeRegistry = Map<string, DiscordRuntime>;

function getDiscordRuntimeRegistry(): DiscordRuntimeRegistry {
  const globalKey = "__piDiscordRelayRuntimeRegistry";
  const globalValue = globalThis as typeof globalThis & { [globalKey]?: DiscordRuntimeRegistry };
  if (!globalValue[globalKey]) {
    globalValue[globalKey] = new Map();
  }
  return globalValue[globalKey]!;
}

export function getOrCreateDiscordRuntime(config: TelegramTunnelConfig, options?: DiscordRuntimeOptions, instanceId = "default"): DiscordRuntime | undefined {
  const discordConfig = config.discordInstances?.[instanceId] ?? config.discord;
  if (!discordConfig?.enabled || !discordConfig.botToken) return undefined;
  const key = `discord:${instanceId}:${discordConfig.botToken}`;
  const registry = getDiscordRuntimeRegistry();
  const existing = registry.get(key);
  if (existing) return existing;
  const runtime = new DiscordRuntime(config, options, instanceId);
  registry.set(key, runtime);
  return runtime;
}

export function parseDiscordPairingCode(text: string): string | undefined {
  const trimmed = text.trim();
  const start = trimmed.match(/^\/start\s+(.+)$/i);
  if (start?.[1]) return start[1].trim();
  const pair = trimmed.match(/^(?:relay|pirelay)\s+pair\s+(.+)$/i);
  return pair?.[1]?.trim();
}

function stripLeadingDiscordMentions(text: string): string {
  return text.replace(/^(?:\s*<@!?\d+>)+\s*/, "").trim();
}

export function parseDiscordCommand(text: string): DiscordCommand | undefined {
  const parsed = parseRemoteCommandInvocation(text, { prefixes: ["relay", "pirelay"] });
  if (!parsed) return undefined;
  const command = normalizeDiscordRelayCommand(parsed);
  const normalized = command.command === "sendimage" ? "sendimage" : command.command;
  if (isDiscordCommandName(normalized)) return { name: normalized, args: command.args };
  return { name: "help", args: command.args };
}

function normalizePairingApproval(value: PairingApprovalDecision | boolean): PairingApprovalDecision {
  if (value === true) return "allow";
  if (value === false) return "deny";
  return value;
}

function normalizeDiscordRelayCommand(command: { command: string; args: string }): { command: string; args: string } {
  if (command.command !== "relay" && command.command !== "pirelay") return command;
  const [subcommand, ...rest] = command.args.split(/\s+/).filter(Boolean);
  return { command: subcommand?.replace(/^\/+/, "").toLowerCase() || "help", args: rest.join(" ").trim() };
}

function isDiscordCommandName(value: string): value is DiscordCommandName {
  return (DISCORD_SUPPORTED_COMMANDS as readonly string[]).includes(value);
}

function latestDiscordBinding(bindings: ChannelPersistedBindingRecord[]): ChannelPersistedBindingRecord | undefined {
  return [...bindings].sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))[0];
}

function isTerminalStatus(status: SessionRoute["notification"]["lastStatus"]): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

function bindingAddress(binding: ChannelBinding): ChannelRouteAddress {
  return { channel: DISCORD_CHANNEL, conversationId: binding.conversationId, userId: binding.userId };
}

function channelAlias(binding: ChannelBinding): string | undefined {
  const alias = binding.metadata?.alias;
  return typeof alias === "string" ? alias : undefined;
}

function channelProgressMode(binding: ChannelBinding): ProgressMode | undefined {
  const mode = binding.metadata?.progressMode;
  if (mode === "quiet" || mode === "normal" || mode === "verbose" || mode === "completionOnly") return mode;
  return undefined;
}

function discordTurnNotificationText(route: SessionRoute, status: "completed" | "failed" | "aborted"): string {
  if (status === "completed") {
    route.notification.lastSummary = summarizeTextDeterministically(route.notification.lastAssistantText ?? "Pi task completed.");
    const imageHint = route.notification.latestImages?.count
      ? `\n\n🖼 ${route.notification.latestImages.count} image output/file(s) available. Use /images when Discord image retrieval is enabled.`
      : "";
    return `${route.notification.lastSummary}${imageHint}`;
  }
  return route.notification.lastFailure ?? `Pi task ${status}.`;
}

function discordPairingFailureMessage(reason: string): string {
  switch (reason) {
    case "unsupported-conversation":
      return "Discord pairing must happen in a bot DM unless guild-channel control is explicitly enabled and allowed.";
    case "unauthorized":
      return "This Discord user or guild is not authorized for pairing.";
    case "command-mismatch":
      return `Pairing command mismatch. Send ${discordRelayPairingCommand("<pin>")} with the current PIN from Pi. ${discordPairingCommand("<pin>")} is also accepted.`;
    case "expired":
      return "This Discord pairing code is expired. Run /relay connect discord again in Pi.";
    default:
      return "Discord pairing failed. Run /relay connect discord again in Pi.";
  }
}

function safeDiscordRuntimeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw);
}
