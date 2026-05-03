import type { DiscordRelayConfig, SlackRelayConfig, TelegramTunnelConfig } from "../core/types.js";
import { discordInviteUrl, redactSecrets, relayChannelReady, relaySetupDiagnostics, relaySetupGuidance, type RelaySetupChannel, type RelaySetupFacts, type RelaySetupFinding, type RelaySetupSeverity } from "./setup.js";

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

export interface RelayAdapterSetupMetadata {
  channel: RelaySetupChannel;
  title: string;
  requiredCredentials: string[];
  optionalCredentials?: string[];
  platformLinks: Array<{ label: string; url: string }>;
  safetyNotes: string[];
}

export interface RelaySetupWizardModel {
  channel: RelaySetupChannel;
  title: string;
  status: "ready" | "needs-attention" | "incomplete";
  statusLabel: string;
  checklist: RelaySetupWizardChecklistItem[];
  panels: RelaySetupWizardPanel[];
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
      };
    case "discord":
      return {
        channel,
        title: "Discord setup",
        requiredCredentials: ["PI_RELAY_DISCORD_BOT_TOKEN or discord.tokenEnv", "PI_RELAY_DISCORD_APPLICATION_ID (or PI_RELAY_DISCORD_CLIENT_ID) or discord.applicationId (or clientId)"],
        platformLinks: [{ label: "Discord Developer Portal", url: "https://discord.com/developers/docs/quick-start/getting-started" }],
        safetyNotes: ["Enable Message Content Intent for DM text prompts.", "The bot and user generally need to share a server before DMs work.", "Use allowUserIds or local trusted users before enabling broad control."],
      };
    case "slack":
      return {
        channel,
        title: "Slack setup",
        requiredCredentials: ["PI_RELAY_SLACK_BOT_TOKEN or slack.tokenEnv", "PI_RELAY_SLACK_SIGNING_SECRET or slack.signingSecretEnv"],
        optionalCredentials: ["slack.workspaceId"],
        platformLinks: [{ label: "Slack apps", url: "https://api.slack.com/apps" }],
        safetyNotes: ["Socket Mode is recommended for local Pi usage.", "Keep Slack DM-first unless channel messages are explicitly required.", "Use allowUserIds and workspaceId boundaries for safety."],
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
    checklistItem("Workspace boundary", Boolean(config?.workspaceId), "Set slack.workspaceId to restrict the app to the expected workspace.", { warningWhenFalse: true }),
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

function envSnippetForChannel(channel: RelaySetupChannel): string[] {
  switch (channel) {
    case "telegram":
      return ["# Telegram", "export TELEGRAM_BOT_TOKEN=<telegram-bot-token>"];
    case "discord":
      return ["# Discord", "export PI_RELAY_DISCORD_ENABLED=true", "export PI_RELAY_DISCORD_BOT_TOKEN=<discord-bot-token>", "export PI_RELAY_DISCORD_APPLICATION_ID=<discord-application-id>"];
    case "slack":
      return ["# Slack", "export PI_RELAY_SLACK_ENABLED=true", "export PI_RELAY_SLACK_BOT_TOKEN=<slack-bot-token>", "export PI_RELAY_SLACK_SIGNING_SECRET=<slack-signing-secret>"];
  }
}

function jsonSnippetForChannel(channel: RelaySetupChannel): string[] {
  switch (channel) {
    case "telegram":
      return [
        JSON.stringify({ messengers: { telegram: { default: { enabled: true, tokenEnv: "TELEGRAM_BOT_TOKEN", allowUserIds: ["<telegram-user-id>"] } } } }, null, 2),
      ];
    case "discord":
      return [
        JSON.stringify({ messengers: { discord: { default: { enabled: true, tokenEnv: "PI_RELAY_DISCORD_BOT_TOKEN", applicationId: "<discord-application-id>", allowUserIds: ["<discord-user-id>"] } } } }, null, 2),
      ];
    case "slack":
      return [
        JSON.stringify({ messengers: { slack: { default: { enabled: true, tokenEnv: "PI_RELAY_SLACK_BOT_TOKEN", signingSecretEnv: "PI_RELAY_SLACK_SIGNING_SECRET", workspaceId: "<workspace-id>", allowUserIds: ["<slack-user-id>"] } } } }, null, 2),
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
    { id: "env", label: "Env snippet", lines: envSnippetForChannel(channel) },
    { id: "json", label: "Config snippet", lines: jsonSnippetForChannel(channel) },
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
