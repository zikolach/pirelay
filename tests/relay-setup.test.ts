import { describe, expect, it } from "vitest";
import {
  completeRelayLocalCommand,
  discordInviteUrl,
  parseRelayLocalCommand,
  redactSecrets,
  relayChannelReady,
  relayPairingInstruction,
  relaySetupDiagnostics,
  relaySetupFallbackGuidance,
  relaySetupGuidance,
  renderRelayDoctorReport,
} from "../extensions/relay/config/setup.js";
import type { TelegramTunnelConfig } from "../extensions/relay/core/types.js";

function baseConfig(): TelegramTunnelConfig {
  return {
    botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    configPath: "/tmp/config.json",
    stateDir: "/tmp/pirelay",
    pairingExpiryMs: 300_000,
    busyDeliveryMode: "followUp",
    allowUserIds: [],
    summaryMode: "deterministic",
    maxTelegramMessageChars: 3900,
    sendRetryCount: 1,
    sendRetryBaseMs: 1,
    pollingTimeoutSeconds: 1,
    redactionPatterns: [],
    maxInboundImageBytes: 1024,
    maxOutboundImageBytes: 1024,
    maxLatestImages: 4,
    allowedImageMimeTypes: ["image/png"],
  };
}

describe("relay setup wizard helpers", () => {
  it("completes nested relay setup/connect channels", () => {
    expect(completeRelayLocalCommand("con")).toEqual(["connect"]);
    expect(completeRelayLocalCommand("connect ")).toEqual(["connect telegram", "connect discord", "connect slack"]);
    expect(completeRelayLocalCommand("connect di")).toEqual(["connect discord"]);
    expect(completeRelayLocalCommand("setup sl")).toEqual(["setup slack"]);
    expect(completeRelayLocalCommand("send-file ")).toEqual(["send-file all", "send-file telegram", "send-file discord", "send-file slack"]);
    expect(completeRelayLocalCommand("connect di", { compatibilityCommand: true })).toBeNull();
  });

  it("parses generic and compatibility local commands", () => {
    expect(parseRelayLocalCommand("setup discord")).toEqual({ subcommand: "setup", channel: "discord", messengerRef: "discord:default", args: "" });
    expect(parseRelayLocalCommand("connect slack:work docs team")).toEqual({ subcommand: "connect", channel: "slack", messengerRef: "slack:work", args: "docs team" });
    expect(parseRelayLocalCommand("connect docs", { compatibilityCommand: true })).toEqual({ subcommand: "connect", channel: "telegram", args: "docs" });
    expect(parseRelayLocalCommand("send-file slack:work docs/proposal.md OpenSpec proposal")).toEqual({ subcommand: "send-file", sendFileTarget: "slack:work", sendFilePath: "docs/proposal.md", sendFileCaption: "OpenSpec proposal", args: "docs/proposal.md OpenSpec proposal" });
    expect(parseRelayLocalCommand("send-file all README.md")).toMatchObject({ subcommand: "send-file", sendFileTarget: "all", sendFilePath: "README.md" });
    expect(parseRelayLocalCommand("send-file slack: README.md")).toMatchObject({ subcommand: "send-file", unsupportedChannel: "slack:" });
    expect(parseRelayLocalCommand("connect slack:")).toMatchObject({ subcommand: "connect", unsupportedChannel: "slack:" });
    expect(parseRelayLocalCommand("setup matrix")).toMatchObject({ subcommand: "setup", unsupportedChannel: "matrix" });
    expect(parseRelayLocalCommand("doctor")).toEqual({ subcommand: "doctor", args: "" });
  });

  it("renders secret-safe doctor output and permission diagnostics", () => {
    const config = baseConfig();
    config.discord = { enabled: true, botToken: "discord-token-supersecret", allowGuildChannels: true, allowGuildIds: [] };
    config.slack = { enabled: true, botToken: "xoxb-super-secret-token", signingSecret: "slack-signing-secret-super", eventMode: "webhook", allowChannelMessages: true };

    const findings = relaySetupDiagnostics(config, { configFileMode: 0o644, stateDirMode: 0o755 });
    const report = renderRelayDoctorReport(config, findings);

    expect(report).toContain("✅ Discord bot token configured");
    expect(report).toContain("⚠️ Discord Application ID missing; QR redirect is unavailable");
    expect(report).toContain("❌ Discord guild-channel control needs explicit allowed guild ids");
    expect(report).toContain("Discord guild-channel control is enabled");
    expect(report).toContain("Shared checks");
    expect(report).toContain("Broker topology");
    expect(report).toContain("⚠️ Config file is group/world readable");
    expect(report).not.toContain("  ! ");
    expect(report).not.toContain("xoxb-super-secret-token");
    expect(report).not.toContain("discord-token-supersecret");
    expect(redactSecrets("token xoxb-super-secret-token and 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456")).not.toContain("xoxb-super");
  });

  it("generates platform setup guidance and invite URLs", () => {
    const config = baseConfig();
    config.discord = { enabled: true, botToken: "discord-token", clientId: "12345", allowUserIds: ["u1"] };
    config.slack = { enabled: true, botToken: "xoxb-token", signingSecret: "secret", workspaceId: "T1", eventMode: "socket", allowUserIds: ["U1"] };

    expect(relaySetupGuidance("telegram", config)).toContain("https://core.telegram.org/bots/features#botfather");
    expect(relaySetupGuidance("telegram", config)).toContain("TELEGRAM_BOT_TOKEN");
    expect(relaySetupGuidance("discord", config)).toContain("https://discord.com/developers/docs/quick-start/getting-started");
    expect(relaySetupGuidance("discord", config)).toContain("Application ID");
    expect(relaySetupGuidance("discord", config)).toContain("https://discord.com/oauth2/authorize");
    expect(relaySetupGuidance("slack", config)).toContain("https://api.slack.com/apps");
    expect(relaySetupGuidance("slack", config)).toContain("Socket Mode is recommended");
    expect(relaySetupFallbackGuidance("discord")).toContain("PI_RELAY_DISCORD_BOT_TOKEN");
    expect(relaySetupFallbackGuidance("slack")).toContain("https://api.slack.com/apps");
    expect(relayPairingInstruction("discord", "abc")).toContain("relay pair abc");
    expect(relayPairingInstruction("discord", "abc")).toContain("/start abc");
    expect(relayPairingInstruction("slack", "abc")).toContain("pirelay pair abc");
  });

  it("builds Discord invite URLs from trimmed Application IDs for guild bot install", () => {
    const url = discordInviteUrl(" 123456789012345678 ");
    expect(url).toContain("client_id=123456789012345678");
    expect(url).toContain("scope=bot+applications.commands");
    expect(url).toContain("permissions=0");
    expect(url).toContain("integration_type=0");
  });

  it("detects missing credentials and unsafe channel modes", () => {
    const config = baseConfig();
    config.discord = { enabled: true, allowGuildChannels: true };
    config.slack = { enabled: true, botToken: "xoxb-token", eventMode: "webhook" };

    const findings = relaySetupDiagnostics(config);
    expect(findings).toContainEqual(expect.objectContaining({ channel: "discord", severity: "error", code: "discord-token-missing" }));
    expect(findings).toContainEqual(expect.objectContaining({ channel: "discord", severity: "error", code: "discord-guild-ids-missing" }));
    expect(findings).toContainEqual(expect.objectContaining({ channel: "slack", severity: "error", code: "slack-signing-secret-missing" }));
    expect(relayChannelReady(config, "discord")).toBe(false);
    expect(relayChannelReady(config, "slack")).toBe(false);
  });

  it("warns when Discord Application ID does not look like a numeric snowflake", () => {
    const config = baseConfig();
    config.discord = { enabled: true, botToken: "discord-token", applicationId: "not-a-snowflake" };

    const findings = relaySetupDiagnostics(config);

    expect(findings).toContainEqual(expect.objectContaining({ channel: "discord", severity: "warning", code: "discord-application-id-format" }));
  });
});
