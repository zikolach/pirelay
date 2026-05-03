import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTelegramTunnelConfig } from "../extensions/relay/config/tunnel-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("telegram tunnel config", () => {
  it("normalizes progress mode values loaded from config files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      progressMode: "completion-only",
    }));
    vi.stubEnv("PI_TELEGRAM_TUNNEL_CONFIG", configPath);

    const { config } = await loadTelegramTunnelConfig();

    expect(config.progressMode).toBe("completionOnly");
  });

  it("loads top-level env-style Discord and Slack keys from config files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      PI_RELAY_DISCORD_BOT_TOKEN: "discord-file-env-style",
      PI_RELAY_DISCORD_CLIENT_ID: "discord-client-file",
      PI_RELAY_DISCORD_ALLOW_USER_IDS: "u1,u2",
      PI_RELAY_SLACK_BOT_TOKEN: "slack-file-env-style",
      PI_RELAY_SLACK_SIGNING_SECRET: "slack-secret-file-env-style",
      PI_RELAY_SLACK_EVENT_MODE: "webhook",
      PI_RELAY_SLACK_WORKSPACE_ID: "T-file",
    }));
    vi.stubEnv("PI_TELEGRAM_TUNNEL_CONFIG", configPath);

    const { config } = await loadTelegramTunnelConfig();

    expect(config.discord).toMatchObject({
      enabled: true,
      botToken: "discord-file-env-style",
      clientId: "discord-client-file",
      allowUserIds: ["u1", "u2"],
    });
    expect(config.slack).toMatchObject({
      enabled: true,
      botToken: "slack-file-env-style",
      signingSecret: "slack-secret-file-env-style",
      workspaceId: "T-file",
      eventMode: "webhook",
    });
  });

  it("loads Discord and Slack config namespaces without mixing secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      discord: { botToken: "discord-file", clientId: "client-file", allowUserIds: ["u-file"] },
      slack: { botToken: "slack-file", signingSecret: "secret-file", workspaceId: "T-file", eventMode: "webhook" },
    }));
    vi.stubEnv("PI_TELEGRAM_TUNNEL_CONFIG", configPath);
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-env");
    vi.stubEnv("PI_RELAY_DISCORD_CLIENT_ID", "client-env");
    vi.stubEnv("PI_RELAY_DISCORD_ALLOW_USER_IDS", "u1,u2");
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "slack-env");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "secret-env");
    vi.stubEnv("PI_RELAY_SLACK_WORKSPACE_ID", "T-env");
    vi.stubEnv("PI_RELAY_SLACK_EVENT_MODE", "webhook");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.discord).toMatchObject({ enabled: true, botToken: "discord-env", clientId: "client-env", allowUserIds: ["u1", "u2"] });
    expect(config.slack).toMatchObject({ enabled: true, botToken: "slack-env", signingSecret: "secret-env", workspaceId: "T-env", eventMode: "webhook" });
    expect(config.botToken).toBe("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });

  it("loads canonical namespaced config through the runtime compatibility loader", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      relay: { stateDir: dir },
      defaults: { pairingExpiryMs: 60000, busyDeliveryMode: "steer", maxTextChars: 2000 },
      messengers: {
        telegram: { default: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", allowUserIds: ["1001"] } },
        discord: { default: { enabled: true, tokenEnv: "DISCORD_TOKEN", clientId: "client-canonical", limits: { maxTextChars: 1500 } } },
        slack: { default: { botToken: "slack-file", signingSecretEnv: "SLACK_SECRET", eventMode: "webhook", workspaceId: "T-canonical" } },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", configPath);
    vi.stubEnv("DISCORD_TOKEN", "discord-env-token");
    vi.stubEnv("SLACK_SECRET", "slack-env-secret");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.stateDir).toBe(dir);
    expect(config.busyDeliveryMode).toBe("steer");
    expect(config.pairingExpiryMs).toBe(60000);
    expect(config.maxTelegramMessageChars).toBe(2000);
    expect(config.allowUserIds).toEqual([1001]);
    expect(config.discord).toMatchObject({ enabled: true, botToken: "discord-env-token", clientId: "client-canonical", maxTextChars: 1500 });
    expect(config.slack).toMatchObject({ enabled: true, botToken: "slack-file", signingSecret: "slack-env-secret", eventMode: "webhook", workspaceId: "T-canonical" });
  });

  it("accepts Discord applicationId as the preferred Application ID field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      messengers: {
        telegram: { default: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" } },
        discord: { default: { enabled: true, botToken: "discord-file", applicationId: "app-123" } },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", configPath);

    const { config } = await loadTelegramTunnelConfig();

    expect(config.discord).toMatchObject({ applicationId: "app-123", clientId: "app-123" });
  });
});
