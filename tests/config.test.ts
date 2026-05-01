import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTelegramTunnelConfig } from "../extensions/telegram-tunnel/config.js";

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

  it("loads Discord and Slack config namespaces without mixing secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      discord: { botToken: "discord-file", allowUserIds: ["u-file"] },
      slack: { botToken: "slack-file", signingSecret: "secret-file", workspaceId: "T-file" },
    }));
    vi.stubEnv("PI_TELEGRAM_TUNNEL_CONFIG", configPath);
    vi.stubEnv("PI_RELAY_DISCORD_BOT_TOKEN", "discord-env");
    vi.stubEnv("PI_RELAY_DISCORD_ALLOW_USER_IDS", "u1,u2");
    vi.stubEnv("PI_RELAY_SLACK_BOT_TOKEN", "slack-env");
    vi.stubEnv("PI_RELAY_SLACK_SIGNING_SECRET", "secret-env");
    vi.stubEnv("PI_RELAY_SLACK_WORKSPACE_ID", "T-env");

    const { config } = await loadTelegramTunnelConfig();

    expect(config.discord).toMatchObject({ enabled: true, botToken: "discord-env", allowUserIds: ["u1", "u2"] });
    expect(config.slack).toMatchObject({ enabled: true, botToken: "slack-env", signingSecret: "secret-env", workspaceId: "T-env" });
    expect(config.botToken).toBe("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });
});
