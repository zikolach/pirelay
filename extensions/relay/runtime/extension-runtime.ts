import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Type, type ImageContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { loadTelegramTunnelConfig, ConfigError } from "../config/tunnel-config.js";
import { renderQrLines } from "../ui/qr.js";
import { RelaySetupWizardScreen } from "../ui/setup-wizard.js";
import { copyTextToClipboard } from "../ui/clipboard.js";
import { getOrCreateTunnelRuntime, sendSessionNotification } from "../adapters/telegram/runtime.js";
import { summarizeForTelegram } from "../adapters/telegram/summary.js";
import { TunnelStateStore } from "../state/tunnel-store.js";
import type { BindingEntryData, ChannelPersistedBindingRecord, DiscordRelayConfig, ImageFileLoadResult, LatestTurnImage, LatestTurnImageFileCandidate, PairingApprovalDecision, PersistedBindingRecord, RelayPairingIdentity, SessionRoute, SlackRelayConfig, TelegramBindingMetadata, TelegramTunnelConfig, TunnelRuntime } from "../core/types.js";
import { extractStructuredAnswerMetadata } from "../core/guided-answer.js";
import type { DiscordRuntime } from "../adapters/discord/runtime.js";
import type { SlackRuntime } from "../adapters/slack/runtime.js";
import { appendRecentActivity, COMPACTION_PROGRESS_COMPLETED_TEXT, COMPACTION_PROGRESS_STARTED_TEXT, createProgressActivity, recentActivityLimit } from "../notifications/progress.js";
import { createToolProgressAccumulator, type ToolProgressEventInput } from "../notifications/tool-progress.js";
import { authorityOutcomeAllowsDelivery, resolveChannelBindingAuthority, resolveTelegramBindingAuthority } from "../core/binding-authority.js";
import { formatRelayLifecycleNotification, type RelayLifecycleEventKind } from "../notifications/lifecycle.js";
import { formatRelayStatusLine, type RelayStatusLineBindingState, type RelayStatusLineChannel } from "./status-line.js";
import { collectRelaySetupFacts, completeRelayLocalCommand, discordBotChatUrl, parseRelayLocalCommand, redactSecrets, relayChannelReady, relayPairingInstruction, relaySetupDiagnostics, relaySetupFallbackGuidance, relaySetupGuidance, renderRelayDoctorReport, slackAppRedirectUrl, supportedRelayChannels, type RelaySetupChannel } from "../config/setup.js";
import { buildRelaySetupWizardModel, renderRelaySetupWizardFallback, slackAppManifestText, type RelaySetupWizardActionId } from "../config/setup-wizard.js";
import { computeRelaySetupConfigPatchFromEnv, envSnippetTextForSetupChannel, writeRelaySetupConfigFromEnv } from "../config/setup-env.js";
import { migrateRelayConfigPlan, planRelayConfigMigrationForEnv, type RelayConfigMigrationPlan } from "../config/migration.js";
import { createTurnId, deriveSessionLabel, extractImageContent, extractTextContent, getTelegramUserLabel, isAllowedImageMimeType, latestImageFileCandidatesFromText, latestImageFromContent, loadWorkspaceImageFile, sessionKeyOf, summarizeTextDeterministically, toIsoNow } from "../core/utils.js";
import { loadWorkspaceOutboundFile, type RelayOutboundFileKind } from "../core/file-delivery.js";
import { parseMessengerRef } from "../core/messenger-ref.js";
import { deliverWorkspaceFileToRequester, formatRequesterFileDeliveryResult, type RelayFileDeliveryRequester } from "../core/requester-file-delivery.js";
import { isStaleExtensionReferenceError, routeUnavailableError, unavailableRouteMessage } from "../core/route-actions.js";
import { activeSelectionsForSession, bindingSummariesForSession, createPendingSessionHandoff, findPendingSessionHandoff, listPendingSessionHandoffs, relayRuntimeInstanceId, registerPendingSessionHandoff, removePendingSessionHandoff, removePendingSessionHandoffsForSession, type PendingSessionHandoff, type SessionHandoffReason } from "../core/session-handoff.js";
import type { ChannelOutboundFile, ChannelRouteAddress } from "../core/channel-adapter.js";
import { TelegramChannelAdapter } from "../adapters/telegram/adapter.js";
import { DEFAULT_DISCORD_MAX_FILE_BYTES } from "../adapters/discord/adapter.js";
import { DEFAULT_SLACK_MAX_FILE_BYTES } from "../adapters/slack/adapter.js";
import { approvalAuditEvent, approvalButtons, classifyApprovalOperation, createApprovalGrant, createApprovalRequest, grantMatchesOperation, renderApprovalRequest, resolveApprovalGateConfig, type ApprovalDecisionRequest, type ApprovalDecisionResult, type ApprovalGateConfig, type ApprovalGrantRecord, type ApprovalOperation, type ApprovalRequestRecord, type ResolvedApprovalGateConfig } from "../core/approval-gates.js";
import { analyzeFinalAssistantExtraction, createCommunicationDiagnosticsLogger, type CommunicationDiagnosticEvent, type CommunicationDiagnosticsLogger } from "../diagnostics/communication.js";

const BINDING_ENTRY_TYPE = "relay-binding";
const LEGACY_BINDING_ENTRY_TYPE = "telegram-tunnel-binding";
const AUDIT_MESSAGE_TYPE = "relay-audit";
const CONNECT_WIDGET_KEY = "relay-connect";
const LIFECYCLE_NOTIFICATION_TIMEOUT_MS = 3_000;
const DEFAULT_TELEGRAM_LOCAL_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

function shortenMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
}

function withLifecycleNotificationTimeout(label: string, delivery: Promise<void>, timeoutMs = LIFECYCLE_NOTIFICATION_TIMEOUT_MS): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} lifecycle timed out`)), timeoutMs);
  });
  return Promise.race([delivery, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function wrapPlainText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  for (const sourceLine of text.split("\n")) {
    if (!sourceLine) {
      lines.push("");
      continue;
    }
    let remaining = sourceLine;
    while (visibleWidth(remaining) > maxWidth) {
      lines.push(remaining.slice(0, maxWidth));
      remaining = remaining.slice(maxWidth);
    }
    lines.push(remaining);
  }
  return lines;
}

interface PairingQrScreenOptions {
  command?: string;
  onCopyCommand?: (command: string) => void | Promise<void>;
}

class PairingQrScreen {
  constructor(
    private readonly theme: Theme,
    private readonly title: string,
    private readonly sessionLabel: string,
    private readonly qrLines: string[],
    private readonly link: string,
    private readonly expiryMinutes: number,
    private readonly instructions: string[],
    private readonly done: () => void,
    private readonly options: PairingQrScreenOptions = {},
  ) {}

  handleInput(data: string): void {
    if ((data === "c" || data === "C") && this.options.command && this.options.onCopyCommand) {
      const command = this.options.command;
      this.safeFireAndForget(() => this.options.onCopyCommand?.(command));
      return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c")) {
      this.done();
    }
  }

  invalidate(): void {}

  private safeFireAndForget(callback: () => void | Promise<void>): void {
    void Promise.resolve().then(callback).catch(() => undefined);
  }

  render(width: number): string[] {
    const outerWidth = Math.max(40, Math.min(width - 2, 88));
    const innerWidth = outerWidth - 2;
    const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const bottomBorder = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
    const pad = (text: string): string => {
      const visible = visibleWidth(text);
      return text + " ".repeat(Math.max(0, innerWidth - visible));
    };
    const row = (text = ""): string => `${this.theme.fg("border", "│")}${pad(text)}${this.theme.fg("border", "│")}`;
    const lines: string[] = [border];
    lines.push(row(this.theme.fg("accent", this.title)));
    lines.push(row(`Session: ${shortenMiddle(this.sessionLabel, Math.max(16, innerWidth - 9))}`));
    lines.push(row(`Expires in about ${this.expiryMinutes} minute(s).`));
    lines.push(row());

    for (const qrLine of this.qrLines) {
      lines.push(row(qrLine));
    }

    lines.push(row());
    lines.push(row("Link:"));
    for (const wrapped of wrapPlainText(this.link, innerWidth)) {
      lines.push(row(wrapped));
    }
    if (this.options.command) {
      lines.push(row());
      lines.push(row(this.theme.fg("accent", "Command to send:")));
      for (const wrapped of wrapPlainText(this.options.command, innerWidth)) {
        lines.push(row(this.theme.fg("accent", wrapped)));
      }
    }
    lines.push(row());
    for (const instruction of this.instructions) {
      for (const wrapped of wrapPlainText(instruction, innerWidth)) lines.push(row(this.theme.fg("dim", wrapped)));
    }
    lines.push(row(this.theme.fg("dim", this.options.command && this.options.onCopyCommand ? "c copy command · Press Esc or Enter when done." : "Press Esc or Enter when done.")));
    lines.push(bottomBorder);
    return lines;
  }
}

function getCommandHelp(): string {
  return [
    "Usage: /relay <subcommand>",
    "",
    "Subcommands:",
    "  setup [telegram|discord|slack]  Show channel setup guidance",
    "  connect [telegram|discord|slack] [name]  Create a channel pairing instruction",
    "  doctor      Diagnose configured relay channels",
    "  diagnostics Show local communication diagnostic log status",
    "  approvals   Show recent approval-gate audit events",
    "  send-file <telegram|discord|slack|messenger:instance|all> <relative-path> [caption]  Send a workspace file",
    "  restart     Restart relay runtimes and kill/restart the broker process",
    "  disconnect  Revoke relay bindings for this session",
    "  status      Show current local relay state",
    "  trusted     List locally trusted relay users",
    "  untrust <telegram|discord|slack> <userId>  Revoke local relay trust",
  ].join("\n");
}

export default function telegramTunnelExtension(pi: ExtensionAPI): void {
  let configCache: TelegramTunnelConfig | undefined;
  let runtime: TunnelRuntime | undefined;
  let telegramRuntimeStatus: { enabled: boolean; started: boolean; error?: string } | undefined;
  let latestCommandContext: ExtensionCommandContext | undefined;
  let completedHandoff: PendingSessionHandoff | undefined;
  const discordRuntimes = new Map<string, DiscordRuntime>();
  const slackRuntimes = new Map<string, SlackRuntime>();
  const volatileTelegramBindings = new Map<string, TelegramBindingMetadata>();
  const relayStatusDiagnostics = new Map<string, string>();
  let currentRoute: SessionRoute | undefined;
  let latestContext: ExtensionContext | undefined;
  let closeConnectQrScreen: (() => void) | undefined;
  let activeTurnImages: ImageContent[] = [];
  let activeTurnImagePathTexts: string[] = [];
  let activeTurnCompletedAssistantText: string | undefined;
  let latestTurnImages: LatestTurnImage[] = [];
  let latestTurnImageFileCandidates: LatestTurnImageFileCandidate[] = [];
  let progressSequence = 0;
  const toolProgress = createToolProgressAccumulator();
  const suppressedToolProgressIds = new Set<string>();
  const suppressedMissingToolProgress = new Map<string, number>();
  let diagnosticsLogger: CommunicationDiagnosticsLogger | undefined;
  const pendingApprovalResolvers = new Map<string, (result: ApprovalDecisionResult) => void>();

  function safeSessionKeyForContext(ctx: ExtensionContext): string | undefined {
    try {
      return sessionKeyOf(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return undefined;
      }
      throw error;
    }
  }

  function liveContextForRoute(route = currentRoute): ExtensionContext | undefined {
    const ctx = latestContext;
    if (!ctx || !route) return undefined;
    return safeSessionKeyForContext(ctx) === route.sessionKey ? ctx : undefined;
  }

  function invalidateLiveContextForRoute(route: SessionRoute): void {
    const ctx = liveContextForRoute(route);
    if (ctx && latestContext === ctx) latestContext = undefined;
  }

  function relayStatusIcon(ctx: ExtensionContext, text: string, tone: Parameters<Theme["fg"]>[0]): string {
    return ctx.ui.theme ? ctx.ui.theme.fg(tone, text) : text;
  }

  function safeSetStatus(key: string, value: string, ctx = latestContext): void {
    if (!ctx) return;
    try {
      ctx.ui.setStatus(key, value);
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return;
      }
      throw error;
    }
  }

  function safeNotifyLocal(message: string, level: "info" | "warning" | "error" = "info", route = currentRoute): void {
    const ctx = liveContextForRoute(route);
    if (!ctx) return;
    try {
      ctx.ui.notify(message, level);
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return;
      }
      throw error;
    }
  }

  function routeIsIdle(route: SessionRoute): boolean | undefined {
    const ctx = liveContextForRoute(route);
    if (!ctx) return undefined;
    try {
      return ctx.isIdle();
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return undefined;
      }
      throw error;
    }
  }

  function routeWorkspaceRoot(route: SessionRoute): string | undefined {
    const ctx = liveContextForRoute(route);
    if (!ctx) return undefined;
    try {
      return ctx.cwd;
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return undefined;
      }
      throw error;
    }
  }

  async function ensureConfig(ctx?: ExtensionContext, interactiveNotice = false): Promise<TelegramTunnelConfig> {
    if (configCache) return configCache;
    const { config, warnings } = await loadTelegramTunnelConfig();
    configCache = config;
    diagnosticsLogger = createCommunicationDiagnosticsLogger(config.communicationDiagnostics!);
    if (ctx && interactiveNotice) {
      for (const warning of warnings) {
        try {
          ctx.ui.notify(warning, "warning");
        } catch (error) {
          if (isStaleExtensionReferenceError(error)) {
            if (latestContext === ctx) latestContext = undefined;
            break;
          }
          throw error;
        }
      }
    }
    return config;
  }


  function recordDiagnostic(event: CommunicationDiagnosticEvent): void {
    if (!diagnosticsLogger?.config.enabled) return;
    void diagnosticsLogger.record(event);
  }

  function diagnosticRouteFields(route = currentRoute): Pick<CommunicationDiagnosticEvent, "sessionKey" | "sessionId" | "sessionLabel"> {
    return route ? { sessionKey: route.sessionKey, sessionId: route.sessionId, sessionLabel: route.sessionLabel } : {};
  }

  function diagnosticsStatusText(config: TelegramTunnelConfig): string {
    const logger = diagnosticsLogger ?? createCommunicationDiagnosticsLogger(config.communicationDiagnostics!);
    const status = logger.status();
    return [
      "PiRelay communication diagnostics",
      `Enabled: ${status.enabled ? "yes" : "no"}`,
      `Log path: ${status.logPath}`,
      `Retention: ${status.maxFiles} file(s) x ${status.maxFileBytes} bytes`,
      `Content previews: ${status.includeContentPreview ? "enabled" : "disabled"}`,
      status.latestWriteOk === undefined ? undefined : `Latest write: ${status.latestWriteOk ? "ok" : `failed (${status.latestWriteError ?? "unknown error"})`}`,
      status.enabled ? "Remote messenger commands do not automatically upload this log; share excerpts only after local review/redaction." : "Enable temporarily with communicationDiagnostics.enabled or PI_RELAY_COMMUNICATION_DIAGNOSTICS=1.",
    ].filter(Boolean).join("\n");
  }

  async function ensureRuntime(ctx?: ExtensionContext, interactiveNotice = false): Promise<TunnelRuntime> {
    if (runtime) return runtime;
    const config = await ensureConfig(ctx, interactiveNotice);
    runtime = getOrCreateTunnelRuntime(config);
    return runtime;
  }

  function discordInstanceIds(config: TelegramTunnelConfig): string[] {
    const ids = Object.entries(config.discordInstances ?? {})
      .filter(([, discord]) => discord.enabled && discord.botToken)
      .map(([instanceId]) => instanceId);
    if (ids.length === 0 && config.discord?.enabled && config.discord.botToken) return ["default"];
    return ids;
  }

  async function ensureDiscordRuntime(ctx?: ExtensionContext, interactiveNotice = false, instanceId = "default"): Promise<DiscordRuntime | undefined> {
    const existing = discordRuntimes.get(instanceId);
    if (existing) return existing;
    const config = await ensureConfig(ctx, interactiveNotice);
    const discordConfig = config.discordInstances?.[instanceId] ?? (instanceId === "default" ? config.discord : undefined);
    if (!discordConfig?.enabled || !discordConfig.botToken) return undefined;
    const { getOrCreateDiscordRuntime } = await import("../adapters/discord/runtime.js");
    const discord = getOrCreateDiscordRuntime(config, undefined, instanceId);
    if (discord) discordRuntimes.set(instanceId, discord);
    return discord;
  }

  async function ensureAllDiscordRuntimes(ctx?: ExtensionContext, interactiveNotice = false): Promise<DiscordRuntime[]> {
    const config = await ensureConfig(ctx, interactiveNotice);
    const runtimes: DiscordRuntime[] = [];
    for (const instanceId of discordInstanceIds(config)) {
      const runtime = await ensureDiscordRuntime(ctx, interactiveNotice, instanceId);
      if (runtime) runtimes.push(runtime);
    }
    return runtimes;
  }

  function slackInstanceIds(config: TelegramTunnelConfig): string[] {
    const ids = Object.entries(config.slackInstances ?? {})
      .filter(([, slack]) => slack.enabled && slack.botToken)
      .map(([instanceId]) => instanceId);
    if (ids.length === 0 && config.slack?.enabled && config.slack.botToken) return ["default"];
    return ids;
  }

  async function ensureSlackRuntime(ctx?: ExtensionContext, interactiveNotice = false, instanceId = "default"): Promise<SlackRuntime | undefined> {
    const existing = slackRuntimes.get(instanceId);
    if (existing) return existing;
    const config = await ensureConfig(ctx, interactiveNotice);
    const slackConfig = config.slackInstances?.[instanceId] ?? (instanceId === "default" ? config.slack : undefined);
    if (!slackConfig?.enabled || !slackConfig.botToken) return undefined;
    const { getOrCreateSlackRuntime } = await import("../adapters/slack/runtime.js");
    const slack = getOrCreateSlackRuntime(config, undefined, instanceId);
    if (slack) slackRuntimes.set(instanceId, slack);
    return slack;
  }

  async function ensureAllSlackRuntimes(ctx?: ExtensionContext, interactiveNotice = false): Promise<SlackRuntime[]> {
    const config = await ensureConfig(ctx, interactiveNotice);
    const runtimes: SlackRuntime[] = [];
    for (const instanceId of slackInstanceIds(config)) {
      const runtime = await ensureSlackRuntime(ctx, interactiveNotice, instanceId);
      if (runtime) runtimes.push(runtime);
    }
    return runtimes;
  }

  async function stopAndClearRuntimes(ctx: ExtensionContext, options: { restartBrokerProcess?: boolean } = {}): Promise<{ telegramStopped: boolean; discordStopped: string[]; slackStopped: string[]; brokerRestarted: boolean }> {
    resetToolProgress();
    let telegramStopped = false;
    let brokerRestarted = false;
    const discordStopped: string[] = [];
    const slackStopped: string[] = [];
    const failures: unknown[] = [];
    if (runtime) {
      try {
        if (options.restartBrokerProcess && runtime.restartBrokerProcess) {
          await runtime.restartBrokerProcess();
          brokerRestarted = true;
        } else {
          await runtime.stop();
        }
        runtime = undefined;
        telegramRuntimeStatus = { enabled: true, started: false };
        telegramStopped = true;
      } catch (error) {
        failures.push(error);
      }
    }
    for (const [instanceId, discord] of [...discordRuntimes]) {
      try {
        await discord.stop();
        discordRuntimes.delete(instanceId);
        discordStopped.push(instanceId);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const [instanceId, slack] of [...slackRuntimes]) {
      try {
        await slack.stop();
        slackRuntimes.delete(instanceId);
        slackStopped.push(instanceId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      const first = failures[0];
      const message = first instanceof Error ? first.message : String(first);
      ctx.ui.notify(`Stopped PiRelay runtimes with ${failures.length} warning(s): ${redactSecrets(message)}`, "warning");
    }
    return { telegramStopped, discordStopped, slackStopped, brokerRestarted };
  }

  function statusKeyForChannel(channel: RelayStatusLineChannel, instanceId = "default"): string {
    if (channel === "telegram") return "relay";
    const base = `${channel}-relay`;
    return instanceId === "default" ? base : `${base}:${instanceId}`;
  }

  function telegramStatusBinding(binding: PersistedBindingRecord | TelegramBindingMetadata | undefined): RelayStatusLineBindingState | undefined {
    if (!binding || "status" in binding && binding.status === "revoked") return undefined;
    return { paused: binding.paused, conversationKind: "private" };
  }

  function channelStatusBinding(binding: ChannelPersistedBindingRecord | undefined): RelayStatusLineBindingState | undefined {
    if (!binding || binding.status === "revoked") return undefined;
    const conversationKind = typeof binding.metadata?.conversationKind === "string" ? binding.metadata.conversationKind : undefined;
    return { paused: binding.paused, conversationKind };
  }

  async function currentStatusBinding(config: TelegramTunnelConfig, channel: RelayStatusLineChannel, instanceId = "default"): Promise<RelayStatusLineBindingState | undefined> {
    if (!currentRoute) return undefined;
    const store = new TunnelStateStore(config.stateDir);
    const snapshot = await store.loadBindingAuthoritySnapshot();
    if (channel === "telegram") {
      const routeBinding = currentRoute.binding ?? volatileTelegramBindings.get(currentRoute.sessionKey);
      if (snapshot.kind === "state-unavailable") return routeBinding ? telegramStatusBinding(routeBinding) : undefined;
      const outcome = resolveTelegramBindingAuthority(
        snapshot,
        { sessionKey: currentRoute.sessionKey, chatId: routeBinding?.chatId, userId: routeBinding?.userId, includePaused: true, allowVolatileFallback: true },
        routeBinding,
      );
      if (!authorityOutcomeAllowsDelivery(outcome)) return undefined;
      currentRoute.binding = outcome.binding;
      return telegramStatusBinding(outcome.binding);
    }
    const outcome = resolveChannelBindingAuthority(
      snapshot,
      { channel, sessionKey: currentRoute.sessionKey, instanceId, includePaused: true },
    );
    return authorityOutcomeAllowsDelivery(outcome) && "status" in outcome.binding ? channelStatusBinding(outcome.binding) : undefined;
  }

  async function setMessengerStatus(ctx: ExtensionContext, channel: RelayStatusLineChannel, state: Omit<Parameters<typeof formatRelayStatusLine>[0], "channel" | "binding"> & { binding?: RelayStatusLineBindingState }, instanceId = "default"): Promise<void> {
    const key = statusKeyForChannel(channel, instanceId);
    if (state.error) relayStatusDiagnostics.set(key, `${channel}${instanceId === "default" ? "" : `:${instanceId}`}: ${state.error}`);
    else relayStatusDiagnostics.delete(key);
    const colorize = ctx.ui.theme ? (tone: Parameters<Theme["fg"]>[0], text: string) => ctx.ui.theme.fg(tone, text) : undefined;
    safeSetStatus(key, formatRelayStatusLine({ channel, ...state }, { colorize }), ctx);
  }

  function clearStatus(key: string, ctx = latestContext): void {
    relayStatusDiagnostics.delete(key);
    safeSetStatus(key, "", ctx);
  }

  function discordStatusConfigured(config: DiscordRelayConfig | undefined): boolean {
    return Boolean(config?.enabled && config.botToken);
  }

  function slackStatusConfigured(config: SlackRelayConfig | undefined): boolean {
    if (!config?.enabled || !config.botToken || !config.signingSecret) return false;
    return (config.eventMode ?? "socket") === "webhook" || Boolean(config.appToken);
  }

  function statusConfiguredForChannel(config: TelegramTunnelConfig, channel: RelayStatusLineChannel, instanceId: string): boolean {
    if (channel === "telegram") return Boolean(config.botToken);
    if (channel === "discord") return discordStatusConfigured(config.discordInstances?.[instanceId] ?? (instanceId === "default" ? config.discord : undefined));
    return slackStatusConfigured(config.slackInstances?.[instanceId] ?? (instanceId === "default" ? config.slack : undefined));
  }

  async function refreshMessengerStatus(ctx: ExtensionContext, channel: RelayStatusLineChannel, runtimeStatus?: { enabled: boolean; started: boolean; error?: string }, instanceId = "default"): Promise<void> {
    const config = await ensureConfig(ctx, false);
    const configured = statusConfiguredForChannel(config, channel, instanceId);
    const binding = runtimeStatus?.error ? undefined : await currentStatusBinding(config, channel, instanceId);
    await setMessengerStatus(ctx, channel, {
      configured,
      runtimeStarted: channel === "telegram" ? Boolean(runtime) : runtimeStatus?.started,
      error: runtimeStatus?.error ? redactSecrets(runtimeStatus.error) : undefined,
      binding,
    }, instanceId);
  }

  async function refreshRelayStatuses(ctx: ExtensionContext): Promise<void> {
    await refreshMessengerStatus(ctx, "telegram", telegramRuntimeStatus);
    for (const [instanceId, discord] of discordRuntimes) await refreshMessengerStatus(ctx, "discord", discord.getStatus(), instanceId);
    for (const [instanceId, slack] of slackRuntimes) await refreshMessengerStatus(ctx, "slack", slack.getStatus(), instanceId);
  }

  async function resetStoppedRuntimeStatuses(ctx: ExtensionContext, stopped: { telegramStopped: boolean; discordStopped: string[]; slackStopped: string[] }): Promise<void> {
    const config = await ensureConfig(ctx, false);
    if (stopped.telegramStopped) await setMessengerStatus(ctx, "telegram", { configured: Boolean(config.botToken), runtimeStarted: false });
    for (const instanceId of stopped.discordStopped) {
      await setMessengerStatus(ctx, "discord", { configured: statusConfiguredForChannel(config, "discord", instanceId), runtimeStarted: false }, instanceId);
    }
    for (const instanceId of stopped.slackStopped) {
      await setMessengerStatus(ctx, "slack", { configured: statusConfiguredForChannel(config, "slack", instanceId), runtimeStarted: false }, instanceId);
    }
  }

  function refreshRelayStatusesSoon(ctx?: ExtensionContext): void {
    ctx ??= latestContext;
    if (!ctx || safeSessionKeyForContext(ctx) !== currentRoute?.sessionKey) return;
    void refreshRelayStatuses(ctx).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      safeSetStatus("relay-sync", `relay status error: ${redactSecrets(message)}`, ctx);
    });
  }

  async function startDiscordRuntime(ctx: ExtensionContext, discord: DiscordRuntime, failHard = false, instanceId = "default"): Promise<boolean> {
    if (discord.getStatus().started) {
      await refreshMessengerStatus(ctx, "discord", discord.getStatus(), instanceId);
      return true;
    }
    try {
      await discord.start();
      await refreshMessengerStatus(ctx, "discord", discord.getStatus(), instanceId);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const safeMessage = redactSecrets(message);
      await setMessengerStatus(ctx, "discord", { configured: true, runtimeStarted: false, error: safeMessage }, instanceId);
      if (failHard) throw new Error(`Discord runtime failed to start: ${safeMessage}`);
      return false;
    }
  }

  async function startSlackRuntime(ctx: ExtensionContext, slack: SlackRuntime, failHard = false, instanceId = "default"): Promise<boolean> {
    if (slack.getStatus().started) {
      await refreshMessengerStatus(ctx, "slack", slack.getStatus(), instanceId);
      return true;
    }
    try {
      await slack.start();
      const status = slack.getStatus();
      if (!status.started) {
        const safeMessage = redactSecrets(status.error || "Slack runtime did not start.");
        await setMessengerStatus(ctx, "slack", { configured: true, runtimeStarted: false, error: safeMessage }, instanceId);
        if (failHard) throw new Error(`Slack runtime failed to start: ${safeMessage}`);
        return false;
      }
      await refreshMessengerStatus(ctx, "slack", status, instanceId);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const safeMessage = redactSecrets(message);
      await setMessengerStatus(ctx, "slack", { configured: true, runtimeStarted: false, error: safeMessage }, instanceId);
      if (failHard) throw new Error(`Slack runtime failed to start: ${safeMessage}`);
      return false;
    }
  }

  function resetToolProgress(): void {
    toolProgress.reset();
    suppressedToolProgressIds.clear();
    suppressedMissingToolProgress.clear();
  }

  function missingToolProgressKey(toolName: unknown): string | undefined {
    const normalized = String(toolName ?? "").trim().toLowerCase();
    return normalized || undefined;
  }

  function suppressToolProgress(event: ToolProgressEventInput, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">): void {
    if (typeof event.toolCallId === "string" && event.toolCallId.trim()) {
      const stableId = event.toolCallId.trim();
      suppressedToolProgressIds.add(stableId);
      toolProgress.discard(stableId);
      return;
    }
    const key = missingToolProgressKey(event.toolName);
    if (!key) return;
    suppressedMissingToolProgress.set(key, (suppressedMissingToolProgress.get(key) ?? 0) + 1);
    toolProgress.discardMatching(event, config);
  }

  function isToolProgressSuppressed(toolCallId: unknown, toolName: unknown): boolean {
    if (typeof toolCallId === "string" && toolCallId.trim()) return suppressedToolProgressIds.has(toolCallId.trim());
    const key = missingToolProgressKey(toolName);
    return key !== undefined && (suppressedMissingToolProgress.get(key) ?? 0) > 0;
  }

  function consumeToolProgressSuppression(toolCallId: unknown, toolName: unknown): boolean {
    if (typeof toolCallId === "string" && toolCallId.trim()) return suppressedToolProgressIds.delete(toolCallId.trim());
    const key = missingToolProgressKey(toolName);
    if (!key) return false;
    const count = suppressedMissingToolProgress.get(key) ?? 0;
    if (count <= 0) return false;
    if (count === 1) suppressedMissingToolProgress.delete(key);
    else suppressedMissingToolProgress.set(key, count - 1);
    return true;
  }

  function clearTurnImageCaches(): void {
    activeTurnImages = [];
    activeTurnImagePathTexts = [];
    activeTurnCompletedAssistantText = undefined;
    latestTurnImages = [];
    latestTurnImageFileCandidates = [];
    resetToolProgress();
  }

  function appendAudit(message: string, route?: SessionRoute): void {
    const safe = summarizeTextDeterministically(message, 280);
    try {
      pi.sendMessage({ customType: AUDIT_MESSAGE_TYPE, content: safe, display: true });
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (route) invalidateLiveContextForRoute(route);
        else latestContext = undefined;
        return;
      }
      throw error;
    }
  }

  async function loadImagePathForTelegram(ctx: ExtensionContext, relativePath: string, turnId: string, index: number, route?: SessionRoute): Promise<ImageFileLoadResult> {
    const config = await ensureConfig();
    let workspaceRoot: string;
    try {
      workspaceRoot = ctx.cwd;
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (route) invalidateLiveContextForRoute(route);
        else if (latestContext === ctx) latestContext = undefined;
        return { ok: false, error: unavailableRouteMessage() };
      }
      throw error;
    }
    return loadWorkspaceImageFile(relativePath, {
      workspaceRoot,
      turnId,
      index,
      maxBytes: config.maxOutboundImageBytes,
      allowedMimeTypes: config.allowedImageMimeTypes,
    });
  }

  async function getLatestImagesForTelegram(route: SessionRoute): Promise<LatestTurnImage[]> {
    const ctx = liveContextForRoute(route);
    if (!ctx) return [];
    const images = [...latestTurnImages];
    const config = await ensureConfig();
    for (const candidate of latestTurnImageFileCandidates) {
      if (images.length >= config.maxLatestImages) break;
      const loaded = await loadImagePathForTelegram(ctx, candidate.path, candidate.turnId, images.length, route);
      if (loaded.ok) images.push(loaded.image);
    }
    return images;
  }

  function recordProgress(kind: "lifecycle" | "tool" | "assistant" | "status" | "compaction", text: string, detail?: string, options: { delivery?: "milestone" | "volatile"; semanticKey?: string } = {}): void {
    if (!currentRoute) return;
    const config = configCache;
    const entry = createProgressActivity({
      id: `${Date.now()}-${++progressSequence}`,
      kind,
      text,
      detail,
      delivery: options.delivery,
      semanticKey: options.semanticKey,
    }, config ?? { redactionPatterns: [], maxProgressMessageChars: undefined });
    if (!entry) return;
    currentRoute.notification.progressEvent = entry;
    appendRecentActivity(currentRoute.notification, entry, recentActivityLimit(config ?? {}));
    currentRoute.lastActivityAt = Date.now();
  }

  function recordToolProgressActivity(input: ToolProgressEventInput & { state: "active" | "completed" | "failed" }, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars" | "recentActivityLimit">): void {
    if (!currentRoute) return;
    if (input.state === "active") toolProgress.start(input, config);
    else toolProgress.finish({ ...input, failed: input.state === "failed" }, config);
    const entry = toolProgress.activity({ id: `${Date.now()}-${++progressSequence}`, at: input.at }, config);
    if (!entry) return;
    currentRoute.notification.progressEvent = entry;
    appendRecentActivity(currentRoute.notification, entry, recentActivityLimit(config));
    currentRoute.lastActivityAt = Date.now();
  }

  function optionalToolEventInput(event: unknown): unknown {
    if (!event || typeof event !== "object") return undefined;
    if ("input" in event) return (event as { input?: unknown }).input;
    if ("args" in event) return (event as { args?: unknown }).args;
    return undefined;
  }

  function persistBinding(binding: TelegramBindingMetadata | null, revoked = false, route?: SessionRoute): void {
    const data: BindingEntryData = {
      version: 1,
      binding: binding ?? undefined,
      revoked,
      revokedAt: revoked ? toIsoNow() : undefined,
    };
    try {
      pi.appendEntry<BindingEntryData>(BINDING_ENTRY_TYPE, data);
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (route) invalidateLiveContextForRoute(route);
        else latestContext = undefined;
        return;
      }
      throw error;
    }
    if (route) {
      if (revoked || !binding) volatileTelegramBindings.delete(route.sessionKey);
      else volatileTelegramBindings.set(route.sessionKey, binding);
    }
    if (route && currentRoute?.sessionKey === route.sessionKey) {
      currentRoute.binding = revoked ? undefined : binding ?? undefined;
    }
    const live = liveContextForRoute(route);
    if (live) refreshRelayStatusesSoon(live);
  }

  function channelLabel(channel: string): string {
    switch (channel) {
      case "telegram":
        return "Telegram";
      case "discord":
        return "Discord";
      case "slack":
        return "Slack";
      default:
        return channel.charAt(0).toUpperCase() + channel.slice(1);
    }
  }

  function pairingIdentityLabel(identity: RelayPairingIdentity): string {
    if ("id" in identity) return identity.displayName ?? getTelegramUserLabel(identity);
    return identity.displayName ?? identity.username ?? identity.userId;
  }

  function pairingIdentityUserId(identity: RelayPairingIdentity): string {
    return "id" in identity ? String(identity.id) : identity.userId;
  }

  async function promptPairingApproval(ctx: ExtensionContext, identity: RelayPairingIdentity, sessionLabel: string): Promise<PairingApprovalDecision> {
    closeConnectQrScreen?.();
    closeConnectQrScreen = undefined;
    if (!ctx.hasUI) return "deny";
    const channel = identity.channel ?? "telegram";
    const label = pairingIdentityLabel(identity);
    const userId = pairingIdentityUserId(identity);
    const details = [
      `Allow ${label} to control ${sessionLabel}?`,
      `Messenger: ${channel}`,
      `User ID: ${userId}`,
      identity.conversationKind ? `Conversation: ${identity.conversationKind}` : undefined,
    ].filter(Boolean).join("\n");
    const approved = await ctx.ui.confirm(`${channelLabel(channel)} Pairing Request`, details);
    if (!approved) return "deny";
    const trust = await ctx.ui.confirm("Trust relay user?", `Trust ${label} (${channel} ${userId}) so future fresh pairing codes can skip local confirmation on this machine?`);
    return trust ? "trust" : "allow";
  }

  function approvalConfig(config: TelegramTunnelConfig | undefined = configCache): ResolvedApprovalGateConfig {
    return resolveApprovalGateConfig(config?.approvalGates as ApprovalGateConfig | undefined);
  }

  function approvalStore(config: TelegramTunnelConfig | undefined = configCache): TunnelStateStore | undefined {
    return config ? new TunnelStateStore(config.stateDir) : undefined;
  }

  async function appendApprovalAudit(config: TelegramTunnelConfig, event: Parameters<typeof approvalAuditEvent>[0]): Promise<void> {
    const resolved = approvalConfig(config);
    await new TunnelStateStore(config.stateDir).appendApprovalAudit(approvalAuditEvent(event), { maxAuditEntries: resolved.maxAuditEvents });
  }

  async function findMatchingApprovalGrant(route: SessionRoute, requester: NonNullable<SessionRoute["remoteRequester"]>, operation: ApprovalOperation, config: TelegramTunnelConfig): Promise<ApprovalGrantRecord | undefined> {
    const store = new TunnelStateStore(config.stateDir);
    const grants = await store.listApprovalGrants();
    return grants.find((grant) => grantMatchesOperation(grant, { route, requester, operation }));
  }

  async function sendApprovalRequest(record: ApprovalRequestRecord, config: TelegramTunnelConfig): Promise<void> {
    const requester = record.requester;
    const text = renderApprovalRequest(record, approvalConfig(config));
    if (requester.channel === "telegram") {
      const adapter = new TelegramChannelAdapter(config);
      await adapter.sendText({ channel: "telegram", conversationId: requester.conversationId, userId: requester.userId }, text, {
        buttons: approvalButtonsForConfig(record, config),
      });
      return;
    }
    if (requester.channel === "discord") {
      const discord = discordRuntimes.get(requester.instanceId) as unknown as { sendApprovalRequestToRequester?: (requester: NonNullable<SessionRoute["remoteRequester"]>, text: string, buttons: ReturnType<typeof approvalButtonsForConfig>) => Promise<void> } | undefined;
      if (!discord?.sendApprovalRequestToRequester) throw new Error("Discord approval delivery is not available for this instance.");
      await discord.sendApprovalRequestToRequester(requester, text, approvalButtonsForConfig(record, config));
      return;
    }
    if (requester.channel === "slack") {
      const slack = slackRuntimes.get(requester.instanceId) as unknown as { sendApprovalRequestToRequester?: (requester: NonNullable<SessionRoute["remoteRequester"]>, text: string, buttons: ReturnType<typeof approvalButtonsForConfig>) => Promise<void> } | undefined;
      if (!slack?.sendApprovalRequestToRequester) throw new Error("Slack approval delivery is not available for this instance.");
      await slack.sendApprovalRequestToRequester(requester, text, approvalButtonsForConfig(record, config));
      return;
    }
    throw new Error(`Approval delivery is not supported for ${requester.channel}.`);
  }

  function approvalButtonsForConfig(record: ApprovalRequestRecord, config: TelegramTunnelConfig): ReturnType<typeof approvalButtons> {
    return approvalButtons(record, approvalConfig(config));
  }

  async function awaitApprovalDecision(record: ApprovalRequestRecord, timeoutMs: number): Promise<ApprovalDecisionResult> {
    const timeout = new Promise<ApprovalDecisionResult>((resolve) => {
      const timer = setTimeout(() => {
        pendingApprovalResolvers.delete(record.approvalId);
        resolve({ ok: false, status: "expired", message: "Approval expired; operation blocked." });
      }, timeoutMs);
      pendingApprovalResolvers.set(record.approvalId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
    return timeout;
  }

  async function resolveApprovalDecision(route: SessionRoute, decision: ApprovalDecisionRequest): Promise<ApprovalDecisionResult> {
    const config = configCache;
    const store = approvalStore(config);
    if (!route || !config || !store) return { ok: false, status: "stale", message: "Approval target is offline or stale." };
    const request = await store.getApprovalRequest(decision.approvalId);
    if (!request || request.sessionKey !== route.sessionKey) return { ok: false, status: "stale", message: "Approval request is stale." };
    if (request.status !== "pending") return { ok: false, status: request.status === "denied" ? "denied" : request.status === "approved" ? "approved" : "stale", message: "Approval request is no longer pending." };
    if (Date.parse(request.expiresAt) <= Date.now()) {
      await store.updateApprovalRequest(request.approvalId, (current) => ({ ...current, status: "expired", resolvedAt: toIsoNow(), decision: "deny" }));
      await appendApprovalAudit(config, { kind: "expired", approvalId: request.approvalId, sessionKey: request.sessionKey, sessionLabel: request.sessionLabel, toolName: request.toolName, category: request.category, matcherFingerprint: request.matcherFingerprint, requester: request.requester, summary: request.safeSummary, expiresAt: request.expiresAt });
      return { ok: false, status: "expired", message: "Approval request expired." };
    }
    if (!requesterMatchesDecision(request, decision)) return { ok: false, status: "unauthorized", message: "This identity cannot approve that operation." };
    const active = await approvalRequesterBindingIsActive(route, request.requester, store);
    if (!active) return { ok: false, status: "unauthorized", message: "Approval binding is no longer active." };

    if (decision.decision === "deny") {
      await store.updateApprovalRequest(request.approvalId, (current) => ({ ...current, status: "denied", resolvedAt: toIsoNow(), resolvedBy: decision.userId, decision: decision.decision }));
      await appendApprovalAudit(config, { kind: "denied", approvalId: request.approvalId, sessionKey: request.sessionKey, sessionLabel: request.sessionLabel, toolName: request.toolName, category: request.category, matcherFingerprint: request.matcherFingerprint, requester: request.requester, summary: request.safeSummary });
      const result = { ok: false, status: "denied" as const, message: "Approval denied; operation blocked." };
      pendingApprovalResolvers.get(request.approvalId)?.(result);
      pendingApprovalResolvers.delete(request.approvalId);
      return result;
    }

    const resolved = approvalConfig(config);
    const statusMessage = decision.decision === "approve-session" ? "Approved for this session." : decision.decision === "approve-persistent" ? "Persistent approval granted." : "Approved once.";
    if (decision.decision === "approve-session" || decision.decision === "approve-persistent") {
      const scope = decision.decision === "approve-session" ? "session" : "persistent";
      if (scope === "persistent" && !resolved.allowRemotePersistentGrants) return { ok: false, status: "unauthorized", message: "Remote persistent grants are disabled." };
      if (scope === "session" && !resolved.sessionGrants) return { ok: false, status: "unauthorized", message: "Session grants are disabled." };
      const grant = createApprovalGrant({ scope, record: request, createdBy: decision.userId, ttlMs: scope === "session" ? resolved.sessionGrantTtlMs : resolved.persistentGrantTtlMs });
      await store.upsertApprovalGrant(grant);
      await appendApprovalAudit(config, { kind: scope === "session" ? "approved-for-session" : "persistent-grant-created", approvalId: request.approvalId, grantId: grant.grantId, sessionKey: request.sessionKey, sessionLabel: request.sessionLabel, toolName: request.toolName, category: request.category, matcherFingerprint: request.matcherFingerprint, requester: request.requester, summary: request.safeSummary, expiresAt: grant.expiresAt });
    } else {
      await appendApprovalAudit(config, { kind: "approved-once", approvalId: request.approvalId, sessionKey: request.sessionKey, sessionLabel: request.sessionLabel, toolName: request.toolName, category: request.category, matcherFingerprint: request.matcherFingerprint, requester: request.requester, summary: request.safeSummary });
    }
    await store.updateApprovalRequest(request.approvalId, (current) => ({ ...current, status: "approved", resolvedAt: toIsoNow(), resolvedBy: decision.userId, decision: decision.decision }));
    const result = { ok: true, status: "approved" as const, message: statusMessage };
    pendingApprovalResolvers.get(request.approvalId)?.(result);
    pendingApprovalResolvers.delete(request.approvalId);
    return result;
  }

  function requesterMatchesDecision(request: ApprovalRequestRecord, decision: ApprovalDecisionRequest): boolean {
    return request.requester.channel === decision.channel
      && request.requester.instanceId === (decision.instanceId ?? "default")
      && request.requester.conversationId === decision.conversationId
      && request.requester.userId === decision.userId
      && (request.requester.threadId ?? "") === (decision.threadId ?? "");
  }

  async function approvalRequesterBindingIsActive(route: SessionRoute, requester: NonNullable<SessionRoute["remoteRequester"]>, store: TunnelStateStore): Promise<boolean> {
    if (requester.channel === "telegram") {
      const binding = await store.getActiveBindingForSession(route.sessionKey, { chatId: Number(requester.conversationId), userId: Number(requester.userId) });
      return Boolean(binding && !binding.paused);
    }
    const binding = await store.getActiveChannelBindingForSession(requester.channel, route.sessionKey, { instanceId: requester.instanceId, conversationId: requester.conversationId, userId: requester.userId });
    return Boolean(binding && !binding.paused);
  }

  function attachCommandContextToRoute(ctx: ExtensionCommandContext, route = currentRoute): void {
    if (!route) return;
    try {
      if (safeSessionKeyForContext(ctx) !== route.sessionKey || ctx.cwd !== route.actions.getWorkspaceRoot?.()) return;
    } catch {
      return;
    }
    latestCommandContext = ctx;
    route.actions.newSession = async (requester) => {
      const commandContext = latestCommandContext;
      if (commandContext !== ctx) throw routeUnavailableError();
      const handoff = await preparePendingHandoff(route, requester ? "remote-new" : "local-new", requester);
      if (requester && !handoff) throw routeUnavailableError("The selected relay binding is no longer active. Use /sessions to choose an online session.");
      const parentSession = route.sessionFile;
      try {
        const result = await commandContext.newSession({
          ...(parentSession ? { parentSession } : {}),
          withSession: async (replacementContext) => {
            latestContext = replacementContext;
            attachCommandContextToRoute(replacementContext);
          },
        });
        if (result.cancelled && handoff) removePendingSessionHandoffsForSession(route.sessionKey);
        return { cancelled: result.cancelled };
      } catch (error) {
        if (handoff) removePendingSessionHandoffsForSession(route.sessionKey);
        throw error;
      }
    };
  }

  function buildRoute(ctx: ExtensionContext, binding?: TelegramBindingMetadata, explicitLabel?: string): SessionRoute {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionLabel = binding?.sessionLabel ?? deriveSessionLabel({
      explicitLabel,
      sessionName: ctx.sessionManager.getSessionName(),
      cwd: ctx.cwd,
      sessionFile,
      sessionId,
    });
    const route: SessionRoute = {
      sessionKey: sessionKeyOf(sessionId, sessionFile),
      sessionId,
      sessionFile,
      sessionLabel,
      binding,
      lastActivityAt: Date.now(),
      notification: { lastStatus: "idle" },
      actions: {
        context: ctx,
        isIdle: () => routeIsIdle(route),
        getWorkspaceRoot: () => routeWorkspaceRoot(route),
        getModel: () => {
          const live = liveContextForRoute(route);
          try {
            return live?.model;
          } catch (error) {
            if (isStaleExtensionReferenceError(error)) {
              invalidateLiveContextForRoute(route);
              return undefined;
            }
            throw error;
          }
        },
        summarizeText: async (text, mode) => summarizeForTelegram(text, mode, liveContextForRoute(route), () => invalidateLiveContextForRoute(route)),
        sendUserMessage: (text, options) => {
          const requester = route.remoteRequester;
          if (!liveContextForRoute(route)) {
            route.remoteRequesterPendingTurn = false;
            route.remoteRequesterActiveTurn = false;
            if (requester && route.remoteRequester === requester) route.remoteRequester = undefined;
            throw routeUnavailableError();
          }
          try {
            pi.sendUserMessage(text, options);
          } catch (error) {
            route.remoteRequesterPendingTurn = false;
            route.remoteRequesterActiveTurn = false;
            if (requester && route.remoteRequester === requester) route.remoteRequester = undefined;
            if (isStaleExtensionReferenceError(error)) {
              invalidateLiveContextForRoute(route);
              throw routeUnavailableError();
            }
            throw error;
          }
          if (requester) route.remoteRequesterPendingTurn = true;
        },
        getLatestImages: () => getLatestImagesForTelegram(route),
        getImageByPath: async (relativePath) => {
          const live = liveContextForRoute(route);
          if (!live) return { ok: false, error: unavailableRouteMessage() };
          const turnId = route.notification.lastTurnId ?? createTurnId();
          return loadImagePathForTelegram(live, relativePath, turnId, 0, route);
        },
        getSkillCommands: () => {
          const live = liveContextForRoute(route);
          if (!live) return [];
          try {
            return pi.getCommands().filter((command) => command.source === "skill");
          } catch (error) {
            if (isStaleExtensionReferenceError(error)) {
              invalidateLiveContextForRoute(route);
              return [];
            }
            throw error;
          }
        },
        appendAudit: (message) => appendAudit(message, route),
        notifyLocal: (message, level = "info") => {
          const live = liveContextForRoute(route);
          if (!live) return;
          closeConnectQrScreen?.();
          closeConnectQrScreen = undefined;
          safeNotifyLocal(message, level, route);
          refreshRelayStatusesSoon(live);
        },
        setLocalStatus: (key, value) => {
          const live = liveContextForRoute(route);
          if (!live) return;
          if (key === "relay-binding-authority") {
            relayStatusDiagnostics.set(key, value);
            safeSetStatus(key, relayStatusIcon(live, "relay ⚠", "warning"), live);
            return;
          }
          safeSetStatus(key, value, live);
        },
        clearLocalStatus: (key) => {
          const live = liveContextForRoute(route);
          if (!live) return;
          clearStatus(key, live);
        },
        refreshLocalStatus: () => {
          const live = liveContextForRoute(route);
          if (!live) return;
          refreshRelayStatusesSoon(live);
        },
        persistBinding: (binding, revoked) => persistBinding(binding, revoked, route),
        promptLocalConfirmation: async (identity) => {
          const live = liveContextForRoute(route);
          if (!live) return "deny";
          try {
            return await promptPairingApproval(live, identity, route.sessionLabel);
          } catch (error) {
            if (isStaleExtensionReferenceError(error)) {
              invalidateLiveContextForRoute(route);
              return "deny";
            }
            throw error;
          }
        },
        abort: () => {
          const live = liveContextForRoute(route);
          if (!live) throw routeUnavailableError();
          try {
            live.abort();
          } catch (error) {
            if (isStaleExtensionReferenceError(error)) {
              invalidateLiveContextForRoute(route);
              throw routeUnavailableError();
            }
            throw error;
          }
        },
        resolveApprovalDecision: (decision) => resolveApprovalDecision(route, decision),
        compact: () =>
          new Promise<void>((resolve, reject) => {
            const live = liveContextForRoute(route);
            if (!live) {
              reject(routeUnavailableError());
              return;
            }
            try {
              live.compact({
                onComplete: () => resolve(),
                onError: (error) => {
                  if (isStaleExtensionReferenceError(error)) {
                    invalidateLiveContextForRoute(route);
                    reject(routeUnavailableError());
                    return;
                  }
                  reject(error);
                },
              });
            } catch (error) {
              if (isStaleExtensionReferenceError(error)) {
                invalidateLiveContextForRoute(route);
                reject(routeUnavailableError());
                return;
              }
              reject(error);
            }
          }),
      },
    };
    if (latestCommandContext) attachCommandContextToRoute(latestCommandContext, route);
    return route;
  }

  async function publishRouteState(): Promise<void> {
    const route = currentRoute;
    if (!route) return;
    const registrations: Array<Promise<void>> = [];
    if (runtime) registrations.push(runtime.registerRoute(route));
    registrations.push(...[...discordRuntimes.values()].map((discord) => discord.registerRoute(route)));
    registrations.push(...[...slackRuntimes.values()].map((slack) => slack.registerRoute(route)));
    await Promise.all(registrations);
    const live = liveContextForRoute(route);
    if (live) clearStatus("relay-sync", live);
    if (live) await refreshRelayStatuses(live).catch((error) => {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === live) latestContext = undefined;
        return;
      }
      throw error;
    });
  }

  function publishRouteStateSoon(): void {
    void publishRouteState().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      safeSetStatus("relay-sync", `telegram sync error: ${redactSecrets(message)}`);
    });
  }

  async function notifyTelegramLifecycle(config: TelegramTunnelConfig, route: SessionRoute, kind: RelayLifecycleEventKind): Promise<void> {
    if (!runtime || !route.binding) return;
    const store = new TunnelStateStore(config.stateDir);
    const outcome = resolveTelegramBindingAuthority(
      await store.loadBindingAuthoritySnapshot(),
      { sessionKey: route.sessionKey, chatId: route.binding.chatId, userId: route.binding.userId, includePaused: true, allowVolatileFallback: true },
      route.binding,
    );
    const binding = authorityOutcomeAllowsDelivery(outcome) ? outcome.binding : undefined;
    if (!binding || binding.paused) return;
    const decision = await store.recordLifecycleNotification({
      channel: "telegram",
      instanceId: "default",
      sessionKey: route.sessionKey,
      conversationId: String(binding.chatId),
      userId: String(binding.userId),
      kind,
    });
    if (!decision.shouldNotify) return;
    await runtime.sendToBoundChat(route.sessionKey, formatRelayLifecycleNotification({ kind, sessionLabel: route.sessionLabel, channel: "telegram" }));
    await store.markLifecycleNotificationDelivered({
      channel: "telegram",
      instanceId: "default",
      sessionKey: route.sessionKey,
      conversationId: String(binding.chatId),
      userId: String(binding.userId),
      kind,
    });
  }

  async function notifyRelayLifecycle(ctx: ExtensionContext, kind: RelayLifecycleEventKind, route = currentRoute, onlyStarted?: { telegram?: boolean; discordInstances?: Set<string>; slackInstances?: Set<string> }): Promise<void> {
    if (!route) return;
    let config: TelegramTunnelConfig;
    try {
      config = await ensureConfig(ctx, false);
    } catch {
      return;
    }
    const deliveries: Array<{ label: string; delivery: Promise<void> | undefined }> = [];
    if (onlyStarted?.telegram ?? true) deliveries.push({ label: "telegram", delivery: notifyTelegramLifecycle(config, route, kind) });
    for (const [instanceId, discord] of discordRuntimes) {
      if (onlyStarted?.discordInstances && !onlyStarted.discordInstances.has(instanceId)) continue;
      deliveries.push({ label: instanceId === "default" ? "discord" : `discord:${instanceId}`, delivery: discord.notifyLifecycle?.(route, kind) });
    }
    for (const [instanceId, slack] of slackRuntimes) {
      if (onlyStarted?.slackInstances && !onlyStarted.slackInstances.has(instanceId)) continue;
      deliveries.push({ label: instanceId === "default" ? "slack" : `slack:${instanceId}`, delivery: slack.notifyLifecycle?.(route, kind) });
    }
    const results = await Promise.allSettled(deliveries.filter((item): item is { label: string; delivery: Promise<void> } => Boolean(item.delivery)).map((item) => withLifecycleNotificationTimeout(item.label, item.delivery)));
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) {
      const message = redactSecrets(rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason));
      relayStatusDiagnostics.set("relay-lifecycle", `lifecycle: ${message}`);
      safeSetStatus("relay-lifecycle", relayStatusIcon(ctx, "relay ⚠", "warning"), ctx);
    } else {
      clearStatus("relay-lifecycle", ctx);
    }
  }

  async function restoreBinding(ctx: ExtensionContext, config: TelegramTunnelConfig, preferPersisted = false): Promise<TelegramBindingMetadata | undefined> {
    if (preferPersisted) {
      const sessionKey = sessionKeyOf(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
      const migrated = await new TunnelStateStore(config.stateDir).getBindingBySessionKey(sessionKey);
      if (migrated?.status === "active") {
        volatileTelegramBindings.set(sessionKey, migrated);
        return migrated;
      }
    }
    let latest: BindingEntryData | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && (entry.customType === BINDING_ENTRY_TYPE || entry.customType === LEGACY_BINDING_ENTRY_TYPE)) {
        latest = entry.data as BindingEntryData;
      }
    }
    const sessionKey = sessionKeyOf(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
    if (latest?.revoked) {
      volatileTelegramBindings.delete(sessionKey);
      return undefined;
    }
    if (latest?.binding) {
      volatileTelegramBindings.set(sessionKey, latest.binding);
      return latest.binding;
    }
    const volatile = volatileTelegramBindings.get(sessionKey);
    if (volatile) return volatile;

    const store = new TunnelStateStore(config.stateDir);
    const localBinding = await store.getBindingBySessionKey(sessionKey);
    if (!localBinding || localBinding.status === "revoked") return undefined;
    return localBinding;
  }

  async function preparePendingHandoff(route: SessionRoute, reason: SessionHandoffReason, remoteRequester?: RelayFileDeliveryRequester): Promise<PendingSessionHandoff | undefined> {
    const config = configCache;
    if (!config) return undefined;
    const data = await new TunnelStateStore(config.stateDir).load();
    const bindings = bindingSummariesForSession(data, route.sessionKey);
    if (bindings.length === 0) return undefined;
    const requester = reason === "remote-new" && remoteRequester
      ? bindings.find((binding) => binding.channel === remoteRequester.channel
        && binding.instanceId === remoteRequester.instanceId
        && binding.conversationId === remoteRequester.conversationId
        && binding.userId === remoteRequester.userId)
      : undefined;
    if (reason === "remote-new" && !requester) return undefined;
    const handoff = createPendingSessionHandoff({
      oldSessionKey: route.sessionKey,
      oldSessionId: route.sessionId,
      oldSessionFile: route.sessionFile,
      oldSessionLabel: route.sessionLabel,
      runtimeInstanceId: relayRuntimeInstanceId,
      machineId: config.machineId ?? "local",
      workspaceRoot: route.actions.getWorkspaceRoot?.() ?? route.actions.context.cwd,
      reason,
      requester,
      bindings,
      activeSelections: activeSelectionsForSession(data, route.sessionKey),
    });
    registerPendingSessionHandoff(handoff, async () => {
      const deliveries: Array<Promise<void> | undefined> = [notifyTelegramLifecycle(config, route, "offline")];
      for (const discord of discordRuntimes.values()) deliveries.push(discord.notifyLifecycle?.(route, "offline"));
      for (const slack of slackRuntimes.values()) deliveries.push(slack.notifyLifecycle?.(route, "offline"));
      await Promise.allSettled(deliveries.filter((delivery): delivery is Promise<void> => Boolean(delivery)));
    });
    return handoff;
  }

  async function syncRoute(ctx: ExtensionContext): Promise<void> {
    latestContext = ctx;
    let config: TelegramTunnelConfig;
    try {
      config = await ensureConfig();
    } catch (error) {
      currentRoute = undefined;
      const message = error instanceof Error ? error.message : String(error);
      safeSetStatus("relay", `relay config error: ${redactSecrets(message)}`, ctx);
      return;
    }

    const nextSessionId = ctx.sessionManager.getSessionId();
    const nextSessionFile = ctx.sessionManager.getSessionFile();
    const nextSessionKey = sessionKeyOf(nextSessionId, nextSessionFile);
    const handoffMatch = findPendingSessionHandoff({
      sessionKey: nextSessionKey,
      runtimeInstanceId: relayRuntimeInstanceId,
      machineId: config.machineId ?? "local",
      workspaceRoot: ctx.cwd,
    });
    completedHandoff = undefined;
    if (handoffMatch.kind === "matched") {
      const previewRoute = buildRoute(ctx);
      const migration = await new TunnelStateStore(config.stateDir).migrateSessionBindings({
        oldSessionKey: handoffMatch.handoff.oldSessionKey,
        newSessionKey: nextSessionKey,
        newSessionId: nextSessionId,
        newSessionFile: nextSessionFile,
        newSessionLabel: previewRoute.sessionLabel,
        requester: handoffMatch.handoff.reason === "remote-new" && handoffMatch.handoff.requester
          ? handoffMatch.handoff.requester
          : undefined,
      });
      if (migration.telegram.length > 0 || migration.channels.length > 0) {
        removePendingSessionHandoff(handoffMatch.handoff.id);
        completedHandoff = handoffMatch.handoff;
      }
    }

    const restoredBinding = await restoreBinding(ctx, config, Boolean(completedHandoff));
    const previousSessionKey = currentRoute?.sessionKey;
    const nextRoute = buildRoute(ctx, restoredBinding);
    if (nextRoute.sessionKey !== previousSessionKey) clearTurnImageCaches();
    currentRoute = nextRoute;
    const startedDiscordInstances = new Set<string>();
    const startedSlackInstances = new Set<string>();
    await ensureAllDiscordRuntimes();
    for (const [instanceId, discord] of discordRuntimes) {
      await discord.registerRoute(currentRoute);
      if (await startDiscordRuntime(ctx, discord, false, instanceId)) startedDiscordInstances.add(instanceId);
    }
    await ensureAllSlackRuntimes();
    for (const [instanceId, slack] of slackRuntimes) {
      await slack.registerRoute(currentRoute);
      if (await startSlackRuntime(ctx, slack, false, instanceId)) startedSlackInstances.add(instanceId);
    }
    let telegramStarted = false;
    try {
      runtime = await ensureRuntime();
      await runtime.registerRoute(currentRoute);
      telegramRuntimeStatus = { enabled: Boolean(config.botToken), started: true };
      telegramStarted = true;
      clearStatus("relay-sync", ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      telegramRuntimeStatus = { enabled: Boolean(config.botToken), started: false, error: message };
      safeSetStatus("relay-sync", `telegram sync error: ${redactSecrets(message)}`, ctx);
    }
    await refreshRelayStatuses(ctx).catch((error) => {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return;
      }
      throw error;
    });
    await notifyRelayLifecycle(ctx, completedHandoff ? "moved" : "online", currentRoute, { telegram: telegramStarted, discordInstances: startedDiscordInstances, slackInstances: startedSlackInstances });
  }

  async function handleSetup(ctx: ExtensionContext): Promise<void> {
    const tunnelRuntime = await ensureRuntime(ctx, true);
    const setup = await tunnelRuntime.ensureSetup();
    await tunnelRuntime.start();
    telegramRuntimeStatus = { enabled: true, started: true };
    ctx.ui.notify(`Telegram bot ready: @${setup.botUsername} (${setup.botDisplayName})`, "info");
  }

  async function handleRelaySetup(ctx: ExtensionContext, channel: RelaySetupChannel): Promise<void> {
    try {
      if (channel === "telegram") {
        await handleSetup(ctx);
      }
      const config = await ensureConfig(ctx, true);
      const facts = await collectRelaySetupFacts(config);
      const allFindings = relaySetupDiagnostics(config, facts);
      const findings = allFindings.filter((finding) => finding.channel === channel || finding.channel === "all");
      const model = buildRelaySetupWizardModel(channel, config, { facts, findings: allFindings });
      if (ctx.hasUI) {
        let action: RelaySetupWizardActionId | undefined;
        try {
          action = await ctx.ui.custom<RelaySetupWizardActionId | undefined>((_tui, theme, _keybindings, done) => new RelaySetupWizardScreen(model, theme, done, {
            onCopyEnvSnippet: async () => {
              try {
                await handleRelaySetupWizardAction(ctx, channel, config, "copy-env-snippet");
              } catch (copyError) {
                const safeMessage = copyError instanceof Error ? copyError.message : String(copyError);
                ctx.ui.notify(redactSecrets(`Unable to copy setup env snippet: ${safeMessage}`), "warning");
              }
            },
            onCopySlackManifest: async () => {
              try {
                await handleRelaySetupWizardAction(ctx, channel, config, "copy-slack-manifest");
              } catch (copyError) {
                const safeMessage = copyError instanceof Error ? copyError.message : String(copyError);
                ctx.ui.notify(redactSecrets(`Unable to copy Slack app manifest: ${safeMessage}`), "warning");
              }
            },
          }));
        } catch (wizardError) {
          const safeMessage = wizardError instanceof Error ? wizardError.message : String(wizardError);
          ctx.ui.notify(redactSecrets(`Interactive setup wizard failed: ${safeMessage}. Showing plain setup guidance instead.`), "warning");
          ctx.ui.notify(renderRelaySetupWizardFallback(model, config), findings.some((finding) => finding.severity === "error") ? "warning" : "info");
          return;
        }
        if (action) await handleRelaySetupWizardAction(ctx, channel, config, action);
        return;
      }
      const lines = [relaySetupGuidance(channel, config), "", "Env snippet:", envSnippetTextForSetupChannel(channel).trimEnd()];
      if (findings.length > 0) {
        lines.push("", "Diagnostics:", ...findings.map((finding) => `- ${finding.severity}: ${finding.message}`));
      }
      ctx.ui.notify(redactSecrets(lines.join("\n")), findings.some((finding) => finding.severity === "error") ? "warning" : "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(redactSecrets([relaySetupFallbackGuidance(channel), "", `Config issue: ${message}`].join("\n")), "warning");
    }
  }

  async function copyPairingCommandToClipboard(ctx: ExtensionContext, channel: RelaySetupChannel, command: string): Promise<void> {
    await copySetupTextToClipboard(ctx, `${command}\n`, `PiRelay ${channel} pairing command`, "Paste it into the messenger app to complete pairing.");
  }

  async function copySetupTextToClipboard(ctx: ExtensionContext, text: string, label: string, nextStep: string): Promise<void> {
    const copied = await copyTextToClipboard(text);
    if (copied.ok) {
      ctx.ui.notify(`${label} copied to clipboard${copied.command ? ` using ${copied.command}` : ""}. ${nextStep}`, "info");
    } else {
      ctx.ui.setEditorText(text);
      ctx.ui.notify(`Clipboard copy is unavailable (${redactSecrets(copied.error ?? "unknown error")}). ${label} was placed in the Pi editor instead.`, "warning");
    }
  }

  async function handleRelaySetupWizardAction(ctx: ExtensionContext, channel: RelaySetupChannel, config: TelegramTunnelConfig, action: RelaySetupWizardActionId): Promise<void> {
    if (action === "copy-env-snippet") {
      const snippet = envSnippetTextForSetupChannel(channel);
      await copySetupTextToClipboard(ctx, snippet, `PiRelay ${channel} env snippet`, `Add values in your shell profile, restart/export them, then run /relay setup ${channel} again to write config from env.`);
      return;
    }
    if (action === "copy-slack-manifest") {
      if (channel !== "slack") return;
      await copySetupTextToClipboard(ctx, slackAppManifestText(), "PiRelay Slack app manifest", "Paste it in Slack: Create New App → From an app manifest, then install/reinstall the app and copy the generated tokens into env/config.");
      return;
    }

    const preview = computeRelaySetupConfigPatchFromEnv(channel, process.env, { effectiveEventMode: channel === "slack" ? config.slack?.eventMode : undefined });
    if (preview.missingRequiredEnvVars.length > 0 || preview.invalidEnvVars.length > 0) {
      ctx.ui.notify([
        `Cannot write ${channel} config yet: environment variables need attention.`,
        ...(preview.missingRequiredEnvVars.length > 0 ? [`Missing: ${preview.missingRequiredEnvVars.join(", ")}`] : []),
        ...(preview.invalidEnvVars.length > 0 ? [`Invalid: ${preview.invalidEnvVars.join(", ")}`] : []),
        `Use the setup wizard's copy env snippet action to copy placeholder exports to the clipboard, then fix your environment and retry.`,
      ].join("\n"), "warning");
      return;
    }

    const confirmed = await ctx.ui.confirm(
      `Write PiRelay ${channel} config from env?`,
      [
        `Target: ${config.configPath ?? "default PiRelay config path"}`,
        "PiRelay will write env var references for secrets, not secret values.",
        preview.changedFields.length > 0 ? `Fields: ${preview.changedFields.join(", ")}` : "No defined env vars were found for this messenger.",
        "A timestamped backup will be created if the config file already exists and the written file will be chmod 600.",
      ].join("\n"),
    );
    if (!confirmed) {
      ctx.ui.notify(`Skipped PiRelay ${channel} config update; no changes were made.`, "info");
      return;
    }

    const result = await writeRelaySetupConfigFromEnv(channel, { configPath: config.configPath });
    const stopped = await stopAndClearRuntimes(ctx);
    configCache = undefined;
    await resetStoppedRuntimeStatuses(ctx, stopped);
    ctx.ui.notify(redactSecrets([
      `Updated PiRelay ${channel} config from environment variables.`,
      `Config: ${result.configPath}`,
      `Backup: ${result.backupPath ?? "not created"}`,
      `Fields: ${result.changedFields.length > 0 ? result.changedFields.join(", ") : "none"}`,
      "Run /relay doctor to verify setup.",
    ].join("\n")), "info");
  }

  async function promptAndApplyConfigMigration(ctx: ExtensionContext, migrationPlan: RelayConfigMigrationPlan): Promise<boolean> {
    const sourceDescription = migrationPlan.kind === "legacy-default-to-canonical"
      ? `${migrationPlan.sourcePath}; it can be copied to ${migrationPlan.targetPath}`
      : migrationPlan.sourcePath;
    const confirmed = await ctx.ui.confirm(
      "Migrate PiRelay config?",
      [
        `Legacy Telegram tunnel config keys were detected in ${sourceDescription}.`,
        `Keys: ${migrationPlan.legacyKeys.join(", ")}.`,
        "Migrate to the namespaced PiRelay config schema now?",
        "A timestamped backup of the source will be created and the migrated target will be chmod 600.",
      ].join("\n"),
    );
    if (!confirmed) {
      ctx.ui.notify("Skipped PiRelay config migration; legacy fallback remains active where possible.", "info");
      return false;
    }

    const result = await migrateRelayConfigPlan(migrationPlan);
    configCache = undefined;
    ctx.ui.notify(`Migrated PiRelay config to the namespaced schema. Target: ${result.targetPath}. Backup: ${result.backupPath ?? "not created"}`, "info");
    return true;
  }

  async function handleRelayRestart(ctx: ExtensionContext): Promise<void> {
    await ensureRuntime(ctx, false);
    const stopped = await stopAndClearRuntimes(ctx, { restartBrokerProcess: true });
    configCache = undefined;
    await resetStoppedRuntimeStatuses(ctx, stopped);
    await syncRoute(ctx);
    ctx.ui.notify(stopped.brokerRestarted ? "PiRelay broker process and runtimes restarted for this session." : "PiRelay runtimes restarted for this session.", "info");
  }

  function renderRelayStatusDiagnostics(): string | undefined {
    if (relayStatusDiagnostics.size === 0) return undefined;
    return [
      "Runtime status details:",
      ...[...relayStatusDiagnostics.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `- ${key}: ${value}`),
    ].join("\n");
  }

  async function handleApprovalAudit(ctx: ExtensionContext): Promise<void> {
    const config = await ensureConfig(ctx, true);
    const store = new TunnelStateStore(config.stateDir);
    const sessionKey = safeSessionKeyForContext(ctx);
    const events = await store.listApprovalAudit({ sessionKey, limit: 20 });
    if (events.length === 0) {
      ctx.ui.notify("No approval-gate audit events for this session.", "info");
      return;
    }
    ctx.ui.notify(events.map((event) => [
      `${event.at} ${event.kind}`,
      event.toolName ? `tool=${event.toolName}` : undefined,
      event.category ? `category=${event.category}` : undefined,
      event.requester ? `requester=${event.requester.channel}:${event.requester.userId}` : undefined,
      event.expiresAt ? `expires=${event.expiresAt}` : undefined,
      event.summary ? `summary=${redactSecrets(event.summary)}` : undefined,
    ].filter(Boolean).join(" | ")).join("\n"), "info");
  }

  async function handleRelayDoctor(ctx: ExtensionContext): Promise<void> {
    try {
      const migrationPlan = await planRelayConfigMigrationForEnv();
      if (migrationPlan) await promptAndApplyConfigMigration(ctx, migrationPlan);
      const config = await ensureConfig(ctx, true);
      const facts = await collectRelaySetupFacts(config);
      const diagnostics = renderRelayStatusDiagnostics();
      ctx.ui.notify([renderRelayDoctorReport(config, relaySetupDiagnostics(config, facts)), diagnostics].filter(Boolean).join("\n\n"), "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(redactSecrets([
        "Relay setup doctor",
        "",
        `Could not load relay config: ${message}`,
        "Minimal Telegram setup: set TELEGRAM_BOT_TOKEN, then run /relay setup telegram and /relay connect telegram.",
        "Discord and Slack are opt-in via discord.* / slack.* config or PI_RELAY_DISCORD_* / PI_RELAY_SLACK_* environment variables.",
      ].join("\n")), "warning");
    }
  }

  async function handleConnect(ctx: ExtensionContext, explicitLabel?: string): Promise<void> {
    const config = await ensureConfig(ctx, true);
    const tunnelRuntime = await ensureRuntime(ctx);
    const setup = await tunnelRuntime.ensureSetup();
    if (!currentRoute) {
      await syncRoute(ctx);
    }
    if (!currentRoute) {
      throw new Error("Failed to initialize the current Pi session route.");
    }
    if (explicitLabel?.trim()) {
      const sessionLabel = deriveSessionLabel({
        explicitLabel,
        sessionName: ctx.sessionManager.getSessionName(),
        cwd: ctx.cwd,
        sessionFile: currentRoute.sessionFile,
        sessionId: currentRoute.sessionId,
      });
      currentRoute.sessionLabel = sessionLabel;
      if (currentRoute.binding) currentRoute.binding = { ...currentRoute.binding, sessionLabel };
    }
    await tunnelRuntime.registerRoute(currentRoute);
    telegramRuntimeStatus = { enabled: Boolean(config.botToken), started: true };

    await ensureAllDiscordRuntimes(ctx, true);
    for (const [instanceId, discord] of discordRuntimes) {
      await discord.registerRoute(currentRoute);
      await startDiscordRuntime(ctx, discord, false, instanceId);
    }
    await ensureAllSlackRuntimes(ctx, true);
    for (const [instanceId, slack] of slackRuntimes) {
      await slack.registerRoute(currentRoute);
      await startSlackRuntime(ctx, slack, false, instanceId);
    }
    const store = new TunnelStateStore(config.stateDir);
    const { nonce, pairing } = await store.createPendingPairing({
      channel: "telegram",
      sessionId: currentRoute.sessionId,
      sessionFile: currentRoute.sessionFile,
      sessionLabel: currentRoute.sessionLabel,
      expiryMs: config.pairingExpiryMs,
    });

    const deepLink = `https://t.me/${setup.botUsername}?start=${nonce}`;
    const qrLines = renderQrLines(deepLink);
    const expiryMinutes = Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 60_000);

    if (ctx.hasUI) {
      ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
      try {
        await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
          closeConnectQrScreen = () => done(undefined);
          return new PairingQrScreen(theme, "Telegram relay pairing", currentRoute!.sessionLabel, qrLines, deepLink, expiryMinutes, ["Scan the QR code or open the link in Telegram, then press Start.", "Shared-room mode uses a Telegram group/supergroup with one dedicated bot per machine; pair/trust the user first, then invite the machine bots and use /use <machine> <session> or mentions/replies.", "Re-run /relay connect telegram to show this again."], () => done(undefined));
        });
      } finally {
        closeConnectQrScreen = undefined;
      }
      ctx.ui.notify(`Pairing link ready for @${setup.botUsername}. Expires in about ${expiryMinutes} minute(s).`, "info");
      return;
    }

    ctx.ui.notify(`Open this Telegram pairing link: ${deepLink}\nShared-room mode: use a Telegram group/supergroup with one dedicated bot per machine after pairing/trusting the user; target this machine with /use <machine> <session>, /to <machine> <session> <prompt>, mentions, or replies.`, "info");
  }

  async function handleRelayConnect(ctx: ExtensionContext, channel: RelaySetupChannel, explicitLabel?: string, instanceId = "default"): Promise<void> {
    if (channel === "telegram") {
      await handleConnect(ctx, explicitLabel);
      return;
    }
    const config = await ensureConfig(ctx, true);
    const selectedDiscordConfig = channel === "discord" ? config.discordInstances?.[instanceId] ?? (instanceId === "default" ? config.discord : undefined) : undefined;
    const selectedSlackConfig = channel === "slack" ? config.slackInstances?.[instanceId] ?? (instanceId === "default" ? config.slack : undefined) : undefined;
    const channelReady = statusConfiguredForChannel(config, channel, instanceId);
    if (!channelReady) {
      const findings = relaySetupDiagnostics(config).filter((finding) => finding.channel === channel && finding.severity === "error");
      ctx.ui.notify(redactSecrets([
        `${channel} is not ready for pairing.`,
        ...findings.map((finding) => `- ${finding.message}`),
        `Run /relay setup ${channel} or /relay doctor for details.`,
      ].join("\n")), "warning");
      return;
    }
    if (!currentRoute) await syncRoute(ctx);
    if (!currentRoute) throw new Error("Failed to initialize the current Pi session route.");
    if (explicitLabel?.trim()) {
      currentRoute.sessionLabel = deriveSessionLabel({
        explicitLabel,
        sessionName: ctx.sessionManager.getSessionName(),
        cwd: ctx.cwd,
        sessionFile: currentRoute.sessionFile,
        sessionId: currentRoute.sessionId,
      });
    }
    if (channel === "discord") {
      const discord = await ensureDiscordRuntime(ctx, true, instanceId);
      if (!discord) throw new Error("Discord runtime is not configured. Run /relay setup discord or /relay doctor for details.");
      await discord.registerRoute(currentRoute);
      await startDiscordRuntime(ctx, discord, true, instanceId);
    }
    let discoveredSlackAppId: string | undefined;
    let discoveredSlackTeamId: string | undefined;
    if (channel === "slack") {
      const slack = await ensureSlackRuntime(ctx, true, instanceId);
      if (!slack) throw new Error("Slack runtime is not configured. Run /relay setup slack or /relay doctor for details.");
      await slack.registerRoute(currentRoute);
      await startSlackRuntime(ctx, slack, true, instanceId);
      const slackStatus = slack.getStatus();
      discoveredSlackAppId = slackStatus.appId;
      discoveredSlackTeamId = slackStatus.teamId;
    }
    const store = new TunnelStateStore(config.stateDir);
    const { nonce, pairing } = await store.createPendingPairing({
      channel,
      sessionId: currentRoute.sessionId,
      sessionFile: currentRoute.sessionFile,
      sessionLabel: currentRoute.sessionLabel,
      expiryMs: config.pairingExpiryMs,
      codeKind: channel === "discord" || channel === "slack" ? "pin" : "nonce",
    });
    const expiryMinutes = Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 60_000);
    const discordApplicationId = selectedDiscordConfig?.applicationId ?? selectedDiscordConfig?.clientId;
    if (channel === "discord" && discordApplicationId) {
      const chatUrl = discordBotChatUrl(discordApplicationId);
      const qrLines = renderQrLines(chatUrl);
      const pairingCommand = `relay pair ${nonce}`;
      const instructions = [
        "Choose one pairing path:",
        "A) DM: scan the QR code/open the link to the Discord bot profile, then send the highlighted command in the bot DM.",
        "B) Channel: invite the bot to an allowed server channel, enable Discord guild-channel control, then copy the highlighted command with c and paste it in that channel.",
        "Bot authorization/invite is handled by /relay setup discord; for DM pairing, make sure you and the bot already share a server and Discord DMs are allowed.",
        `${`/start ${nonce}`} is also accepted as a compatibility alias.`,
      ];
      if (ctx.hasUI) {
        ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
        try {
          await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
            closeConnectQrScreen = () => done(undefined);
            return new PairingQrScreen(theme, "Discord relay pairing", currentRoute!.sessionLabel, qrLines, chatUrl, expiryMinutes, instructions, () => done(undefined), {
              command: pairingCommand,
              onCopyCommand: async (command) => copyPairingCommandToClipboard(ctx, "discord", command),
            });
          });
        } finally {
          closeConnectQrScreen = undefined;
        }
        ctx.ui.notify(`Discord pairing PIN ready: ${nonce}. Expires in about ${expiryMinutes} minute(s).`, "info");
        return;
      }
      ctx.ui.notify(redactSecrets([
        `Discord pairing ready for session ${currentRoute.sessionLabel}.`,
        `Open bot profile/DM: ${chatUrl}`,
        "Choose one pairing path:",
        "A) DM: open the bot profile/DM link, then send the pairing command in the bot DM. Make sure you and the bot already share a server and Discord DMs are allowed.",
        "B) Channel: invite the bot to an allowed server channel, enable Discord guild-channel control, then paste the pairing command in that channel.",
        `Pairing command: relay pair ${nonce}`,
        `/start ${nonce} is also accepted as a compatibility alias.`,
        `Expires in about ${expiryMinutes} minute(s).`,
      ].join("\n")), "info");
      return;
    }
    const slackAppId = selectedSlackConfig?.appId ?? discoveredSlackAppId;
    const slackTeamId = selectedSlackConfig?.workspaceId ?? discoveredSlackTeamId;
    if (channel === "slack" && slackAppId) {
      const appUrl = slackAppRedirectUrl(slackAppId, slackTeamId);
      const qrLines = renderQrLines(appUrl);
      const pairingCommand = `relay pair ${nonce}`;
      const instructions = [
        "Choose one pairing path:",
        "A) DM: scan the QR code/open the link to Slack App Home, open the Messages tab, then send the highlighted command in the app DM.",
        "B) Channel: invite the app to the target Slack channel, enable slack.allowChannelMessages, then copy the highlighted command with c and paste it in that channel/thread.",
        "If Slack says sending messages to this app is turned off, enable App Home > Messages Tab > Allow users to send messages to your app, add message.im with im:history/im:read scopes, add reactions:write for thinking indicators, reinstall the app, then retry.",
        "Do not prefix the highlighted command with /; Slack treats leading slash text as a slash command.",
      ];
      if (ctx.hasUI) {
        ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
        try {
          await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
            closeConnectQrScreen = () => done(undefined);
            return new PairingQrScreen(theme, "Slack relay pairing", currentRoute!.sessionLabel, qrLines, appUrl, expiryMinutes, instructions, () => done(undefined), {
              command: pairingCommand,
              onCopyCommand: async (command) => copyPairingCommandToClipboard(ctx, "slack", command),
            });
          });
        } finally {
          closeConnectQrScreen = undefined;
        }
        ctx.ui.notify(`Slack pairing PIN ready: ${pairingCommand}. Expires in about ${expiryMinutes} minute(s).`, "info");
        return;
      }
      ctx.ui.notify(redactSecrets([
        `Slack pairing ready for session ${currentRoute.sessionLabel}.`,
        `Open Slack app home: ${appUrl}`,
        "Choose one pairing path:",
        "A) DM: open Slack App Home, use the Messages tab, then send the pairing command in the app DM.",
        "B) Channel: invite the app to the target Slack channel, enable slack.allowChannelMessages, then paste the pairing command in that channel/thread.",
        "If Slack says sending messages to this app is turned off, enable App Home > Messages Tab > Allow users to send messages to your app, add message.im with im:history/im:read scopes, add reactions:write for thinking indicators, reinstall the app, then retry.",
        `Pairing command: relay pair ${nonce}`,
        `Expires in about ${expiryMinutes} minute(s).`,
      ].join("\n")), "info");
      return;
    }
    ctx.ui.notify(redactSecrets([
      `${channel} pairing ready for session ${currentRoute.sessionLabel}.`,
      relayPairingInstruction(channel, nonce),
      channel === "discord" ? "Choose one pairing path: DM the bot, or paste the pairing command in an allowed server channel after enabling Discord guild-channel control." : undefined,
      channel === "discord" ? "QR redirect unavailable: set discord.applicationId (or clientId) or PI_RELAY_DISCORD_APPLICATION_ID (or PI_RELAY_DISCORD_CLIENT_ID) from Discord Developer Portal > General Information > Application ID." : undefined,
      channel === "slack" ? "Choose one pairing path: DM the Slack app, or paste the pairing command in a Slack channel/thread after inviting the app and enabling slack.allowChannelMessages." : undefined,
      channel === "slack" ? "Slack App Home QR unavailable: set slack.appId or PI_RELAY_SLACK_APP_ID from Slack Basic Information > App Credentials > App ID." : undefined,
      channel === "slack" ? "If Slack says sending messages to this app is turned off, enable App Home > Messages Tab > Allow users to send messages to your app, add message.im with im:history/im:read scopes, add reactions:write for thinking indicators, reinstall the app, then retry." : undefined,
      `Expires in about ${expiryMinutes} minute(s).`,
    ].filter(Boolean).join("\n")), "info");
  }

  async function handleTrustedUsers(ctx: ExtensionContext): Promise<void> {
    const config = await ensureConfig(ctx, true);
    const trusted = await new TunnelStateStore(config.stateDir).listTrustedRelayUsers();
    if (trusted.length === 0) {
      ctx.ui.notify("No locally trusted relay users.", "info");
      return;
    }
    ctx.ui.notify([
      "Locally trusted relay users",
      "",
      ...trusted.map((record) => `- ${record.channel}:${record.instanceId} ${record.displayName ?? record.username ?? record.userId} (${record.userId}) trusted ${record.trustedAt}`),
      "",
      "Revoke with /relay untrust <messenger> <userId>.",
    ].join("\n"), "info");
  }

  async function handleUntrust(ctx: ExtensionContext, args: string): Promise<void> {
    const [channel, userId] = args.trim().split(/\s+/).filter(Boolean);
    if (!channel || !userId || !supportedRelayChannels().includes(channel as RelaySetupChannel)) {
      ctx.ui.notify("Usage: /relay untrust <telegram|discord|slack> <userId>", "warning");
      return;
    }
    const config = await ensureConfig(ctx, true);
    const removed = await new TunnelStateStore(config.stateDir).revokeTrustedRelayUser(channel as RelaySetupChannel, userId);
    ctx.ui.notify(removed ? `Revoked local relay trust for ${channel}:${userId}.` : `No local relay trust found for ${channel}:${userId}.`, "info");
  }

  interface LocalSendFileTarget {
    channel: RelaySetupChannel;
    instanceId: string;
    label: string;
    paused?: boolean;
    binding?: TelegramBindingMetadata | ChannelPersistedBindingRecord;
  }

  function parseSendFileTargetRef(value: string | undefined): { all: boolean; channel?: RelaySetupChannel; instanceId: string } | undefined {
    const target = value?.trim().toLowerCase();
    if (!target) return undefined;
    if (target === "all") return { all: true, instanceId: "default" };
    const ref = parseMessengerRef(target);
    if (!ref || !supportedRelayChannels().includes(ref.kind as RelaySetupChannel)) return undefined;
    return { all: false, channel: ref.kind as RelaySetupChannel, instanceId: ref.instanceId };
  }

  async function resolveLocalSendFileTargets(config: TelegramTunnelConfig, targetRef: string): Promise<LocalSendFileTarget[]> {
    if (!currentRoute) return [];
    const parsed = parseSendFileTargetRef(targetRef);
    if (!parsed) return [];
    const store = new TunnelStateStore(config.stateDir);
    const snapshot = await store.loadBindingAuthoritySnapshot();
    if (snapshot.kind === "state-unavailable") return [];
    const targets: LocalSendFileTarget[] = [];
    const includeChannel = (channel: RelaySetupChannel, instanceId = "default") => parsed.all || (parsed.channel === channel && parsed.instanceId === instanceId);

    if (parsed.all || includeChannel("telegram")) {
      const routeBinding = currentRoute.binding;
      const outcome = resolveTelegramBindingAuthority(
        snapshot,
        { sessionKey: currentRoute.sessionKey, chatId: routeBinding?.chatId, userId: routeBinding?.userId, includePaused: true, allowVolatileFallback: true },
        routeBinding,
      );
      if (authorityOutcomeAllowsDelivery(outcome)) {
        targets.push({ channel: "telegram", instanceId: "default", label: "Telegram", paused: outcome.binding.paused, binding: outcome.binding });
      } else if (!parsed.all && parsed.channel === "telegram") {
        targets.push({ channel: "telegram", instanceId: "default", label: "Telegram" });
      }
    }

    const channelBindings = Object.values(snapshot.data.channelBindings).filter((binding) => binding.sessionKey === currentRoute!.sessionKey && binding.status !== "revoked");
    for (const binding of channelBindings) {
      if (binding.channel !== "discord" && binding.channel !== "slack") continue;
      const channel = binding.channel as "discord" | "slack";
      const instanceId = binding.instanceId ?? "default";
      if (!includeChannel(channel, instanceId)) continue;
      targets.push({ channel, instanceId, label: instanceId === "default" ? channelLabel(channel) : `${channelLabel(channel)}:${instanceId}`, paused: binding.paused, binding });
    }
    if (!parsed.all && parsed.channel && !targets.some((target) => target.channel === parsed.channel && target.instanceId === parsed.instanceId)) {
      targets.push({ channel: parsed.channel, instanceId: parsed.instanceId, label: parsed.instanceId === "default" ? channelLabel(parsed.channel) : `${channelLabel(parsed.channel)}:${parsed.instanceId}` });
    }
    return targets;
  }

  function maxOutboundBytesForLocalTargets(config: TelegramTunnelConfig, targets: readonly LocalSendFileTarget[], kind: RelayOutboundFileKind): number | undefined {
    const limits: number[] = [];
    for (const target of targets) {
      if (!target.binding || target.paused) continue;
      if (target.channel === "telegram") {
        limits.push(kind === "image" ? config.maxOutboundImageBytes : DEFAULT_TELEGRAM_LOCAL_DOCUMENT_MAX_BYTES);
        continue;
      }
      const channelConfig = target.channel === "discord"
        ? config.discordInstances?.[target.instanceId] ?? (target.instanceId === "default" ? config.discord : undefined)
        : config.slackInstances?.[target.instanceId] ?? (target.instanceId === "default" ? config.slack : undefined);
      const defaultMaxFileBytes = target.channel === "discord" ? DEFAULT_DISCORD_MAX_FILE_BYTES : DEFAULT_SLACK_MAX_FILE_BYTES;
      limits.push(channelConfig?.maxFileBytes ?? defaultMaxFileBytes);
    }
    return limits.length > 0 ? Math.max(...limits) : undefined;
  }

  async function sendLocalFileToTarget(ctx: ExtensionContext, config: TelegramTunnelConfig, target: LocalSendFileTarget, file: ChannelOutboundFile, kind: RelayOutboundFileKind, caption?: string): Promise<"delivered" | "skipped"> {
    if (!currentRoute) return "skipped";
    if (!target.binding || target.paused) return "skipped";
    if (target.channel === "telegram") {
      const binding = target.binding as TelegramBindingMetadata;
      const adapter = new TelegramChannelAdapter(config);
      const address: ChannelRouteAddress = { channel: "telegram", conversationId: String(binding.chatId), userId: String(binding.userId) };
      if (kind === "image") await adapter.sendImage(address, file, { caption });
      else await adapter.sendDocument(address, file, { caption });
      return "delivered";
    }
    if (target.channel === "discord") {
      const discord = await ensureDiscordRuntime(ctx, true, target.instanceId);
      if (!discord) throw new Error(`${target.label} runtime is not configured.`);
      await discord.registerRoute(currentRoute);
      await startDiscordRuntime(ctx, discord, true, target.instanceId);
      return await discord.sendFileToBoundRoute(currentRoute, file, { kind, caption }) ? "delivered" : "skipped";
    }
    const slack = await ensureSlackRuntime(ctx, true, target.instanceId);
    if (!slack) throw new Error(`${target.label} runtime is not configured.`);
    await slack.registerRoute(currentRoute);
    return await slack.sendFileToBoundRoute(currentRoute, file, { kind, caption }) ? "delivered" : "skipped";
  }

  async function deliverAssistantRequestedFile(relativePath: string, caption?: string): Promise<string> {
    if (!currentRoute) return "Relay file delivery is unavailable because no active Pi session route is registered.";
    const ctx = liveContextForRoute(currentRoute);
    if (!ctx) return unavailableRouteMessage();
    const requester = currentRoute.remoteRequester;
    if (!requester) return "No authorized remote requester is available for this turn. Ask for the file from the paired messenger conversation, or run /relay send-file locally.";
    const config = await ensureConfig(ctx, true);
    if (requester.channel === "telegram") {
      const workspaceRoot = currentRoute.actions.getWorkspaceRoot?.();
      if (!workspaceRoot) return unavailableRouteMessage();
      const adapter = new TelegramChannelAdapter(config);
      const store = new TunnelStateStore(config.stateDir);
      const result = await deliverWorkspaceFileToRequester({
        route: currentRoute,
        requester,
        adapter,
        workspaceRoot,
        relativePath,
        caption,
        source: "assistant-tool",
        maxDocumentBytes: DEFAULT_TELEGRAM_LOCAL_DOCUMENT_MAX_BYTES,
        maxImageBytes: config.maxOutboundImageBytes,
        allowedImageMimeTypes: config.allowedImageMimeTypes,
        authoritySnapshot: await store.loadBindingAuthoritySnapshot(),
      });
      currentRoute.actions.appendAudit(`relay_send_file ${result.ok ? "delivered" : "failed"}: ${result.ok ? result.relativePath : result.error}`);
      return formatRequesterFileDeliveryResult(result);
    }
    if (requester.channel === "discord") {
      const runtime = await ensureDiscordRuntime(ctx, true, requester.instanceId);
      if (!runtime) return "Discord file delivery is not configured for this instance.";
      return await runtime.sendFileToRequester(currentRoute, requester, relativePath, caption);
    }
    if (requester.channel === "slack") {
      const runtime = await ensureSlackRuntime(ctx, true, requester.instanceId);
      if (!runtime) return "Slack file delivery is not configured for this instance. Add files:write, reinstall the app, and retry.";
      return await runtime.sendFileToRequester(currentRoute, requester, relativePath, caption);
    }
    return `Relay file delivery is not supported for ${requester.channel}.`;
  }

  async function handleSendFile(ctx: ExtensionContext, targetRef: string | undefined, relativePath: string | undefined, caption?: string): Promise<void> {
    if (!targetRef || !relativePath) {
      ctx.ui.notify("Usage: /relay send-file <telegram|discord|slack|messenger:instance|all> <relative-path> [caption]", "warning");
      return;
    }
    if (!parseSendFileTargetRef(targetRef)) {
      ctx.ui.notify(`Unsupported relay send-file target: ${targetRef}. Use telegram, discord, slack, messenger:instance, or all.`, "warning");
      return;
    }
    const config = await ensureConfig(ctx, true);
    if (!currentRoute) await syncRoute(ctx);
    if (!currentRoute) throw new Error("Failed to initialize the current Pi session route.");
    const targets = await resolveLocalSendFileTargets(config, targetRef);
    if (targets.length === 0) {
      ctx.ui.notify(`No relay binding found for ${targetRef} in this session.`, "warning");
      return;
    }
    const deliverableTargets = targets.filter((target) => target.binding && !target.paused);
    if (deliverableTargets.length === 0) {
      ctx.ui.notify(`No active unpaused relay binding found for ${targetRef} in this session.`, "warning");
      return;
    }
    const loaded = await loadWorkspaceOutboundFile(relativePath, {
      workspaceRoot: ctx.cwd,
      maxDocumentBytes: maxOutboundBytesForLocalTargets(config, deliverableTargets, "document"),
      maxImageBytes: maxOutboundBytesForLocalTargets(config, deliverableTargets, "image") ?? config.maxOutboundImageBytes,
      allowedImageMimeTypes: config.allowedImageMimeTypes,
    });
    if (!loaded.ok) {
      ctx.ui.notify(loaded.error, "warning");
      return;
    }

    const delivered: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const target of targets) {
      try {
        const result = await sendLocalFileToTarget(ctx, config, target, loaded.file, loaded.kind, caption || `PiRelay file: ${loaded.relativePath}`);
        if (result === "delivered") delivered.push(target.label);
        else skipped.push(target.label);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`${target.label}: ${redactSecrets(message)}`);
      }
    }

    const lines = [
      `File delivery for ${loaded.relativePath}`,
      delivered.length > 0 ? `Delivered: ${delivered.join(", ")}` : undefined,
      skipped.length > 0 ? `Skipped: ${skipped.join(", ")} (not paired or paused)` : undefined,
      failed.length > 0 ? `Failed: ${failed.join("; ")}` : undefined,
    ].filter(Boolean);
    ctx.ui.notify(lines.join("\n"), failed.length > 0 && delivered.length === 0 ? "warning" : "info");
  }

  async function handleDisconnect(ctx: ExtensionContext): Promise<void> {
    const config = await ensureConfig(ctx, true);
    const store = new TunnelStateStore(config.stateDir);
    if (!currentRoute) await syncRoute(ctx);
    if (!currentRoute) return;
    const disconnectedRoute = currentRoute;
    removePendingSessionHandoffsForSession(disconnectedRoute.sessionKey);
    await notifyRelayLifecycle(ctx, "disconnected", disconnectedRoute);
    currentRoute.binding = undefined;
    await store.revokeBinding(currentRoute.sessionKey);
    await store.revokeChannelBindingsForSession(currentRoute.sessionKey);
    persistBinding(null, true, disconnectedRoute);
    if (runtime) {
      await runtime.unregisterRoute(disconnectedRoute.sessionKey);
    }
    for (const discordRuntime of discordRuntimes.values()) {
      await discordRuntime.unregisterRoute(disconnectedRoute.sessionKey);
    }
    for (const slackRuntime of slackRuntimes.values()) {
      await slackRuntime.unregisterRoute(disconnectedRoute.sessionKey);
    }
    currentRoute = disconnectedRoute;
    await refreshRelayStatuses(ctx).catch((error) => {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return;
      }
      throw error;
    });
    try {
      ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
      ctx.ui.notify("PiRelay disconnected for this session.", "info");
    } catch (error) {
      if (isStaleExtensionReferenceError(error)) {
        if (latestContext === ctx) latestContext = undefined;
        return;
      }
      throw error;
    }
    appendAudit("PiRelay disconnected locally.");
  }

  async function handleStatus(ctx: ExtensionContext): Promise<void> {
    if (!currentRoute) await syncRoute(ctx);
    if (!currentRoute) {
      ctx.ui.notify("Telegram relay is not configured. Run /relay setup telegram after setting TELEGRAM_BOT_TOKEN.", "warning");
      return;
    }
    const busy = !ctx.isIdle();
    const binding = currentRoute.binding;
    const lines = [
      `Session: ${currentRoute.sessionLabel}`,
      `Session key: ${currentRoute.sessionKey}`,
      `Busy: ${busy ? "yes" : "no"}`,
      `Binding: ${binding ? `${binding.chatId}/${binding.userId}` : "not paired"}`,
      `Paused: ${binding?.paused ? "yes" : "no"}`,
      `Last status: ${currentRoute.notification.lastStatus ?? "unknown"}`,
    ];
    ctx.ui.notify(lines.join("\n"), "info");
  }

  type LocalRelayCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

  function createLocalRelayCommand(description: string): LocalRelayCommand {
    return {
      description,
      getArgumentCompletions: (prefix) => {
        const completions = completeRelayLocalCommand(prefix);
        return completions ? completions.map((value) => ({ value, label: value })) : null;
      },
      handler: async (args, ctx) => {
        latestContext = ctx;
        attachCommandContextToRoute(ctx);
        const intent = parseRelayLocalCommand(args);
        try {
          if (intent.unsupportedChannel) {
            ctx.ui.notify(`Unsupported relay channel: ${intent.unsupportedChannel}. Supported channels: ${supportedRelayChannels().join(", ")}.`, "warning");
            return;
          }
          switch (intent.subcommand) {
            case "setup":
              await handleRelaySetup(ctx, intent.channel ?? "telegram");
              return;
            case "connect": {
              const instanceId = intent.messengerRef?.split(":")[1] ?? "default";
              await handleRelayConnect(ctx, intent.channel ?? "telegram", intent.args, instanceId);
              return;
            }
            case "doctor":
              await handleRelayDoctor(ctx);
              return;
            case "diagnostics": {
              const config = await ensureConfig(ctx, true);
              ctx.ui.notify(diagnosticsStatusText(config), "info");
              return;
            }
            case "approvals":
              await handleApprovalAudit(ctx);
              return;
            case "send-file":
              await handleSendFile(ctx, intent.sendFileTarget, intent.sendFilePath, intent.sendFileCaption);
              return;
            case "restart":
              await handleRelayRestart(ctx);
              return;
            case "disconnect":
              await handleDisconnect(ctx);
              return;
            case "status":
              await handleStatus(ctx);
              return;
            case "trusted":
              await handleTrustedUsers(ctx);
              return;
            case "untrust":
              await handleUntrust(ctx, intent.args);
              return;
            default:
              ctx.ui.notify(getCommandHelp(), "info");
          }
        } catch (error) {
          const message = error instanceof ConfigError || error instanceof Error ? error.message : String(error);
          try {
            ctx.ui.notify(redactSecrets(message), "error");
          } catch (notifyError) {
            if (isStaleExtensionReferenceError(notifyError)) {
              if (latestContext === ctx) latestContext = undefined;
              return;
            }
            throw notifyError;
          }
        }
      },
    };
  }

  pi.registerCommand("relay", createLocalRelayCommand("Manage relay pairing and remote control for the current Pi session"));

  pi.registerTool?.({
    name: "relay_send_file",
    label: "Relay Send File",
    description: "Send a safe workspace-relative file to the authorized remote messenger requester for the current PiRelay turn.",
    promptSnippet: "Send validated workspace files to the current authorized PiRelay remote requester",
    promptGuidelines: [
      "Use relay_send_file when an authorized remote Telegram, Discord, or Slack user asks you to send a workspace file or artifact as a messenger attachment.",
      "Do not use relay_send_file for local-only turns; ask the local user to run /relay send-file instead.",
      "relay_send_file only accepts workspace-relative paths and cannot send hidden, traversal, unsupported, or oversized files.",
    ],
    parameters: Type.Object({
      relativePath: Type.String({ description: "Workspace-relative file path to send." }),
      caption: Type.Optional(Type.String({ description: "Optional caption to include with the file." })),
    }),
    async execute(_toolCallId, params: { relativePath: string; caption?: string }) {
      const text = await deliverAssistantRequestedFile(params.relativePath, params.caption);
      return {
        content: [{ type: "text" as const, text }],
        details: { ok: text.startsWith("Delivered "), relativePath: params.relativePath },
      };
    },
  });

  pi.registerMessageRenderer(AUDIT_MESSAGE_TYPE, (message, _options, theme) => ({
    render(width: number) {
      const text = typeof message.content === "string" ? message.content : "Relay action";
      const rendered = theme.fg("accent", `Relay › ${text}`);
      return [rendered.length > width ? rendered.slice(0, width) : rendered];
    },
    invalidate() {},
  }));

  pi.on("session_start", async (_event, ctx) => {
    try {
      await syncRoute(ctx);
    } catch {
      // Ignore unconfigured state until the user runs setup.
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    latestContext = ctx;
    resetToolProgress();
    closeConnectQrScreen = undefined;
    const shuttingDownRoute = currentRoute;
    if (shuttingDownRoute && runtime) await runtime.unregisterRoute(shuttingDownRoute.sessionKey);
    if (shuttingDownRoute) {
      for (const discordRuntime of discordRuntimes.values()) await discordRuntime.unregisterRoute(shuttingDownRoute.sessionKey);
      for (const slackRuntime of slackRuntimes.values()) await slackRuntime.unregisterRoute(shuttingDownRoute.sessionKey);
    }
    let handoffPending = false;
    if (shuttingDownRoute && event.reason === "new") {
      const existing = listPendingSessionHandoffs().some((handoff) => handoff.oldSessionKey === shuttingDownRoute.sessionKey);
      if (!existing) await preparePendingHandoff(shuttingDownRoute, "local-new").catch(() => undefined);
      handoffPending = listPendingSessionHandoffs().some((handoff) => handoff.oldSessionKey === shuttingDownRoute.sessionKey);
    }
    if (shuttingDownRoute && !handoffPending) await notifyRelayLifecycle(ctx, "offline", shuttingDownRoute);
    if (currentRoute && configCache) {
      await new TunnelStateStore(configCache.stateDir).cancelPendingApprovalsForSession(currentRoute.sessionKey, "session shutdown").catch(() => undefined);
      for (const [approvalId, resolve] of pendingApprovalResolvers) {
        resolve({ ok: false, status: "cancelled", message: "Approval cancelled because the session shut down." });
        pendingApprovalResolvers.delete(approvalId);
      }
    }
    latestCommandContext = undefined;
  });

  pi.on("session_tree", async (_event, ctx) => {
    latestContext = ctx;
    if (currentRoute) {
      currentRoute.actions.context = ctx;
      publishRouteStateSoon();
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    latestContext = ctx;
    if (currentRoute) {
      currentRoute.actions.context = ctx;
      publishRouteStateSoon();
    }
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    recordProgress("compaction", COMPACTION_PROGRESS_STARTED_TEXT);
    recordDiagnostic({ component: "runtime", event: "session_before_compact", outcome: "started", ...diagnosticRouteFields() });
    publishRouteStateSoon();
  });

  pi.on("session_compact", async (_event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    recordProgress("compaction", COMPACTION_PROGRESS_COMPLETED_TEXT);
    recordDiagnostic({ component: "runtime", event: "session_compact", outcome: "completed", ...diagnosticRouteFields() });
    publishRouteStateSoon();
  });

  pi.on("agent_start", async (_event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    clearTurnImageCaches();
    currentRoute.actions.context = ctx;
    const remoteOwnedTurn = currentRoute.remoteRequesterPendingTurn === true;
    if (!remoteOwnedTurn) currentRoute.remoteRequester = undefined;
    currentRoute.remoteRequesterPendingTurn = false;
    currentRoute.remoteRequesterActiveTurn = remoteOwnedTurn;
    currentRoute.notification.startedAt = Date.now();
    currentRoute.notification.lastTurnId = undefined;
    currentRoute.notification.lastAssistantText = undefined;
    currentRoute.notification.lastFailure = undefined;
    currentRoute.notification.lastStatus = "running";
    currentRoute.notification.abortRequested = false;
    currentRoute.notification.structuredAnswer = undefined;
    currentRoute.notification.latestImages = undefined;
    currentRoute.lastActivityAt = Date.now();
    recordProgress("lifecycle", "Pi task started");
    recordDiagnostic({ component: "runtime", event: "agent_start", outcome: "running", ...diagnosticRouteFields() });
    publishRouteStateSoon();
  });

  pi.on("message_update", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.message.role === "assistant") {
      const assistantText = extractTextContent(event.message.content);
      if (assistantText) {
        currentRoute.notification.lastAssistantText = assistantText;
        currentRoute.lastActivityAt = Date.now();
        if (currentRoute.notification.lastStatus === "running") {
          const streamEvent = event.assistantMessageEvent;
          if (streamEvent?.type === "text_end" && typeof streamEvent.content === "string" && streamEvent.content.trim()) {
            recordProgress("assistant", "Model update", summarizeTextDeterministically(streamEvent.content, 280), { delivery: "volatile", semanticKey: `assistant:${streamEvent.content}` });
          }
          publishRouteStateSoon();
        }
      }
    }
  });

  pi.on("message_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.message.role === "assistant") {
      const assistantText = extractTextContent(event.message.content);
      if (assistantText) {
        activeTurnCompletedAssistantText = assistantText;
        currentRoute.notification.lastAssistantText = assistantText;
        currentRoute.lastActivityAt = Date.now();
        publishRouteStateSoon();
      }
    }
    if (event.message.role === "toolResult") {
      activeTurnImages.push(...extractImageContent(event.message.content));
      const toolText = extractTextContent(event.message.content as never);
      if (toolText) activeTurnImagePathTexts.push(toolText);
      const progressSuppressed = consumeToolProgressSuppression(event.message.toolCallId, event.message.toolName);
      const hasLifecycleProgress = configCache
        ? toolProgress.consumeResultMatch({ toolName: event.message.toolName, toolCallId: event.message.toolCallId }, configCache)
        : toolProgress.has(event.message.toolCallId);
      if (currentRoute.notification.lastStatus === "running" && !progressSuppressed && !hasLifecycleProgress) {
        recordProgress("tool", "Processed tool result", undefined, { delivery: "volatile", semanticKey: `tool-result:${event.message.toolCallId ?? "unknown"}` });
        publishRouteStateSoon();
      }
    }
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    const currentSessionKey = currentRoute.sessionKey;
    currentRoute.actions.context = ctx;
    const input = optionalToolEventInput(event);
    const config = configCache ?? (await ensureConfig(ctx, false).catch(() => undefined));
    if (!config) return;
    if (!currentRoute || currentRoute.sessionKey !== currentSessionKey || currentRoute.notification.lastStatus !== "running") return;
    recordDiagnostic({ component: "runtime", event: "tool_execution_start", outcome: "received", ...diagnosticRouteFields(), details: { toolName: String(event.toolName ?? ""), hasInput: input !== undefined } });
    toolProgress.start({ toolName: event.toolName, toolCallId: event.toolCallId, input }, config);
  });

  pi.on("tool_call", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    const currentSessionKey = currentRoute.sessionKey;
    currentRoute.actions.context = ctx;
    const recordAllowedProgress = (configToUse: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars" | "recentActivityLimit">) => {
      if (!currentRoute || currentRoute.sessionKey !== currentSessionKey || currentRoute.notification.lastStatus !== "running") return;
      recordToolProgressActivity({ toolName: event.toolName, toolCallId: event.toolCallId, input: event.input, state: "active" }, configToUse);
      publishRouteStateSoon();
    };
    recordDiagnostic({ component: "runtime", event: "tool_call", outcome: "received", ...diagnosticRouteFields(), details: { toolName: String(event.toolName ?? ""), hasInput: event.input !== undefined } });
    const config = configCache ?? (await ensureConfig(ctx, false).catch(() => undefined));
    if (!config) return;
    const resolved = approvalConfig(config);
    const operation = classifyApprovalOperation({ toolName: String(event.toolName ?? ""), toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined, input: event.input }, resolved);
    if (!operation) {
      recordAllowedProgress(config);
      return;
    }
    const requester = currentRoute.remoteRequester;
    if (!requester) {
      if (currentRoute.remoteRequesterActiveTurn) {
        await appendApprovalAudit(config, { kind: "failed", sessionKey: currentRoute.sessionKey, sessionLabel: currentRoute.sessionLabel, toolName: operation.toolName, category: operation.category, matcherFingerprint: operation.matcherFingerprint, summary: operation.summary, detail: "No active remote requester for approval target." });
        suppressToolProgress(event, config);
        return { block: true, reason: "Approval required, but no active remote requester is available." };
      }
      recordAllowedProgress(config);
      return;
    }
    if (!currentRoute.remoteRequesterActiveTurn) {
      recordAllowedProgress(config);
      return;
    }
    const active = await approvalRequesterBindingIsActive(currentRoute, requester, new TunnelStateStore(config.stateDir));
    if (!active) {
      await appendApprovalAudit(config, { kind: "failed", sessionKey: currentRoute.sessionKey, sessionLabel: currentRoute.sessionLabel, toolName: operation.toolName, category: operation.category, matcherFingerprint: operation.matcherFingerprint, requester, summary: operation.summary, detail: "Approval requester binding is inactive." });
      suppressToolProgress(event, config);
      return { block: true, reason: "Approval required, but the remote requester binding is inactive." };
    }
    const grant = await findMatchingApprovalGrant(currentRoute, requester, operation, config);
    if (grant) {
      const store = new TunnelStateStore(config.stateDir);
      await store.markApprovalGrantUsed(grant.grantId);
      await appendApprovalAudit(config, { kind: "grant-used", grantId: grant.grantId, sessionKey: currentRoute.sessionKey, sessionLabel: currentRoute.sessionLabel, toolName: operation.toolName, category: operation.category, matcherFingerprint: operation.matcherFingerprint, requester, summary: operation.summary, expiresAt: grant.expiresAt });
      recordAllowedProgress(config);
      return;
    }
    const request = createApprovalRequest({ route: currentRoute, requester, operation, timeoutMs: resolved.timeoutMs });
    const store = new TunnelStateStore(config.stateDir);
    await store.upsertApprovalRequest(request);
    await appendApprovalAudit(config, { kind: "requested", approvalId: request.approvalId, sessionKey: request.sessionKey, sessionLabel: request.sessionLabel, toolName: request.toolName, category: request.category, matcherFingerprint: request.matcherFingerprint, requester: request.requester, summary: request.safeSummary, expiresAt: request.expiresAt });
    try {
      await sendApprovalRequest(request, config);
    } catch (error) {
      await store.updateApprovalRequest(request.approvalId, (current) => ({ ...current, status: "failed", resolvedAt: toIsoNow(), decision: "deny" }));
      await appendApprovalAudit(config, { kind: "failed", approvalId: request.approvalId, sessionKey: request.sessionKey, sessionLabel: request.sessionLabel, toolName: request.toolName, category: request.category, matcherFingerprint: request.matcherFingerprint, requester: request.requester, summary: request.safeSummary, detail: error instanceof Error ? error.message : String(error) });
      suppressToolProgress(event, config);
      return { block: true, reason: "Approval request could not be delivered; operation blocked." };
    }
    const decision = await awaitApprovalDecision(request, Math.max(0, Date.parse(request.expiresAt) - Date.now()));
    if (!decision.ok) {
      if (decision.status === "expired") {
        await store.updateApprovalRequest(request.approvalId, (current) => current.status === "pending" ? { ...current, status: "expired", resolvedAt: toIsoNow(), decision: "deny" } : current);
        await appendApprovalAudit(config, { kind: "expired", approvalId: request.approvalId, sessionKey: request.sessionKey, sessionLabel: request.sessionLabel, toolName: request.toolName, category: request.category, matcherFingerprint: request.matcherFingerprint, requester: request.requester, summary: request.safeSummary, expiresAt: request.expiresAt });
      }
      suppressToolProgress(event, config);
      return { block: true, reason: decision.message };
    }
    recordAllowedProgress(config);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    const currentSessionKey = currentRoute.sessionKey;
    currentRoute.actions.context = ctx;
    const config = configCache ?? (await ensureConfig(ctx, false).catch(() => undefined));
    if (!config) {
      if (currentRoute && currentRoute.sessionKey === currentSessionKey && currentRoute.notification.lastStatus === "running" && event.isError) {
        currentRoute.notification.lastFailure = `Tool ${event.toolName} failed.`;
        publishRouteStateSoon();
      }
      return;
    }
    recordDiagnostic({ component: "runtime", event: "tool_execution_end", outcome: event.isError ? "error" : "ok", ...diagnosticRouteFields(), details: { toolName: String(event.toolName ?? ""), isError: Boolean(event.isError) } });
    if (!currentRoute || currentRoute.sessionKey !== currentSessionKey || currentRoute.notification.lastStatus !== "running") return;
    if (isToolProgressSuppressed(event.toolCallId, event.toolName)) {
      if (event.isError) {
        currentRoute.notification.lastFailure = `Tool ${event.toolName} failed.`;
        publishRouteStateSoon();
      }
      return;
    }
    if (event.isError) {
      currentRoute.notification.lastFailure = `Tool ${event.toolName} failed.`;
      recordToolProgressActivity({ toolName: event.toolName, toolCallId: event.toolCallId, input: optionalToolEventInput(event), state: "failed" }, config);
      publishRouteStateSoon();
      return;
    }
    recordToolProgressActivity({ toolName: event.toolName, toolCallId: event.toolCallId, input: optionalToolEventInput(event), state: "completed" }, config);
    publishRouteStateSoon();
  });
  pi.on("agent_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    currentRoute.lastActivityAt = Date.now();

    const extraction = analyzeFinalAssistantExtraction(event.messages as AgentMessage[], configCache?.communicationDiagnostics);
    const finalText = extraction.finalText ?? activeTurnCompletedAssistantText;
    const finalTextSource = extraction.finalText ? "agent_end" : finalText ? "message-end-fallback" : "none";
    const turnId = createTurnId();
    currentRoute.notification.lastTurnId = turnId;
    const config = configCache;
    latestTurnImages = [];
    latestTurnImageFileCandidates = [];
    let skippedImages = 0;
    if (config && activeTurnImages.length > 0) {
      for (const image of activeTurnImages) {
        const latestImage = latestImageFromContent(image, { turnId, index: latestTurnImages.length });
        if (
          latestTurnImages.length >= config.maxLatestImages
          || !isAllowedImageMimeType(latestImage.mimeType, config.allowedImageMimeTypes)
          || latestImage.byteSize > config.maxOutboundImageBytes
        ) {
          skippedImages += 1;
          continue;
        }
        latestTurnImages.push(latestImage);
      }
    }
    if (config) {
      const imagePathTexts = finalText ? [...activeTurnImagePathTexts, finalText] : activeTurnImagePathTexts;
      const remaining = Math.max(0, config.maxLatestImages - latestTurnImages.length);
      const fileCandidates = latestImageFileCandidatesFromText(imagePathTexts, { turnId, maxCount: remaining });
      const verifiedFileCandidates: LatestTurnImageFileCandidate[] = [];
      for (const candidate of fileCandidates) {
        const loaded = await loadImagePathForTelegram(ctx, candidate.path, candidate.turnId, latestTurnImages.length + verifiedFileCandidates.length);
        if (loaded.ok) verifiedFileCandidates.push(candidate);
      }
      latestTurnImageFileCandidates = verifiedFileCandidates;
    }
    const latestImageCount = latestTurnImages.length + latestTurnImageFileCandidates.length;
    currentRoute.notification.latestImages = latestImageCount > 0
      ? {
        turnId,
        count: latestImageCount,
        skipped: skippedImages,
        contentCount: latestTurnImages.length,
        fileCount: latestTurnImageFileCandidates.length,
      }
      : undefined;
    if (finalText) {
      currentRoute.notification.lastAssistantText = finalText;
      currentRoute.notification.structuredAnswer = extractStructuredAnswerMetadata(finalText, { turnId });
    } else {
      currentRoute.notification.structuredAnswer = undefined;
    }

    const status = currentRoute.notification.abortRequested
      ? "aborted"
      : finalText
        ? "completed"
        : "failed";

    currentRoute.notification.lastStatus = status;
    recordDiagnostic({
      component: "runtime",
      event: "agent_end.final_extraction",
      outcome: extraction.diagnostics.finalTextFound ? "final-text-found" : finalText ? "message-end-fallback" : extraction.diagnostics.missingReason,
      severity: extraction.diagnostics.finalTextFound || finalText || status === "aborted" ? "info" : "warning",
      turnId,
      ...diagnosticRouteFields(),
      details: { ...extraction.diagnostics, selectedStatus: status, finalTextSource, usedMessageLifecycleFallback: finalTextSource === "message-end-fallback", abortRequested: Boolean(currentRoute.notification.abortRequested), hadPriorFailure: Boolean(currentRoute.notification.lastFailure) },
    });
    recordProgress("lifecycle", status === "completed" ? "Pi task completed" : status === "aborted" ? "Pi task aborted" : "Pi task failed");
    resetToolProgress();
    if (status === "failed" && !currentRoute.notification.lastFailure) {
      currentRoute.notification.lastFailure = "The agent finished without a final assistant response.";
    }

    publishRouteStateSoon();
    recordDiagnostic({ component: "runtime", event: "notification_fanout", outcome: status, turnId, ...diagnosticRouteFields(), details: { telegram: Boolean(runtime), discordRuntimes: discordRuntimes.size, slackRuntimes: slackRuntimes.size } });
    if (runtime) await sendSessionNotification(runtime, currentRoute, status, configCache);
    for (const discord of await ensureAllDiscordRuntimes()) {
      await discord.notifyTurnCompleted(currentRoute, status);
    }
    for (const slack of await ensureAllSlackRuntimes()) {
      await slack.notifyTurnCompleted(currentRoute, status);
    }
  });
}
