import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { loadTelegramTunnelConfig, ConfigError } from "../config/tunnel-config.js";
import { renderQrLines } from "../ui/qr.js";
import { RelaySetupWizardScreen } from "../ui/setup-wizard.js";
import { getOrCreateTunnelRuntime, sendSessionNotification } from "../adapters/telegram/runtime.js";
import { TunnelStateStore } from "../state/tunnel-store.js";
import type { BindingEntryData, ImageFileLoadResult, LatestTurnImage, LatestTurnImageFileCandidate, PairingApprovalDecision, RelayPairingIdentity, SessionRoute, TelegramBindingMetadata, TelegramTunnelConfig, TunnelRuntime } from "../core/types.js";
import { extractStructuredAnswerMetadata } from "../core/guided-answer.js";
import type { DiscordRuntime } from "../adapters/discord/runtime.js";
import type { SlackRuntime } from "../adapters/slack/runtime.js";
import { appendRecentActivity, createProgressActivity, recentActivityLimit } from "../notifications/progress.js";
import { collectRelaySetupFacts, completeRelayLocalCommand, discordBotChatUrl, parseRelayLocalCommand, redactSecrets, relayChannelReady, relayPairingInstruction, relaySetupDiagnostics, relaySetupFallbackGuidance, relaySetupGuidance, renderRelayDoctorReport, supportedRelayChannels, type RelaySetupChannel } from "../config/setup.js";
import { buildRelaySetupWizardModel, renderRelaySetupWizardFallback } from "../config/setup-wizard.js";
import { migrateRelayConfigPlan, planRelayConfigMigrationForEnv, type RelayConfigMigrationPlan } from "../config/migration.js";
import { createTurnId, deriveSessionLabel, extractFinalAssistantText, extractImageContent, extractTextContent, getTelegramUserLabel, isAllowedImageMimeType, latestImageFileCandidatesFromText, latestImageFromContent, loadWorkspaceImageFile, sessionKeyOf, summarizeTextDeterministically, toIsoNow } from "../core/utils.js";

const BINDING_ENTRY_TYPE = "relay-binding";
const LEGACY_BINDING_ENTRY_TYPE = "telegram-tunnel-binding";
const AUDIT_MESSAGE_TYPE = "relay-audit";
const CONNECT_WIDGET_KEY = "relay-connect";

function shortenMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
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
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c")) {
      this.done();
    }
  }

  invalidate(): void {}

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
    lines.push(row());
    for (const instruction of this.instructions) {
      for (const wrapped of wrapPlainText(instruction, innerWidth)) lines.push(row(this.theme.fg("dim", wrapped)));
    }
    lines.push(row(this.theme.fg("dim", "Press Esc or Enter when done.")));
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
    "  disconnect  Revoke relay bindings for this session",
    "  status      Show current local relay state",
    "  trusted     List locally trusted relay users",
    "  untrust <telegram|discord|slack> <userId>  Revoke local relay trust",
  ].join("\n");
}

export default function telegramTunnelExtension(pi: ExtensionAPI): void {
  let configCache: TelegramTunnelConfig | undefined;
  let runtime: TunnelRuntime | undefined;
  const discordRuntimes = new Map<string, DiscordRuntime>();
  const slackRuntimes = new Map<string, SlackRuntime>();
  let currentRoute: SessionRoute | undefined;
  let latestContext: ExtensionContext | undefined;
  let closeConnectQrScreen: (() => void) | undefined;
  let activeTurnImages: ImageContent[] = [];
  let activeTurnImagePathTexts: string[] = [];
  let latestTurnImages: LatestTurnImage[] = [];
  let latestTurnImageFileCandidates: LatestTurnImageFileCandidate[] = [];
  let progressSequence = 0;

  async function ensureConfig(ctx?: ExtensionContext, interactiveNotice = false): Promise<TelegramTunnelConfig> {
    if (configCache) return configCache;
    const { config, warnings } = await loadTelegramTunnelConfig();
    configCache = config;
    if (ctx && interactiveNotice) {
      for (const warning of warnings) ctx.ui.notify(warning, "warning");
    }
    return config;
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

  async function startDiscordRuntime(ctx: ExtensionContext, discord: DiscordRuntime, failHard = false): Promise<boolean> {
    if (discord.getStatus().started) {
      ctx.ui.setStatus("discord-relay", "discord: ready");
      return true;
    }
    try {
      await discord.start();
      ctx.ui.setStatus("discord-relay", "discord: ready");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const safeMessage = redactSecrets(message);
      ctx.ui.setStatus("discord-relay", `discord error: ${safeMessage}`);
      if (failHard) throw new Error(`Discord runtime failed to start: ${safeMessage}`);
      return false;
    }
  }

  async function startSlackRuntime(ctx: ExtensionContext, slack: SlackRuntime, failHard = false): Promise<boolean> {
    if (slack.getStatus().started) {
      ctx.ui.setStatus("slack-relay", "slack: ready");
      return true;
    }
    try {
      await slack.start();
      ctx.ui.setStatus("slack-relay", "slack: ready");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const safeMessage = redactSecrets(message);
      ctx.ui.setStatus("slack-relay", `slack error: ${safeMessage}`);
      if (failHard) throw new Error(`Slack runtime failed to start: ${safeMessage}`);
      return false;
    }
  }

  function appendAudit(message: string): void {
    const safe = summarizeTextDeterministically(message, 280);
    pi.sendMessage({ customType: AUDIT_MESSAGE_TYPE, content: safe, display: true });
  }

  async function loadImagePathForTelegram(ctx: ExtensionContext, relativePath: string, turnId: string, index: number): Promise<ImageFileLoadResult> {
    const config = await ensureConfig();
    return loadWorkspaceImageFile(relativePath, {
      workspaceRoot: ctx.cwd,
      turnId,
      index,
      maxBytes: config.maxOutboundImageBytes,
      allowedMimeTypes: config.allowedImageMimeTypes,
    });
  }

  async function getLatestImagesForTelegram(): Promise<LatestTurnImage[]> {
    const ctx = latestContext;
    const images = [...latestTurnImages];
    if (!ctx) return images;
    const config = await ensureConfig();
    for (const candidate of latestTurnImageFileCandidates) {
      if (images.length >= config.maxLatestImages) break;
      const loaded = await loadImagePathForTelegram(ctx, candidate.path, candidate.turnId, images.length);
      if (loaded.ok) images.push(loaded.image);
    }
    return images;
  }

  function recordProgress(kind: "lifecycle" | "tool" | "assistant" | "status", text: string, detail?: string): void {
    if (!currentRoute) return;
    const config = configCache;
    const entry = createProgressActivity({
      id: `${Date.now()}-${++progressSequence}`,
      kind,
      text,
      detail,
    }, config ?? { redactionPatterns: [], maxProgressMessageChars: undefined });
    if (!entry) return;
    currentRoute.notification.progressEvent = entry;
    appendRecentActivity(currentRoute.notification, entry, recentActivityLimit(config ?? {}));
    currentRoute.lastActivityAt = Date.now();
  }

  function persistBinding(binding: TelegramBindingMetadata | null, revoked = false): void {
    const data: BindingEntryData = {
      version: 1,
      binding: binding ?? undefined,
      revoked,
      revokedAt: revoked ? toIsoNow() : undefined,
    };
    pi.appendEntry<BindingEntryData>(BINDING_ENTRY_TYPE, data);
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
    const approved = await ctx.ui.confirm(`${channel === "telegram" ? "Telegram" : "Discord"} Pairing Request`, details);
    if (!approved) return "deny";
    const trust = await ctx.ui.confirm("Trust relay user?", `Trust ${label} (${channel} ${userId}) so future fresh pairing codes can skip local confirmation on this machine?`);
    return trust ? "trust" : "allow";
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
    return {
      sessionKey: sessionKeyOf(sessionId, sessionFile),
      sessionId,
      sessionFile,
      sessionLabel,
      binding,
      lastActivityAt: Date.now(),
      notification: { lastStatus: "idle" },
      actions: {
        context: ctx,
        getModel: () => latestContext?.model,
        sendUserMessage: (text, options) => pi.sendUserMessage(text, options),
        getLatestImages: getLatestImagesForTelegram,
        getImageByPath: async (relativePath) => {
          const turnId = currentRoute?.notification.lastTurnId ?? createTurnId();
          return loadImagePathForTelegram(latestContext ?? ctx, relativePath, turnId, 0);
        },
        appendAudit,
        persistBinding,
        promptLocalConfirmation: async (identity) => promptPairingApproval(latestContext ?? ctx, identity, currentRoute?.sessionLabel ?? sessionLabel),
        abort: () => latestContext?.abort(),
        compact: () =>
          new Promise<void>((resolve, reject) => {
            if (!latestContext) {
              reject(new Error("No active Pi context available."));
              return;
            }
            latestContext.compact({
              onComplete: () => resolve(),
              onError: reject,
            });
          }),
      },
    };
  }

  async function publishRouteState(): Promise<void> {
    if (!runtime || !currentRoute) return;
    await runtime.registerRoute(currentRoute);
  }

  function publishRouteStateSoon(): void {
    void publishRouteState().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      latestContext?.ui.setStatus("relay-sync", `telegram sync error: ${message}`);
    });
  }

  async function restoreBinding(ctx: ExtensionContext, config: TelegramTunnelConfig): Promise<TelegramBindingMetadata | undefined> {
    let latest: BindingEntryData | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && (entry.customType === BINDING_ENTRY_TYPE || entry.customType === LEGACY_BINDING_ENTRY_TYPE)) {
        latest = entry.data as BindingEntryData;
      }
    }
    if (latest?.revoked) return undefined;
    if (latest?.binding) return latest.binding;

    const store = new TunnelStateStore(config.stateDir);
    const sessionKey = sessionKeyOf(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
    const localBinding = await store.getBindingBySessionKey(sessionKey);
    if (!localBinding || localBinding.status === "revoked") return undefined;
    return localBinding;
  }

  async function syncRoute(ctx: ExtensionContext): Promise<void> {
    latestContext = ctx;
    let config: TelegramTunnelConfig;
    try {
      config = await ensureConfig();
    } catch (error) {
      currentRoute = undefined;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setStatus("relay", `relay config error: ${redactSecrets(message)}`);
      return;
    }

    const restoredBinding = await restoreBinding(ctx, config);
    currentRoute = buildRoute(ctx, restoredBinding);
    for (const discord of await ensureAllDiscordRuntimes()) {
      await discord.registerRoute(currentRoute);
      await startDiscordRuntime(ctx, discord, false);
    }
    for (const slack of await ensureAllSlackRuntimes()) {
      await slack.registerRoute(currentRoute);
      await startSlackRuntime(ctx, slack, false);
    }
    try {
      runtime = await ensureRuntime();
      await runtime.registerRoute(currentRoute);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setStatus("relay-sync", `telegram sync error: ${redactSecrets(message)}`);
    }
    if (restoredBinding) {
      ctx.ui.setStatus("relay", `telegram: connected to ${restoredBinding.chatId}`);
    } else {
      ctx.ui.setStatus("relay", "telegram: ready");
    }
  }

  async function handleSetup(ctx: ExtensionContext): Promise<void> {
    const tunnelRuntime = await ensureRuntime(ctx, true);
    const setup = await tunnelRuntime.ensureSetup();
    await tunnelRuntime.start();
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
        try {
          await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => new RelaySetupWizardScreen(model, theme, () => done(undefined)));
          return;
        } catch (wizardError) {
          const safeMessage = wizardError instanceof Error ? wizardError.message : String(wizardError);
          ctx.ui.notify(redactSecrets(`Interactive setup wizard failed: ${safeMessage}. Showing plain setup guidance instead.`), "warning");
          ctx.ui.notify(renderRelaySetupWizardFallback(model, config), findings.some((finding) => finding.severity === "error") ? "warning" : "info");
          return;
        }
      }
      const lines = [relaySetupGuidance(channel, config)];
      if (findings.length > 0) {
        lines.push("", "Diagnostics:", ...findings.map((finding) => `- ${finding.severity}: ${finding.message}`));
      }
      ctx.ui.notify(redactSecrets(lines.join("\n")), findings.some((finding) => finding.severity === "error") ? "warning" : "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(redactSecrets([relaySetupFallbackGuidance(channel), "", `Config issue: ${message}`].join("\n")), "warning");
    }
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

  async function handleRelayDoctor(ctx: ExtensionContext): Promise<void> {
    try {
      const migrationPlan = await planRelayConfigMigrationForEnv();
      if (migrationPlan) await promptAndApplyConfigMigration(ctx, migrationPlan);
      const config = await ensureConfig(ctx, true);
      const facts = await collectRelaySetupFacts(config);
      ctx.ui.notify(renderRelayDoctorReport(config, relaySetupDiagnostics(config, facts)), "info");
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

    for (const discord of await ensureAllDiscordRuntimes(ctx, true)) {
      await discord.registerRoute(currentRoute);
      await startDiscordRuntime(ctx, discord, false);
    }
    for (const slack of await ensureAllSlackRuntimes(ctx, true)) {
      await slack.registerRoute(currentRoute);
      await startSlackRuntime(ctx, slack, false);
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
    const channelReady = channel === "discord"
      ? Boolean(selectedDiscordConfig?.enabled && selectedDiscordConfig.botToken)
      : relayChannelReady(config, channel);
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
      await startDiscordRuntime(ctx, discord, true);
    }
    if (channel === "slack") {
      const slack = await ensureSlackRuntime(ctx, true, instanceId);
      if (!slack) throw new Error("Slack runtime is not configured. Run /relay setup slack or /relay doctor for details.");
      await slack.registerRoute(currentRoute);
      await startSlackRuntime(ctx, slack, true);
    }
    const store = new TunnelStateStore(config.stateDir);
    const { nonce, pairing } = await store.createPendingPairing({
      channel,
      sessionId: currentRoute.sessionId,
      sessionFile: currentRoute.sessionFile,
      sessionLabel: currentRoute.sessionLabel,
      expiryMs: config.pairingExpiryMs,
      codeKind: channel === "discord" ? "pin" : "nonce",
    });
    const expiryMinutes = Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 60_000);
    const discordApplicationId = selectedDiscordConfig?.applicationId ?? selectedDiscordConfig?.clientId;
    if (channel === "discord" && discordApplicationId) {
      const chatUrl = discordBotChatUrl(discordApplicationId);
      const qrLines = renderQrLines(chatUrl);
      const instructions = [
        "Scan the QR code to open the Discord bot profile/DM.",
        "Bot authorization/invite is handled by /relay setup discord; make sure you and the bot already share a server and that Discord DMs are allowed.",
        "For shared-room mode, invite one dedicated PiRelay bot per machine into the same authorized server channel and run the pairing command in that channel when guild-channel control is enabled, or pair in DM first and then use machine-aware commands in the shared channel.",
        `Then send to the bot DM or authorized shared channel: relay pair ${nonce}`,
        `${`/start ${nonce}`} is also accepted as a compatibility alias.`,
      ];
      if (ctx.hasUI) {
        ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
        try {
          await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
            closeConnectQrScreen = () => done(undefined);
            return new PairingQrScreen(theme, "Discord relay pairing", currentRoute!.sessionLabel, qrLines, chatUrl, expiryMinutes, instructions, () => done(undefined));
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
        "Bot authorization/invite is handled by /relay setup discord; make sure you and the bot already share a server and that Discord DMs are allowed.",
        "Shared-room mode: invite one dedicated PiRelay bot per machine into the same authorized server channel; when guild-channel control is enabled you may pair from that channel, otherwise pair in DM and then use machine-aware commands in the shared channel.",
        `Send to the bot DM or authorized shared channel: relay pair ${nonce}`,
        `/start ${nonce} is also accepted as a compatibility alias.`,
        `Expires in about ${expiryMinutes} minute(s).`,
      ].join("\n")), "info");
      return;
    }
    ctx.ui.notify(redactSecrets([
      `${channel} pairing ready for session ${currentRoute.sessionLabel}.`,
      relayPairingInstruction(channel, nonce),
      channel === "discord" ? "Shared-room mode: use one dedicated Discord bot per machine in the same authorized server channel; with guild-channel control enabled, send the pairing PIN in that channel to bind this room." : undefined,
      channel === "discord" ? "QR redirect unavailable: set discord.applicationId (or clientId) or PI_RELAY_DISCORD_APPLICATION_ID (or PI_RELAY_DISCORD_CLIENT_ID) from Discord Developer Portal > General Information > Application ID." : undefined,
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

  async function handleDisconnect(ctx: ExtensionContext): Promise<void> {
    const config = await ensureConfig(ctx, true);
    const store = new TunnelStateStore(config.stateDir);
    if (!currentRoute) await syncRoute(ctx);
    if (!currentRoute) return;
    const disconnectedRoute = currentRoute;
    currentRoute.binding = undefined;
    await store.revokeBinding(currentRoute.sessionKey);
    await store.revokeChannelBindingsForSession(currentRoute.sessionKey);
    persistBinding(null, true);
    if (runtime) {
      await runtime.unregisterRoute(disconnectedRoute.sessionKey);
    }
    for (const discordRuntime of discordRuntimes.values()) {
      await discordRuntime.unregisterRoute(disconnectedRoute.sessionKey);
    }
    for (const slackRuntime of slackRuntimes.values()) {
      await slackRuntime.unregisterRoute(disconnectedRoute.sessionKey);
    }
    currentRoute = undefined;
    ctx.ui.setStatus("relay", "relay: disconnected");
    ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
    appendAudit("PiRelay disconnected locally.");
    ctx.ui.notify("PiRelay disconnected for this session.", "info");
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
          ctx.ui.notify(redactSecrets(message), "error");
        }
      },
    };
  }

  pi.registerCommand("relay", createLocalRelayCommand("Manage relay pairing and remote control for the current Pi session"));

  pi.registerMessageRenderer(AUDIT_MESSAGE_TYPE, (message, _options, theme) => ({
    render(width: number) {
      const text = typeof message.content === "string" ? message.content : "Telegram action";
      const rendered = theme.fg("accent", `Telegram › ${text}`);
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

  pi.on("session_shutdown", async (_event, ctx) => {
    latestContext = ctx;
    closeConnectQrScreen = undefined;
    if (runtime && currentRoute) {
      await runtime.unregisterRoute(currentRoute.sessionKey);
    }
    if (currentRoute) {
      for (const slackRuntime of slackRuntimes.values()) await slackRuntime.unregisterRoute(currentRoute.sessionKey);
    }
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

  pi.on("agent_start", async (_event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    activeTurnImages = [];
    activeTurnImagePathTexts = [];
    latestTurnImages = [];
    latestTurnImageFileCandidates = [];
    currentRoute.actions.context = ctx;
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
    publishRouteStateSoon();
  });

  pi.on("message_update", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.message.role === "assistant") {
      currentRoute.notification.lastAssistantText = extractTextContent(event.message.content);
      currentRoute.lastActivityAt = Date.now();
      if (currentRoute.notification.lastStatus === "running") {
        recordProgress("assistant", "Drafting response");
        publishRouteStateSoon();
      }
    }
  });

  pi.on("message_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.message.role === "assistant") {
      currentRoute.notification.lastAssistantText = extractTextContent(event.message.content);
      currentRoute.lastActivityAt = Date.now();
      publishRouteStateSoon();
    }
    if (event.message.role === "toolResult") {
      activeTurnImages.push(...extractImageContent(event.message.content));
      const toolText = extractTextContent(event.message.content as never);
      if (toolText) activeTurnImagePathTexts.push(toolText);
      if (currentRoute.notification.lastStatus === "running") {
        recordProgress("tool", "Processed tool result");
        publishRouteStateSoon();
      }
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.isError) {
      currentRoute.notification.lastFailure = `Tool ${event.toolName} failed.`;
      recordProgress("tool", "Tool failed", event.toolName);
      publishRouteStateSoon();
      return;
    }
    recordProgress("tool", "Tool completed", event.toolName);
    publishRouteStateSoon();
  });

  pi.on("agent_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute || !runtime) return;
    currentRoute.actions.context = ctx;
    currentRoute.lastActivityAt = Date.now();

    const finalText = extractFinalAssistantText(event.messages as AgentMessage[]);
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
      : currentRoute.notification.lastAssistantText
        ? "completed"
        : "failed";

    currentRoute.notification.lastStatus = status;
    recordProgress("lifecycle", status === "completed" ? "Pi task completed" : status === "aborted" ? "Pi task aborted" : "Pi task failed");
    if (status === "failed" && !currentRoute.notification.lastFailure) {
      currentRoute.notification.lastFailure = "The agent finished without a final assistant response.";
    }

    publishRouteStateSoon();
    await sendSessionNotification(runtime, currentRoute, status);
    for (const discord of await ensureAllDiscordRuntimes()) {
      await discord.notifyTurnCompleted(currentRoute, status);
    }
  });
}
