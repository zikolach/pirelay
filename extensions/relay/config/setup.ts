import { stat } from "node:fs/promises";
import { parseMessengerRef } from "../core/messenger-ref.js";
import type { DiscordRelayConfig, SlackRelayConfig, TelegramTunnelConfig } from "../core/types.js";

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
  subcommand?: "setup" | "connect" | "send-file" | "disconnect" | "status" | "doctor" | "trusted" | "untrust";
  channel?: RelaySetupChannel;
  messengerRef?: string;
  sendFileTarget?: string;
  sendFilePath?: string;
  sendFileCaption?: string;
  args: string;
  unsupportedChannel?: string;
}

const SUPPORTED_CHANNELS: RelaySetupChannel[] = ["telegram", "discord", "slack"];
const SECRET_PATTERNS = [
  /\b\d+:[A-Za-z0-9_-]{20,}\b/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /xapp-[A-Za-z0-9-]+/g,
  /https:\/\/hooks\.slack(?:-gov)?\.com\/[^\s"'\\]+/g,
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
    : ["setup", "connect", "send-file", "doctor", "disconnect", "status", "trusted", "untrust"];

  if (parts.length === 0) return subcommands;
  if (parts.length === 1 && !endsWithSpace) {
    const matches = subcommands.filter((value) => value.startsWith(parts[0].toLowerCase()));
    return matches.length > 0 ? matches : null;
  }

  const subcommand = normalizeSubcommand(parts[0]);
  if (!subcommand || options.compatibilityCommand) return null;
  if (subcommand !== "setup" && subcommand !== "connect" && subcommand !== "send-file") return null;
  const targets = subcommand === "send-file" ? ["all", ...supportedRelayChannels()] : supportedRelayChannels();
  if (parts.length === 1 && endsWithSpace) return targets.map((channel) => `${subcommand} ${channel}`);
  if (parts.length === 2 && !endsWithSpace) {
    const matches = targets
      .filter((value) => value.startsWith(parts[1].toLowerCase()) || `${value}:default`.startsWith(parts[1].toLowerCase()))
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
  if (subcommand === "send-file") {
    const target = rest[0]?.toLowerCase();
    const filePath = rest[1];
    if (!target) return { subcommand, args: rest.join(" ") };
    if (target !== "all") {
      const ref = parseMessengerRef(target);
      if (!ref || !isRelaySetupChannel(ref.kind)) {
        return { subcommand, args: rest.slice(1).join(" "), unsupportedChannel: target };
      }
    }
    return {
      subcommand,
      sendFileTarget: target,
      sendFilePath: filePath,
      sendFileCaption: rest.slice(2).join(" ").trim() || undefined,
      args: rest.slice(1).join(" "),
    };
  }
  if (subcommand === "doctor" || subcommand === "disconnect" || subcommand === "status" || subcommand === "trusted" || subcommand === "untrust") {
    return { subcommand, args: rest.join(" ") };
  }

  if (options.compatibilityCommand) {
    return { subcommand, channel: "telegram", args: rest.join(" ") };
  }

  const maybeMessengerRef = rest[0]?.toLowerCase();
  if (!maybeMessengerRef) {
    return { subcommand, channel: "telegram", messengerRef: "telegram:default", args: "" };
  }
  const ref = parseMessengerRef(maybeMessengerRef);
  if (!ref || !isRelaySetupChannel(ref.kind)) {
    return { subcommand, args: rest.slice(1).join(" "), unsupportedChannel: maybeMessengerRef };
  }
  return { subcommand, channel: ref.kind, messengerRef: `${ref.kind}:${ref.instanceId}`, args: rest.slice(1).join(" ") };
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

  lines.push("");
  lines.push("Broker topology");
  lines.push("  ✅ PiRelay uses one local broker per machine/state directory.");
  lines.push("  ⚠️ If the same bot/account is configured on multiple machines, configure one ingress owner and broker federation before enabling polling on each machine.");
  lines.push("  ✅ No-federation shared-room mode uses one dedicated bot/app identity per machine in a shared group/channel; non-target bots remain silent.");

  return redactSecrets(lines.join("\n").trimEnd());
}

export function relaySetupFallbackGuidance(channel: RelaySetupChannel): string {
  switch (channel) {
    case "telegram":
      return [
        "Telegram relay setup",
        "Set TELEGRAM_BOT_TOKEN or telegram.botToken in ~/.pi/agent/pirelay/config.json, or use a tokenEnv reference.",
        "Run /relay setup telegram, then /relay connect telegram.",
        "Pairing uses a private Telegram chat and local confirmation unless allowUserIds is configured.",
        "Shared-room mode: create one Telegram group/supergroup, invite one dedicated machine bot per broker, and disable bot privacy mode or use mentions/replies for addressed commands.",
      ].join("\n");
    case "discord":
      return [
        "Discord relay setup",
        "Create a Discord application/bot: https://discord.com/developers/docs/quick-start/getting-started",
        "Copy the bot token from the Bot settings, then set discord.botToken or PI_RELAY_DISCORD_BOT_TOKEN.",
        "Copy the Application ID from General Information, then set discord.applicationId (or clientId) or PI_RELAY_DISCORD_APPLICATION_ID (or PI_RELAY_DISCORD_CLIENT_ID) to print a bot invite URL.",
        "Developer Portal > Bot: enable Message Content Intent so DM text prompts are delivered to PiRelay.",
        "Invite scope: bot applications.commands. Use permissions=0 for DM-first operation.",
        "Keep Discord DM-first; set allowUserIds before enabling live control.",
        "Run /relay connect discord [name], then send the displayed /start code to the bot in a DM.",
        "Shared-room mode: use a dedicated Discord application/bot per machine in one server channel; prefer `relay <command>` text-prefix or @mention forms over collision-prone top-level slash commands.",
      ].join("\n");
    case "slack":
      return [
        "Slack relay setup",
        "Create a Slack app: https://api.slack.com/apps",
        "Install it to your workspace, then set slack.botToken or PI_RELAY_SLACK_BOT_TOKEN from the Bot User OAuth Token.",
        "Set slack.signingSecret or PI_RELAY_SLACK_SIGNING_SECRET from Basic Information > App Credentials.",
        "For DMs, enable App Home > Messages Tab > Allow users to send messages to your app, add the message.im event with im:history/im:read scopes, add reactions:write for thinking indicators, add files:write for image/file delivery, then reinstall the app.",
        "Use slack.eventMode=socket for local Pi, or webhook mode with raw-body signature verification.",
        "Keep Slack DM-first; set allowUserIds before enabling live control.",
        "Run /relay connect slack [name], then send the displayed `pirelay pair <code>` text to the app in a DM. Do not prefix it with `/`; Slack treats leading slash text as a slash command. Set slack.appId or PI_RELAY_SLACK_APP_ID to enable an App Home QR link.",
        "Shared-room mode: use a dedicated Slack app/bot per machine in one channel with app mention or channel-message scopes, and keep user allow-lists explicit.",
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
      return "Use /relay connect telegram to generate a Telegram deep link.";
    case "discord":
      return `Send relay pair ${code} to the Discord bot in a DM before the pairing expires. /start ${code} is also accepted.`;
    case "slack":
      return `Send pirelay pair ${code} to the Slack app in a DM before the pairing expires. Do not prefix it with /; Slack treats leading slash text as a slash command.`;
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
        discord?.botToken ? "  ✅ Discord bot token configured for live Gateway login" : "  ❌ Discord bot token missing",
        discord?.applicationId || discord?.clientId ? "  ✅ Discord Application ID configured for QR invite/open link" : "  ⚠️ Discord Application ID missing; QR redirect is unavailable",
        "  ℹ️ Developer Portal: enable Message Content Intent for plain DM prompts and invite with bot + applications.commands scopes",
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
        slack?.appId ? "  ✅ Slack App ID configured for App Home QR link" : "  ⚠️ Slack App ID missing; App Home QR link is unavailable",
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
  const applicationId = config.applicationId ?? config.clientId;
  if (!applicationId) findings.push({ channel: "discord", severity: "warning", code: "discord-application-id-missing", message: "Discord Application ID is missing; manual PIN pairing may work, but /relay connect discord cannot show the QR invite/open redirect." });
  if (applicationId && !isDiscordApplicationId(applicationId)) findings.push({ channel: "discord", severity: "warning", code: "discord-application-id-format", message: "Discord Application ID should be the numeric snowflake from Developer Portal > General Information. Do not use the bot token, public key, or client secret." });
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
  if ((config.eventMode ?? "socket") === "socket" && !config.appToken) findings.push({ channel: "slack", severity: "error", code: "slack-app-token-missing", message: "Slack Socket Mode requires slack.appToken/appTokenEnv or PI_RELAY_SLACK_APP_TOKEN with connections:write." });
  if (config.eventMode === "webhook" && !config.signingSecret) findings.push({ channel: "slack", severity: "error", code: "slack-webhook-secret-missing", message: "Slack webhook mode requires a signing secret for request validation." });
  if (!config.appId) findings.push({ channel: "slack", severity: "warning", code: "slack-app-id-missing", message: "Slack App ID is missing; manual pairing still works, but /relay connect slack cannot show the App Home QR link." });
  if ((config.allowUserIds ?? []).length === 0) findings.push({ channel: "slack", severity: "warning", code: "slack-allow-list-empty", message: "Slack allowUserIds is empty; restrict Slack users before enabling live control." });
  if (config.allowChannelMessages) findings.push({ channel: "slack", severity: "warning", code: "slack-channel-control-enabled", message: "Slack channel control is enabled. DM-first mode is safer; verify workspace and user authorization before use." });
  if (config.allowChannelMessages && !config.botUserId) findings.push({ channel: "slack", severity: "warning", code: "slack-bot-user-id-unknown", message: "Slack channel/shared-room control needs a known local bot user id from auth discovery or slack.botUserId for safe mention targeting." });
  if (config.sharedRoom?.enabled && !config.sharedRoom.roomHint) findings.push({ channel: "slack", severity: "warning", code: "slack-shared-room-hint-missing", message: "Slack shared-room mode is enabled without sharedRoom.roomHint; live tests and diagnostics cannot preflight channel membership." });
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
    "Set TELEGRAM_BOT_TOKEN or telegram.botToken in ~/.pi/agent/pirelay/config.json, or use a tokenEnv reference.",
    "In the interactive setup wizard, use tabs to inspect setup details; press c to copy placeholder env exports to the clipboard or w to write config from currently defined env vars without storing secret values.",
    "Run /relay setup telegram, then /relay connect telegram.",
    "Pairing uses a private Telegram chat and local confirmation unless allowUserIds is configured.",
    "Shared-room mode uses a Telegram group/supergroup with one dedicated bot per machine; ordinary unaddressed prompts require bot privacy mode/permissions that allow group messages, otherwise use mentions or replies.",
  ].join("\n");
}

function discordGuidance(config: DiscordRelayConfig | undefined): string {
  const lines = [
    "Discord relay setup",
    `Status: ${config?.enabled && config.botToken ? "enabled" : "disabled or incomplete"}`,
    "Create a Discord application/bot: https://discord.com/developers/docs/quick-start/getting-started",
    "Copy the bot token from the Bot settings, then set discord.botToken or PI_RELAY_DISCORD_BOT_TOKEN.",
    "Copy Application ID from General Information, then set discord.applicationId (or clientId) or PI_RELAY_DISCORD_APPLICATION_ID (or PI_RELAY_DISCORD_CLIENT_ID) so /relay connect discord can show a QR invite/open link.",
    "Developer Portal > Bot: enable Message Content Intent so DM text prompts are delivered to PiRelay.",
    "Invite scope: bot applications.commands with permissions=0 for DM-first operation.",
    "Keep Discord DM-first; set allowUserIds before enabling live control.",
    "In the interactive setup wizard, use tabs to inspect setup details; press c to copy placeholder env exports to the clipboard or w to write config from currently defined env vars without storing secret values.",
    "After inviting the bot to a server, DM it from the member list or server profile. If DM is unavailable, check Discord privacy settings for server member DMs.",
    "Shared-room mode uses one dedicated Discord application/bot per machine in a shared server channel; prefer `relay <command>` or @mention forms for reliable multi-bot routing.",
  ];
  const applicationId = config?.applicationId ?? config?.clientId;
  if (applicationId) {
    lines.push(`Invite URL: ${discordInviteUrl(applicationId)}`);
  } else {
    lines.push("Set discord.applicationId (or clientId) or PI_RELAY_DISCORD_APPLICATION_ID (or PI_RELAY_DISCORD_CLIENT_ID) from General Information > Application ID to enable the QR invite/open link.");
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
    "For DMs, enable App Home > Messages Tab > Allow users to send messages to your app, add the message.im event with im:history/im:read scopes, add reactions:write for thinking indicators, add files:write for image/file delivery, then reinstall the app.",
    "For Socket Mode, enable Socket Mode and set slack.appToken/appTokenEnv or PI_RELAY_SLACK_APP_TOKEN from an app-level token with connections:write.",
    `Event mode: ${mode}. ${mode === "socket" ? "Socket Mode is recommended for local Pi usage." : "Webhook mode must verify Slack signatures against the raw request body."}`,
    "Keep Slack DM-first; set allowUserIds before enabling live control.",
    "In the interactive setup wizard, use tabs to inspect setup details; press c to copy placeholder env exports to the clipboard or w to write config from currently defined env vars without storing secret values.",
    "Shared-room mode uses one dedicated Slack app/bot per machine in a shared channel with app mention or channel-message scopes; PiRelay discovers the local bot user id at startup or can use slack.botUserId as a non-secret fallback.",
    "Run /relay connect slack [name], then send the displayed `pirelay pair <code>` text to the app in a DM. Do not prefix it with `/`; Slack treats leading slash text as a slash command.",
  ].join("\n");
}

export function discordInviteUrl(applicationId: string): string {
  const normalizedApplicationId = String(applicationId).trim();
  const params = new URLSearchParams({ client_id: normalizedApplicationId, scope: "bot applications.commands", permissions: "0", integration_type: "0" });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export function discordBotChatUrl(applicationId: string): string {
  return `https://discord.com/users/${encodeURIComponent(String(applicationId).trim())}`;
}

export function slackAppRedirectUrl(appId: string, workspaceId?: string): string {
  const params = new URLSearchParams({ app: String(appId).trim() });
  const normalizedWorkspaceId = workspaceId?.trim();
  if (normalizedWorkspaceId) params.set("team", normalizedWorkspaceId);
  return `https://slack.com/app_redirect?${params.toString()}`;
}

function isDiscordApplicationId(value: string): boolean {
  return /^\d{15,25}$/.test(String(value).trim());
}

function channelStatus(config: TelegramTunnelConfig, channel: RelaySetupChannel): string {
  if (channel === "telegram") return config.botToken ? "enabled" : "missing token";
  if (channel === "discord") return config.discord?.enabled && config.discord.botToken ? "enabled" : "disabled or incomplete";
  return config.slack?.enabled && config.slack.botToken && config.slack.signingSecret ? "enabled" : "disabled or incomplete";
}

function normalizeSubcommand(value: string | undefined): RelayLocalCommandIntent["subcommand"] | undefined {
  if (value === "setup" || value === "connect" || value === "send-file" || value === "disconnect" || value === "status" || value === "doctor" || value === "trusted" || value === "untrust") return value;
  return undefined;
}

function isRelaySetupChannel(value: string): value is RelaySetupChannel {
  return (SUPPORTED_CHANNELS as string[]).includes(value);
}
