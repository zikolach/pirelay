import { stat } from "node:fs/promises";
import type { DiscordRelayConfig, SlackRelayConfig, TelegramTunnelConfig } from "./types.js";

export type RelaySetupChannel = "telegram" | "discord" | "slack";
export type RelaySetupSeverity = "ok" | "warning" | "error";
export type RelaySetupMode = "socket" | "webhook";

export interface RelaySetupFinding {
  channel: RelaySetupChannel | "all";
  severity: RelaySetupSeverity;
  code: string;
  message: string;
}

export interface RelaySetupFacts {
  configFileMode?: number;
  stateDirMode?: number;
}

export interface RelayLocalCommandIntent {
  subcommand?: "setup" | "connect" | "disconnect" | "status" | "doctor";
  channel?: RelaySetupChannel;
  args: string;
  unsupportedChannel?: string;
}

const SUPPORTED_CHANNELS: RelaySetupChannel[] = ["telegram", "discord", "slack"];
const SECRET_PATTERNS = [
  /\b\d+:[A-Za-z0-9_-]{20,}\b/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /slack-signing-secret-[A-Za-z0-9_-]+/gi,
  /discord-token-[A-Za-z0-9_-]+/gi,
  /[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g,
];

export function supportedRelayChannels(): RelaySetupChannel[] {
  return [...SUPPORTED_CHANNELS];
}

export function completeRelayLocalCommand(prefix: string, options: { compatibilityCommand?: boolean } = {}): string[] | null {
  const endsWithSpace = /\s$/.test(prefix);
  const parts = prefix.trim().split(/\s+/).filter(Boolean);
  const subcommands = options.compatibilityCommand
    ? ["setup", "connect", "disconnect", "status"]
    : ["setup", "connect", "doctor", "disconnect", "status"];

  if (parts.length === 0) return subcommands;
  if (parts.length === 1 && !endsWithSpace) {
    const matches = subcommands.filter((value) => value.startsWith(parts[0].toLowerCase()));
    return matches.length > 0 ? matches : null;
  }

  const subcommand = normalizeSubcommand(parts[0]);
  if (!subcommand || options.compatibilityCommand) return null;
  if (subcommand !== "setup" && subcommand !== "connect") return null;
  if (parts.length === 1 && endsWithSpace) return supportedRelayChannels().map((channel) => `${subcommand} ${channel}`);
  if (parts.length === 2 && !endsWithSpace) {
    const matches = supportedRelayChannels()
      .filter((value) => value.startsWith(parts[1].toLowerCase()))
      .map((channel) => `${subcommand} ${channel}`);
    return matches.length > 0 ? matches : null;
  }
  return null;
}

export function parseRelayLocalCommand(args: string, options: { compatibilityCommand?: boolean } = {}): RelayLocalCommandIntent {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const subcommand = normalizeSubcommand(parts[0]);
  if (!subcommand) return { args: args.trim() };
  const rest = parts.slice(1);
  if (subcommand === "doctor" || subcommand === "disconnect" || subcommand === "status") {
    return { subcommand, args: rest.join(" ") };
  }

  if (options.compatibilityCommand) {
    return { subcommand, channel: "telegram", args: rest.join(" ") };
  }

  const maybeChannel = rest[0]?.toLowerCase();
  if (!maybeChannel) {
    return { subcommand, channel: "telegram", args: "" };
  }
  const channel = isRelaySetupChannel(maybeChannel) ? maybeChannel : undefined;
  if (!channel) {
    return { subcommand, args: rest.slice(1).join(" "), unsupportedChannel: maybeChannel };
  }
  return { subcommand, channel, args: rest.slice(1).join(" ") };
}

export function relaySetupDiagnostics(config: TelegramTunnelConfig, facts: RelaySetupFacts = {}): RelaySetupFinding[] {
  return [
    ...telegramDiagnostics(config),
    ...discordDiagnostics(config.discord),
    ...slackDiagnostics(config.slack),
    ...permissionDiagnostics(facts),
  ];
}

export async function collectRelaySetupFacts(config: Pick<TelegramTunnelConfig, "configPath" | "stateDir">): Promise<RelaySetupFacts> {
  const facts: RelaySetupFacts = {};
  if (config.configPath) {
    try {
      facts.configFileMode = (await stat(config.configPath)).mode;
    } catch {
      // Missing config files are valid when env vars are used.
    }
  }
  try {
    facts.stateDirMode = (await stat(config.stateDir)).mode;
  } catch {
    // The state dir may not exist before first setup.
  }
  return facts;
}

export function renderRelayDoctorReport(config: TelegramTunnelConfig, findings: RelaySetupFinding[]): string {
  const lines = ["Relay setup doctor", ""];
  const sharedFindings = findings.filter((finding) => finding.channel === "all");

  for (const channel of supportedRelayChannels()) {
    const channelFindings = findings.filter((finding) => finding.channel === channel);
    const state = channelDoctorState(config, channel, channelFindings);
    lines.push(`${state.icon} ${capitalize(channel)} — ${state.label}`);
    lines.push(...channelDoctorChecklist(config, channel));

    const actionableFindings = channelFindings.filter((finding) => finding.severity !== "ok");
    if (actionableFindings.length > 0) {
      lines.push(...actionableFindings.map((finding) => `  ${severityIcon(finding.severity)} ${redactSecrets(finding.message)}`));
    } else if (state.enabled) {
      lines.push("  ✅ No blocking issues found.");
    } else {
      const info = channelFindings.find((finding) => finding.severity === "ok");
      if (info) lines.push(`  ℹ️ ${redactSecrets(info.message)}`);
    }
    lines.push("");
  }

  if (sharedFindings.length > 0) {
    lines.push("Shared checks");
    lines.push(...sharedFindings.map((finding) => `  ${severityIcon(finding.severity)} ${redactSecrets(finding.message)}`));
  } else {
    lines.push("Shared checks");
    lines.push("  ✅ Config/state permissions look OK or were not available to inspect.");
  }

  return redactSecrets(lines.join("\n").trimEnd());
}

export function relaySetupFallbackGuidance(channel: RelaySetupChannel): string {
  switch (channel) {
    case "telegram":
      return [
        "Telegram relay setup",
        "Set TELEGRAM_BOT_TOKEN or botToken in ~/.pi/agent/telegram-tunnel/config.json.",
        "Run /telegram-tunnel setup or /relay setup telegram, then /telegram-tunnel connect or /relay connect telegram.",
        "Pairing uses a private Telegram chat and local confirmation unless allowUserIds is configured.",
      ].join("\n");
    case "discord":
      return [
        "Discord relay setup",
        "Create a Discord application/bot: https://discord.com/developers/docs/quick-start/getting-started",
        "Copy the bot token from the Bot settings, then set discord.botToken or PI_RELAY_DISCORD_BOT_TOKEN.",
        "Copy the Application ID from General Information, then set discord.clientId or PI_RELAY_DISCORD_CLIENT_ID to print a bot invite URL.",
        "Keep Discord DM-first; set allowUserIds before enabling live control.",
        "Run /relay connect discord [name], then send the displayed /start code to the bot in a DM.",
      ].join("\n");
    case "slack":
      return [
        "Slack relay setup",
        "Create a Slack app: https://api.slack.com/apps",
        "Install it to your workspace, then set slack.botToken or PI_RELAY_SLACK_BOT_TOKEN from the Bot User OAuth Token.",
        "Set slack.signingSecret or PI_RELAY_SLACK_SIGNING_SECRET from Basic Information > App Credentials.",
        "Use slack.eventMode=socket for local Pi, or webhook mode with raw-body signature verification.",
        "Keep Slack DM-first; set allowUserIds before enabling live control.",
        "Run /relay connect slack [name], then send the displayed /pirelay code to the app in a DM.",
      ].join("\n");
  }
}

export function relaySetupGuidance(channel: RelaySetupChannel, config: TelegramTunnelConfig): string {
  switch (channel) {
    case "telegram":
      return telegramGuidance(config);
    case "discord":
      return discordGuidance(config.discord);
    case "slack":
      return slackGuidance(config.slack);
  }
}

export function relayPairingInstruction(channel: RelaySetupChannel, code: string): string {
  switch (channel) {
    case "telegram":
      return "Use /telegram-tunnel connect or /relay connect telegram to generate a Telegram deep link.";
    case "discord":
      return `Send /start ${code} to the Discord bot in a DM before the pairing expires.`;
    case "slack":
      return `Send /pirelay ${code} to the Slack app in a DM before the pairing expires.`;
  }
}

export function relayChannelReady(config: TelegramTunnelConfig, channel: RelaySetupChannel): boolean {
  return relaySetupDiagnostics(config).filter((finding) => finding.channel === channel && finding.severity === "error").length === 0
    && (channel === "telegram" || channelStatus(config, channel).startsWith("enabled"));
}

export function redactSecrets(text: string): string {
  let output = text;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[redacted]");
  return output;
}

function channelDoctorState(config: TelegramTunnelConfig, channel: RelaySetupChannel, findings: RelaySetupFinding[]): { icon: string; label: string; enabled: boolean } {
  const hasErrors = findings.some((finding) => finding.severity === "error");
  const hasWarnings = findings.some((finding) => finding.severity === "warning");
  const enabled = channel === "telegram" || channelStatus(config, channel).startsWith("enabled");
  if (!enabled) return { icon: "⏸️", label: "disabled", enabled };
  if (hasErrors) return { icon: "❌", label: "needs attention", enabled };
  if (hasWarnings) return { icon: "✅", label: "ready with recommendations", enabled };
  return { icon: "✅", label: "ready", enabled };
}

function channelDoctorChecklist(config: TelegramTunnelConfig, channel: RelaySetupChannel): string[] {
  switch (channel) {
    case "telegram":
      return [
        config.botToken ? "  ✅ Bot token configured" : "  ❌ Bot token missing",
        config.allowUserIds.length > 0 ? "  ✅ Telegram allow-list configured" : "  ⚠️ Telegram allow-list not configured; local confirmation is still required",
      ];
    case "discord": {
      const discord = config.discord;
      if (!discord?.enabled && !discord?.botToken) return [];
      return [
        discord?.botToken ? "  ✅ Discord bot token configured" : "  ❌ Discord bot token missing",
        discord?.clientId ? "  ✅ Discord Application ID configured for invite URL" : "  ℹ️ Optional Discord Application ID not configured; invite URL will not be shown",
        discord?.allowUserIds && discord.allowUserIds.length > 0 ? "  ✅ Discord user allow-list configured" : "  ⚠️ Discord user allow-list not configured",
        discord?.allowGuildChannels
          ? ((discord.allowGuildIds ?? []).length > 0 ? "  ✅ Discord guild-channel control has explicit allowed guild ids" : "  ❌ Discord guild-channel control needs explicit allowed guild ids")
          : "  ✅ Discord guild-channel control disabled (DM-first)",
      ];
    }
    case "slack": {
      const slack = config.slack;
      if (!slack?.enabled && !slack?.botToken && !slack?.signingSecret) return [];
      return [
        slack?.botToken ? "  ✅ Slack bot token configured" : "  ❌ Slack bot token missing",
        slack?.signingSecret ? "  ✅ Slack signing secret configured" : "  ❌ Slack signing secret missing",
        `  ✅ Slack event mode: ${slack?.eventMode ?? "socket"}`,
        slack?.workspaceId ? "  ✅ Slack workspace boundary configured" : "  ⚠️ Slack workspaceId not configured",
        slack?.allowUserIds && slack.allowUserIds.length > 0 ? "  ✅ Slack user allow-list configured" : "  ⚠️ Slack user allow-list not configured",
        slack?.allowChannelMessages ? "  ⚠️ Slack channel control enabled; DM-first is safer" : "  ✅ Slack channel control disabled (DM-first)",
      ];
    }
  }
}

function severityIcon(severity: RelaySetupSeverity): string {
  switch (severity) {
    case "error":
      return "❌";
    case "warning":
      return "⚠️";
    case "ok":
      return "ℹ️";
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function telegramDiagnostics(config: TelegramTunnelConfig): RelaySetupFinding[] {
  const findings: RelaySetupFinding[] = [];
  if (!config.botToken) {
    findings.push({ channel: "telegram", severity: "error", code: "telegram-token-missing", message: "Missing TELEGRAM_BOT_TOKEN or botToken in the config file." });
  }
  if (config.allowUserIds.length === 0) {
    findings.push({ channel: "telegram", severity: "warning", code: "telegram-allow-list-empty", message: "Telegram allowUserIds is empty; pairing still requires local confirmation, but an allow-list is safer." });
  }
  return findings;
}

function discordDiagnostics(config: DiscordRelayConfig | undefined): RelaySetupFinding[] {
  if (!config?.enabled && !config?.botToken) {
    return [{ channel: "discord", severity: "ok", code: "discord-disabled", message: "Discord is disabled. Set discord.enabled and discord.botToken to opt in." }];
  }
  const findings: RelaySetupFinding[] = [];
  if (!config.botToken) findings.push({ channel: "discord", severity: "error", code: "discord-token-missing", message: "Discord is enabled but discord.botToken or PI_RELAY_DISCORD_BOT_TOKEN is missing." });
  if ((config.allowUserIds ?? []).length === 0) findings.push({ channel: "discord", severity: "warning", code: "discord-allow-list-empty", message: "Discord allowUserIds is empty; restrict Discord users before enabling live control." });
  if (config.allowGuildChannels && (config.allowGuildIds ?? []).length === 0) {
    findings.push({ channel: "discord", severity: "error", code: "discord-guild-ids-missing", message: "Discord guild-channel control is enabled but allowGuildIds is empty. Add explicit guild ids or disable guild channels." });
  }
  return findings;
}

function slackDiagnostics(config: SlackRelayConfig | undefined): RelaySetupFinding[] {
  if (!config?.enabled && !config?.botToken && !config?.signingSecret) {
    return [{ channel: "slack", severity: "ok", code: "slack-disabled", message: "Slack is disabled. Set slack.enabled, slack.botToken, and slack.signingSecret to opt in." }];
  }
  const findings: RelaySetupFinding[] = [];
  if (!config.botToken) findings.push({ channel: "slack", severity: "error", code: "slack-token-missing", message: "Slack is enabled but slack.botToken or PI_RELAY_SLACK_BOT_TOKEN is missing." });
  if (!config.signingSecret) findings.push({ channel: "slack", severity: "error", code: "slack-signing-secret-missing", message: "Slack is enabled but slack.signingSecret or PI_RELAY_SLACK_SIGNING_SECRET is missing." });
  if (config.eventMode === "webhook" && !config.signingSecret) findings.push({ channel: "slack", severity: "error", code: "slack-webhook-secret-missing", message: "Slack webhook mode requires a signing secret for request validation." });
  if ((config.allowUserIds ?? []).length === 0) findings.push({ channel: "slack", severity: "warning", code: "slack-allow-list-empty", message: "Slack allowUserIds is empty; restrict Slack users before enabling live control." });
  if (config.allowChannelMessages) findings.push({ channel: "slack", severity: "warning", code: "slack-channel-control-enabled", message: "Slack channel control is enabled. DM-first mode is safer; verify workspace and user authorization before use." });
  if (!config.workspaceId) findings.push({ channel: "slack", severity: "warning", code: "slack-workspace-missing", message: "Slack workspaceId is not set; set it to enforce workspace boundaries." });
  return findings;
}

function permissionDiagnostics(facts: RelaySetupFacts): RelaySetupFinding[] {
  const findings: RelaySetupFinding[] = [];
  if (typeof facts.configFileMode === "number" && (facts.configFileMode & 0o077) !== 0) {
    findings.push({ channel: "all", severity: "warning", code: "config-permissions", message: "Config file is group/world readable. Run chmod 600 to protect relay credentials." });
  }
  if (typeof facts.stateDirMode === "number" && (facts.stateDirMode & 0o077) !== 0) {
    findings.push({ channel: "all", severity: "warning", code: "state-permissions", message: "State directory is group/world accessible. Restrict permissions to protect pairing and binding state." });
  }
  return findings;
}

function telegramGuidance(config: TelegramTunnelConfig): string {
  return [
    "Telegram relay setup",
    `Status: ${channelStatus(config, "telegram")}`,
    "Create a bot with BotFather: https://core.telegram.org/bots/features#botfather",
    "Set TELEGRAM_BOT_TOKEN or botToken in ~/.pi/agent/telegram-tunnel/config.json.",
    "Run /telegram-tunnel setup or /relay setup telegram, then /telegram-tunnel connect or /relay connect telegram.",
    "Pairing uses a private Telegram chat and local confirmation unless allowUserIds is configured.",
  ].join("\n");
}

function discordGuidance(config: DiscordRelayConfig | undefined): string {
  const lines = [
    "Discord relay setup",
    `Status: ${config?.enabled && config.botToken ? "enabled" : "disabled or incomplete"}`,
    "Create a Discord application/bot: https://discord.com/developers/docs/quick-start/getting-started",
    "Copy the bot token from the Bot settings, then set discord.botToken or PI_RELAY_DISCORD_BOT_TOKEN.",
    "Keep Discord DM-first; set allowUserIds before enabling live control.",
  ];
  if (config?.clientId) {
    lines.push(`Invite URL: ${discordInviteUrl(config.clientId)}`);
  } else {
    lines.push("Optional: set discord.clientId or PI_RELAY_DISCORD_CLIENT_ID from the Application ID to print a bot invite URL.");
  }
  if (config?.allowGuildChannels) lines.push("Guild-channel control requires explicit discord.allowGuildIds.");
  lines.push("Run /relay connect discord [name], then send the displayed /start code to the bot in a DM.");
  return lines.join("\n");
}

function slackGuidance(config: SlackRelayConfig | undefined): string {
  const mode = config?.eventMode ?? "socket";
  return [
    "Slack relay setup",
    `Status: ${config?.enabled && config.botToken && config.signingSecret ? "enabled" : "disabled or incomplete"}`,
    "Create a Slack app: https://api.slack.com/apps",
    "Install it to your workspace, then set slack.botToken or PI_RELAY_SLACK_BOT_TOKEN from the Bot User OAuth Token.",
    "Set slack.signingSecret or PI_RELAY_SLACK_SIGNING_SECRET from Basic Information > App Credentials, and preferably slack.workspaceId.",
    `Event mode: ${mode}. ${mode === "socket" ? "Socket Mode is recommended for local Pi usage." : "Webhook mode must verify Slack signatures against the raw request body."}`,
    "Keep Slack DM-first; set allowUserIds before enabling live control.",
    "Run /relay connect slack [name], then send the displayed /pirelay code to the app in a DM.",
  ].join("\n");
}

function discordInviteUrl(clientId: string): string {
  const params = new URLSearchParams({ client_id: clientId, scope: "bot applications.commands", permissions: "0" });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function channelStatus(config: TelegramTunnelConfig, channel: RelaySetupChannel): string {
  if (channel === "telegram") return config.botToken ? "enabled" : "missing token";
  if (channel === "discord") return config.discord?.enabled && config.discord.botToken ? "enabled" : "disabled or incomplete";
  return config.slack?.enabled && config.slack.botToken && config.slack.signingSecret ? "enabled" : "disabled or incomplete";
}

function normalizeSubcommand(value: string | undefined): RelayLocalCommandIntent["subcommand"] | undefined {
  if (value === "setup" || value === "connect" || value === "disconnect" || value === "status" || value === "doctor") return value;
  return undefined;
}

function isRelaySetupChannel(value: string): value is RelaySetupChannel {
  return (SUPPORTED_CHANNELS as string[]).includes(value);
}
