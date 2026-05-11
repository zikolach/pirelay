import type { DiscordRelayConfig, SlackRelayConfig, TelegramTunnelConfig } from "../core/types.js";
import { discordInviteUrl, redactSecrets, relayChannelReady, relaySetupDiagnostics, relaySetupGuidance, slackAppRedirectUrl, type RelaySetupChannel, type RelaySetupFacts, type RelaySetupFinding, type RelaySetupSeverity } from "./setup.js";
import { envSnippetForSetupChannel, setupEnvBindingsForChannel, type RelaySetupEnvBinding } from "./setup-env.js";

export type RelaySetupWizardItemStatus = RelaySetupSeverity | "info";

export interface RelaySetupWizardChecklistItem {
  label: string;
  status: RelaySetupWizardItemStatus;
  detail?: string;
}

export interface RelaySetupWizardPanel {
  id: string;
  label: string;
  lines: string[];
  qrUrl?: string;
}

export type RelaySetupWizardActionId = "copy-env-snippet" | "copy-slack-manifest" | "write-config-from-env";

export interface RelaySetupWizardAction {
  id: RelaySetupWizardActionId;
  label: string;
  detail: string;
}

export interface RelayAdapterSetupMetadata {
  channel: RelaySetupChannel;
  title: string;
  requiredCredentials: string[];
  optionalCredentials?: string[];
  platformLinks: Array<{ label: string; url: string }>;
  safetyNotes: string[];
  envBindings: readonly RelaySetupEnvBinding[];
}

export interface RelaySetupWizardModel {
  channel: RelaySetupChannel;
  title: string;
  status: "ready" | "needs-attention" | "incomplete";
  statusLabel: string;
  checklist: RelaySetupWizardChecklistItem[];
  panels: RelaySetupWizardPanel[];
  actions: RelaySetupWizardAction[];
  nextSteps: string[];
  findings: RelaySetupFinding[];
  metadata: RelayAdapterSetupMetadata;
}

function statusFromFindings(findings: RelaySetupFinding[], ready: boolean): RelaySetupWizardModel["status"] {
  if (findings.some((finding) => finding.severity === "error")) return "needs-attention";
  return ready ? "ready" : "incomplete";
}

function statusLabel(status: RelaySetupWizardModel["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs-attention":
      return "Needs attention";
    case "incomplete":
      return "Incomplete";
  }
}

function checklistItem(label: string, ok: boolean, detail: string, options: { warningWhenFalse?: boolean } = {}): RelaySetupWizardChecklistItem {
  return { label, status: ok ? "ok" : options.warningWhenFalse ? "warning" : "error", detail };
}

export function setupMetadataForChannel(channel: RelaySetupChannel): RelayAdapterSetupMetadata {
  switch (channel) {
    case "telegram":
      return {
        channel,
        title: "Telegram setup",
        requiredCredentials: ["TELEGRAM_BOT_TOKEN or telegram.tokenEnv"],
        platformLinks: [
          { label: "BotFather chat", url: "https://t.me/BotFather" },
          { label: "BotFather docs", url: "https://core.telegram.org/bots/features#botfather" },
        ],
        safetyNotes: ["Pair in a private Telegram chat.", "Use allowUserIds or local trusted users to avoid repeated local confirmation."],
        envBindings: setupEnvBindingsForChannel(channel),
      };
    case "discord":
      return {
        channel,
        title: "Discord setup",
        requiredCredentials: ["PI_RELAY_DISCORD_BOT_TOKEN or discord.tokenEnv", "PI_RELAY_DISCORD_APPLICATION_ID (or PI_RELAY_DISCORD_CLIENT_ID) or discord.applicationId (or clientId)"],
        platformLinks: [{ label: "Discord Developer Portal", url: "https://discord.com/developers/docs/quick-start/getting-started" }],
        safetyNotes: ["Enable Message Content Intent for DM text prompts.", "The bot and user generally need to share a server before DMs work.", "Use allowUserIds or local trusted users before enabling broad control."],
        envBindings: setupEnvBindingsForChannel(channel),
      };
    case "slack":
      return {
        channel,
        title: "Slack setup",
        requiredCredentials: ["PI_RELAY_SLACK_BOT_TOKEN or slack.tokenEnv", "PI_RELAY_SLACK_SIGNING_SECRET or slack.signingSecretEnv", "PI_RELAY_SLACK_APP_TOKEN or slack.appTokenEnv for Socket Mode"],
        optionalCredentials: ["slack.appId for App Home QR links", "slack.workspaceId", "slack.botUserId fallback"],
        platformLinks: [{ label: "Slack apps", url: "https://api.slack.com/apps" }],
        safetyNotes: ["Socket Mode is recommended for local Pi usage.", "Enable App Home Messages Tab for Slack app DMs.", "Keep Slack DM-first unless channel messages are explicitly required.", "Use allowUserIds and workspaceId boundaries for safety."],
        envBindings: setupEnvBindingsForChannel(channel),
      };
  }
}

function telegramChecklist(config: TelegramTunnelConfig): RelaySetupWizardChecklistItem[] {
  return [
    checklistItem("Bot token", Boolean(config.botToken), "Set TELEGRAM_BOT_TOKEN or messengers.telegram.default.tokenEnv."),
    checklistItem("Private chat pairing", true, "Run /relay connect telegram and open the Telegram deep link/QR."),
    checklistItem("Allow-list or trusted users", config.allowUserIds.length > 0, "Configured allowUserIds skips repeated local confirmation; trusted users can also be added from pairing approval.", { warningWhenFalse: true }),
  ];
}

function discordChecklist(config: DiscordRelayConfig | undefined): RelaySetupWizardChecklistItem[] {
  return [
    checklistItem("Bot token", Boolean(config?.enabled && config.botToken), "Set PI_RELAY_DISCORD_BOT_TOKEN or messengers.discord.default.tokenEnv."),
    checklistItem("Application ID", Boolean(config?.applicationId ?? config?.clientId), "Copy Developer Portal > General Information > Application ID to PI_RELAY_DISCORD_APPLICATION_ID or discord.applicationId. clientId remains accepted as an alias.", { warningWhenFalse: true }),
    checklistItem("Message Content Intent", true, "Enable Developer Portal > Bot > Privileged Gateway Intents > Message Content Intent."),
    checklistItem("Shared server and DMs", true, "Invite the bot to a server you share, then open a DM. Check server member DM privacy settings if DM fails."),
    checklistItem("Allow-list or trusted users", Boolean(config?.allowUserIds?.length), "Use allowUserIds or local trusted users before enabling broad Discord control.", { warningWhenFalse: true }),
  ];
}

function slackChecklist(config: SlackRelayConfig | undefined): RelaySetupWizardChecklistItem[] {
  return [
    checklistItem("Bot token", Boolean(config?.enabled && config.botToken), "Set PI_RELAY_SLACK_BOT_TOKEN or messengers.slack.default.tokenEnv."),
    checklistItem("Signing secret", Boolean(config?.signingSecret), "Set PI_RELAY_SLACK_SIGNING_SECRET or slack.signingSecretEnv."),
    checklistItem("Socket Mode app token", config?.eventMode === "webhook" || Boolean(config?.appToken), "Set PI_RELAY_SLACK_APP_TOKEN or slack.appTokenEnv to an app-level token with connections:write."),
    checklistItem("App Home messages", true, "In Slack app settings, enable App Home > Messages Tab > Allow users to send messages to your app; add message.im with im:history, im:read, and reactions:write scopes, then reinstall."),
    checklistItem("App ID", Boolean(config?.appId), "Optional: set PI_RELAY_SLACK_APP_ID or slack.appId to show an App Home QR link for /relay connect slack.", { warningWhenFalse: true }),
    checklistItem("Workspace boundary", Boolean(config?.workspaceId), "Set slack.workspaceId to restrict the app to the expected workspace.", { warningWhenFalse: true }),
    checklistItem("Bot user id", Boolean(config?.botUserId), "Optional fallback; runtime normally discovers bot user id via auth.test.", { warningWhenFalse: true }),
    checklistItem("Event mode", true, `Current mode: ${config?.eventMode ?? "socket"}. Socket Mode is recommended for local Pi usage.`),
    checklistItem("DM-first safety", !config?.allowChannelMessages, "Keep channel messages disabled unless explicitly needed.", { warningWhenFalse: true }),
    checklistItem("Allow-list", Boolean(config?.allowUserIds?.length), "Set allowUserIds before enabling broad Slack control.", { warningWhenFalse: true }),
  ];
}

function checklistForChannel(channel: RelaySetupChannel, config: TelegramTunnelConfig): RelaySetupWizardChecklistItem[] {
  switch (channel) {
    case "telegram":
      return telegramChecklist(config);
    case "discord":
      return discordChecklist(config.discord);
    case "slack":
      return slackChecklist(config.slack);
  }
}

export function slackAppManifestSnippet(): string[] {
  return [
    "display_information:",
    "  name: PiRelay",
    "  description: Remote control and monitor Pi sessions from Slack.",
    "  background_color: \"#2f855a\"",
    "features:",
    "  app_home:",
    "    home_tab_enabled: false",
    "    messages_tab_enabled: true",
    "    messages_tab_read_only_enabled: false",
    "  bot_user:",
    "    display_name: PiRelay",
    "    always_online: false",
    "oauth_config:",
    "  scopes:",
    "    bot:",
    "      - app_mentions:read",
    "      - channels:history",
    "      - channels:read",
    "      - chat:write",
    "      - files:read",
    "      - groups:history",
    "      - groups:read",
    "      - im:history",
    "      - im:read",
    "      - reactions:write",
    "settings:",
    "  event_subscriptions:",
    "    bot_events:",
    "      - app_mention",
    "      - message.channels",
    "      - message.groups",
    "      - message.im",
    "  interactivity:",
    "    is_enabled: true",
    "  org_deploy_enabled: false",
    "  socket_mode_enabled: true",
    "  token_rotation_enabled: false",
  ];
}

export function slackAppManifestText(): string {
  return `${slackAppManifestSnippet().join("\n")}\n`;
}

function jsonSnippetForChannel(channel: RelaySetupChannel): string[] {
  switch (channel) {
    case "telegram":
      return [
        JSON.stringify({ messengers: { telegram: { default: { enabled: true, tokenEnv: "TELEGRAM_BOT_TOKEN", allowUserIds: ["123456789"] } } } }, null, 2),
      ];
    case "discord":
      return [
        JSON.stringify({ messengers: { discord: { default: { enabled: true, tokenEnv: "PI_RELAY_DISCORD_BOT_TOKEN", applicationId: "123456789012345678", allowUserIds: ["123456789012345678"] } } } }, null, 2),
      ];
    case "slack":
      return [
        JSON.stringify({ messengers: { slack: { default: { enabled: true, tokenEnv: "PI_RELAY_SLACK_BOT_TOKEN", signingSecretEnv: "PI_RELAY_SLACK_SIGNING_SECRET", appTokenEnv: "PI_RELAY_SLACK_APP_TOKEN", appId: "A0123456789", workspaceId: "T0123456789", allowUserIds: ["U9876543210"] } } } }, null, 2),
      ];
  }
}

function linkPanel(channel: RelaySetupChannel, config: TelegramTunnelConfig, metadata: RelayAdapterSetupMetadata): RelaySetupWizardPanel {
  const lines = metadata.platformLinks.map((link) => `${link.label}: ${link.url}`);
  let qrUrl: string | undefined;
  const discordApplicationId = config.discord?.applicationId ?? config.discord?.clientId;
  if (channel === "telegram") {
    qrUrl = "https://t.me/BotFather";
    lines.push("", "Scan the QR code to open BotFather and create or manage the Telegram bot token.");
  } else if (channel === "discord" && discordApplicationId) {
    qrUrl = discordInviteUrl(discordApplicationId);
    lines.push("", `Discord invite/open URL: ${qrUrl}`, "Invite with bot scope and permissions=0 for DM-first operation.");
  } else if (channel === "discord") {
    lines.push("", "Discord QR redirect unavailable until Application ID is configured.");
  } else if (channel === "slack") {
    if (config.slack?.appId) {
      qrUrl = slackAppRedirectUrl(config.slack.appId, config.slack.workspaceId);
      lines.push("", `Slack App Home URL: ${qrUrl}`, "Scan the QR code to open the app in Slack, then use the Messages tab to send the pairing command.");
    } else {
      lines.push("", "Slack App Home QR unavailable until Slack App ID is configured. Set PI_RELAY_SLACK_APP_ID or slack.appId from Basic Information > App Credentials > App ID.");
    }
    lines.push("Enable App Home > Messages Tab > Allow users to send messages to your app; add message.im with im:history/im:read scopes, add reactions:write for thinking indicators, and reinstall the app if Slack says sending messages is turned off.");
  }
  return { id: "links", label: qrUrl ? "Links / QR" : "Links", lines: lines.map(redactSecrets), qrUrl };
}

function troubleshootingLines(channel: RelaySetupChannel): string[] {
  switch (channel) {
    case "telegram":
      return ["If pairing fails, regenerate with /relay connect telegram.", "Pairing must happen in a private chat with the bot.", "If allowUserIds is empty, Pi will ask for local confirmation."];
    case "discord":
      return ["If DM fails, ensure you and the bot share a server and DMs from server members are allowed.", "Enable Message Content Intent for plain DM prompts and relay text commands.", "Use relay pair <pin> in DMs; /start <pin> is accepted as a compatibility alias."];
    case "slack":
      return ["Install the app to your workspace before pairing.", "Socket Mode is recommended for local Pi usage.", "Keep channel-message control disabled unless explicitly needed and authorized."];
  }
}

function nextStepsForChannel(channel: RelaySetupChannel): string[] {
  return [`Run /relay doctor to verify setup.`, `Run /relay connect ${channel} [name] to pair this Pi session.`];
}

function diagnosticPanelLines(checklist: RelaySetupWizardChecklistItem[], findings: RelaySetupFinding[]): string[] {
  const actionable = findings.filter((finding) => finding.severity !== "ok");
  const checklistLines = [
    "Readiness checks:",
    ...checklist.map((item) => `- ${item.status}: ${item.label}${item.detail ? ` — ${item.detail}` : ""}`),
  ];
  if (actionable.length === 0) {
    return [
      ...checklistLines,
      "",
      "No additional setup issues detected for this messenger. Run /relay doctor for the full machine-level report.",
    ];
  }
  return [
    ...checklistLines,
    "",
    "Actionable findings:",
    ...actionable.map((finding) => `- ${finding.severity}: ${finding.message}`),
    "",
    "Run /relay doctor for the full machine-level report.",
  ];
}

export function buildRelaySetupWizardModel(channel: RelaySetupChannel, config: TelegramTunnelConfig, options: { facts?: RelaySetupFacts; findings?: RelaySetupFinding[] } = {}): RelaySetupWizardModel {
  const metadata = setupMetadataForChannel(channel);
  const findings = options.findings ?? relaySetupDiagnostics(config, options.facts).filter((finding) => finding.channel === channel || finding.channel === "all");
  const checklist = checklistForChannel(channel, config);
  const status = statusFromFindings(findings, relayChannelReady(config, channel));
  const panels: RelaySetupWizardPanel[] = [
    { id: "diagnostics", label: "Diagnostics", lines: diagnosticPanelLines(checklist, findings) },
    { id: "env", label: "Env snippet", lines: envSnippetForSetupChannel(channel) },
    { id: "json", label: "Config snippet", lines: jsonSnippetForChannel(channel) },
    ...(channel === "slack" ? [{ id: "manifest", label: "App manifest", lines: slackAppManifestSnippet() }] : []),
    linkPanel(channel, config, metadata),
    { id: "troubleshooting", label: "Troubleshooting", lines: troubleshootingLines(channel) },
  ];

  return {
    channel,
    title: metadata.title,
    status,
    statusLabel: statusLabel(status),
    checklist,
    panels: panels.map((panel) => ({ ...panel, lines: panel.lines.map((line) => redactSecrets(line)) })),
    actions: [
      { id: "copy-env-snippet", label: "Copy env snippet to clipboard", detail: "Copy placeholder shell exports for pasting into your shell profile." },
      ...(channel === "slack" ? [{ id: "copy-slack-manifest" as const, label: "Copy Slack app manifest", detail: "Copy a secret-free Slack app manifest for pasting into Slack's manifest editor." }] : []),
      { id: "write-config-from-env", label: "Write config from env", detail: "Update PiRelay config using currently defined environment variables without storing secret values." },
    ],
    nextSteps: nextStepsForChannel(channel),
    findings,
    metadata,
  };
}

export function renderRelaySetupWizardFallback(model: RelaySetupWizardModel, config: TelegramTunnelConfig): string {
  return redactSecrets([
    relaySetupGuidance(model.channel, config),
    "",
    "Setup checklist:",
    ...model.checklist.map((item) => `- ${item.status}: ${item.label}${item.detail ? ` — ${item.detail}` : ""}`),
    "",
    "Next steps:",
    ...model.nextSteps.map((step) => `- ${step}`),
  ].join("\n"));
}
