import { describe, expect, it, vi } from "vitest";
import { buildRelaySetupWizardModel } from "../../extensions/relay/config/setup-wizard.js";
import { RelaySetupWizardScreen } from "../../extensions/relay/ui/setup-wizard.js";
import type { TelegramTunnelConfig } from "../../extensions/relay/core/types.js";

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

const theme = { fg: (_name: string, text: string) => text } as never;

describe("relay setup wizard model", () => {
  it("builds Telegram checklist and snippets without leaking tokens", () => {
    const config = baseConfig();
    config.botToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

    const model = buildRelaySetupWizardModel("telegram", config);
    const text = JSON.stringify(model);

    expect(model.title).toBe("Telegram setup");
    expect(model.checklist.map((item) => item.label)).toEqual(expect.arrayContaining(["Bot token", "Private chat pairing", "Allow-list or trusted users"]));
    expect(model.panels.find((panel) => panel.id === "links")?.qrUrl).toBe("https://t.me/BotFather");
    expect(text).toContain("BotFather");
    expect(text).toContain("/relay connect telegram");
    expect(text).not.toContain("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });

  it("builds Discord checklist with applicationId QR link and secret-safe snippets", () => {
    const config = baseConfig();
    config.discord = { enabled: true, botToken: "discord-token-supersecret", applicationId: "123456789012345678", allowUserIds: ["u1"] };

    const model = buildRelaySetupWizardModel("discord", config);
    const links = model.panels.find((panel) => panel.id === "links");
    const text = JSON.stringify(model);

    expect(model.checklist.map((item) => item.label)).toEqual(expect.arrayContaining(["Bot token", "Application ID", "Message Content Intent", "Shared server and DMs"]));
    expect(links?.qrUrl).toContain("https://discord.com/oauth2/authorize");
    expect(text).toContain("PI_RELAY_DISCORD_APPLICATION_ID");
    expect(text).not.toContain("discord-token-supersecret");
  });

  it("builds Slack checklist for secrets, workspace, mode, and safety", () => {
    const config = baseConfig();
    config.slack = { enabled: true, botToken: "xoxb-super-secret-token", signingSecret: "slack-signing-secret-super", eventMode: "webhook", allowChannelMessages: true };

    const model = buildRelaySetupWizardModel("slack", config);
    const text = JSON.stringify(model);

    expect(model.checklist.map((item) => item.label)).toEqual(expect.arrayContaining(["Bot token", "Signing secret", "Workspace boundary", "Event mode", "DM-first safety", "Allow-list"]));
    expect(text).toContain("PI_RELAY_SLACK_SIGNING_SECRET");
    expect(text).not.toContain("xoxb-super-secret-token");
    expect(text).not.toContain("slack-signing-secret-super");
  });
});

describe("RelaySetupWizardScreen", () => {
  it("renders setup wizard rows within width and navigates panels", () => {
    const config = baseConfig();
    config.discord = { enabled: true, botToken: "discord-token-test", applicationId: "123456789012345678" };
    const model = buildRelaySetupWizardModel("discord", config);
    const done = vi.fn();
    const screen = new RelaySetupWizardScreen(model, theme, done);

    const first = screen.render(72);
    expect(first.join("\n")).toContain("Discord setup");
    expect(first.join("\n")).toContain("Diagnostics");
    expect(first.join("\n")).toContain("Readiness checks");
    expect(first.join("\n")).toContain("Env snippet");
    expect(first.every((line) => line.length <= 72)).toBe(true);

    screen.handleInput("j");
    const second = screen.render(72).join("\n");
    expect(second).toContain("PI_RELAY_DISCORD_BOT_TOKEN");

    screen.handleInput("q");
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("preserves JSON snippet formatting in the TUI details panel", () => {
    const config = baseConfig();
    config.discord = { enabled: true, botToken: "discord-token-test", applicationId: "123456789012345678" };
    const model = buildRelaySetupWizardModel("discord", config);
    const screen = new RelaySetupWizardScreen(model, theme, vi.fn());

    screen.handleInput("j");
    screen.handleInput("j");
    const text = screen.render(100).join("\n");

    expect(text).toContain("Config snippet");
    expect(text).toContain('{');
    expect(text).toContain('  "messengers"');
    expect(text).toContain('    "discord"');
    expect(text).toContain('      "default"');
  });

  it("combines checklist details into diagnostics without full doctor summary", () => {
    const config = baseConfig();
    config.discord = { enabled: true, botToken: "discord-token-test" };
    const model = buildRelaySetupWizardModel("discord", config);
    const screen = new RelaySetupWizardScreen(model, theme, vi.fn());
    const text = screen.render(100).join("\n");

    expect(model.panels.map((panel) => panel.id)).not.toContain("checklist");
    expect(model.panels.map((panel) => panel.id)).not.toContain("doctor");
    expect(text).not.toContain("Checklist");
    expect(text).toContain("Readiness checks");
    expect(text).toContain("Application ID");
    expect(JSON.stringify(model.panels)).not.toContain("Relay setup doctor");
  });
});
