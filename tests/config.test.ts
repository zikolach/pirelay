import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTelegramTunnelConfig } from "../extensions/relay/config/tunnel-config.js";

const tempDirs: string[] = [];

beforeEach(() => {
  for (const name of [
    "TELEGRAM_BOT_TOKEN",
    "PI_RELAY_TELEGRAM_BOT_TOKEN",
    "PI_RELAY_DISCORD_BOT_TOKEN",
    "PI_RELAY_DISCORD_CLIENT_ID",
    "PI_RELAY_DISCORD_APPLICATION_ID",
    "PI_RELAY_SLACK_BOT_TOKEN",
    "PI_RELAY_SLACK_SIGNING_SECRET",
    "PI_RELAY_SLACK_APP_TOKEN",
    "PI_RELAY_SLACK_APP_ID",
    "PI_RELAY_SLACK_EVENT_MODE",
    "PI_RELAY_SLACK_WORKSPACE_ID",
    "PI_RELAY_SLACK_BOT_USER_ID",
  ]) vi.stubEnv(name, undefined);
});

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

  it("loads canonical Telegram token env fallback before config exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    vi.stubEnv("PI_RELAY_CONFIG", join(dir, "missing-config.json"));
    vi.stubEnv("PI_RELAY_TELEGRAM_BOT_TOKEN", "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.botToken).toBe("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });

  it("prefers canonical Telegram token env over legacy alias", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    vi.stubEnv("PI_RELAY_CONFIG", join(dir, "missing-config.json"));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "111111:ABCDEFGHIJKLMNOPQRSTUVWXYZ111111");
    vi.stubEnv("PI_RELAY_TELEGRAM_BOT_TOKEN", "222222:ABCDEFGHIJKLMNOPQRSTUVWXYZ222222");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.botToken).toBe("222222:ABCDEFGHIJKLMNOPQRSTUVWXYZ222222");
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
      PI_RELAY_SLACK_APP_TOKEN: "xapp-file-env-style",
      PI_RELAY_SLACK_EVENT_MODE: "webhook",
      PI_RELAY_SLACK_WORKSPACE_ID: "T-file",
      PI_RELAY_SLACK_BOT_USER_ID: "U-file",
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
      appToken: "xapp-file-env-style",
      workspaceId: "T-file",
      botUserId: "U-file",
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
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-env");
    vi.stubEnv("PI_RELAY_DISCORD_CLIENT_ID", "client-env");
    vi.stubEnv("PI_RELAY_DISCORD_ALLOW_USER_IDS", "u1,u2");
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "slack-env");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "secret-env");
    vi.stubEnv("PI_RELAY_SLACK_APP_TOKEN", "xapp-env");
    vi.stubEnv("PI_RELAY_SLACK_APP_ID", "A-env");
    vi.stubEnv("PI_RELAY_SLACK_WORKSPACE_ID", "T-env");
    vi.stubEnv("PI_RELAY_SLACK_BOT_USER_ID", "U-env");
    vi.stubEnv("PI_RELAY_SLACK_EVENT_MODE", "webhook");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.discord).toMatchObject({ enabled: true, botToken: "discord-env", clientId: "client-env", allowUserIds: ["u1", "u2"] });
    expect(config.slack).toMatchObject({ enabled: true, botToken: "slack-env", signingSecret: "secret-env", appToken: "xapp-env", appId: "A-env", workspaceId: "T-env", botUserId: "U-env", eventMode: "webhook" });
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
        slack: { default: { botToken: "slack-file", signingSecretEnv: "SLACK_SECRET", appTokenEnv: "SLACK_APP_TOKEN", appId: "A-canonical", eventMode: "webhook", workspaceId: "T-canonical", botUserId: "U-canonical" } },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", configPath);
    vi.stubEnv("DISCORD_TOKEN", "discord-env-token");
    vi.stubEnv("SLACK_SECRET", "slack-env-secret");
    vi.stubEnv("SLACK_APP_TOKEN", "xapp-canonical");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.stateDir).toBe(dir);
    expect(config.busyDeliveryMode).toBe("steer");
    expect(config.pairingExpiryMs).toBe(60000);
    expect(config.maxTelegramMessageChars).toBe(2000);
    expect(config.allowUserIds).toEqual([1001]);
    expect(config.discord).toMatchObject({ enabled: true, botToken: "discord-env-token", clientId: "client-canonical", maxTextChars: 1500 });
    expect(config.slack).toMatchObject({ enabled: true, botToken: "slack-file", signingSecret: "slack-env-secret", appToken: "xapp-canonical", appId: "A-canonical", eventMode: "webhook", workspaceId: "T-canonical", botUserId: "U-canonical" });
  });

  it("rejects invalid delegation policy in runtime compatibility loader", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      messengers: {
        telegram: { default: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", delegation: { enabled: true, autonomy: "free-for-all" } } },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", configPath);

    await expect(loadTelegramTunnelConfig()).rejects.toThrow(/delegation\.autonomy/);
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

  it("preserves non-default Discord and Slack messenger instances for the live runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      messengers: {
        telegram: { default: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" } },
        discord: {
          personal: { enabled: true, botToken: "discord-personal", applicationId: "111111111111111111" },
          work: { enabled: true, tokenEnv: "DISCORD_WORK", applicationId: "222222222222222222" },
        },
        slack: {
          team: { enabled: true, botToken: "slack-team", signingSecret: "slack-secret", workspaceId: "T1" },
        },
      },
    }));
    vi.stubEnv("PI_RELAY_CONFIG", configPath);
    vi.stubEnv("DISCORD_WORK", "discord-work");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.discordInstances).toMatchObject({
      personal: { botToken: "discord-personal", applicationId: "111111111111111111" },
      work: { botToken: "discord-work", applicationId: "222222222222222222" },
    });
    expect(config.discord).toMatchObject({ botToken: "discord-personal" });
    expect(config.slackInstances).toMatchObject({ team: { botToken: "slack-team", signingSecret: "slack-secret" } });
  });
});
