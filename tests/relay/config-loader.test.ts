import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalRelayConfigForWrite, loadRelayConfig, migrateRelayConfigPlan, planRelayConfigMigrationForEnv } from "../../extensions/relay/config/index.js";

async function writeConfig(value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  return path;
}

describe("relay config loader", () => {
  it("loads canonical namespaced messenger instances", async () => {
    const configPath = await writeConfig({
      relay: { machineId: "laptop", stateDir: "./state", brokerGroup: "personal" },
      defaults: { pairingExpiryMs: 60000, maxTextChars: 2000 },
      messengers: {
        telegram: {
          personal: { enabled: true, tokenEnv: "TG_PERSONAL", allowUserIds: ["1001"] },
          work: { enabled: false, tokenEnv: "TG_WORK" },
        },
        discord: {
          default: { enabled: true, tokenEnv: "DISCORD_TOKEN", clientId: "123" },
        },
      },
    });

    const loaded = await loadRelayConfig({
      configPath,
      env: { TG_PERSONAL: "telegram-token", DISCORD_TOKEN: "discord-token" },
    });

    expect(loaded.relay.machineId).toBe("laptop");
    expect(loaded.relay.aliases).toEqual([]);
    expect(loaded.relay.brokerGroup).toBe("personal");
    expect(loaded.defaults.pairingExpiryMs).toBe(60000);
    expect(loaded.messengers.map((messenger) => `${messenger.ref.kind}:${messenger.ref.instanceId}`).sort()).toEqual([
      "discord:default",
      "telegram:personal",
      "telegram:work",
    ]);
    expect(loaded.messengers.find((messenger) => messenger.ref.kind === "telegram" && messenger.ref.instanceId === "personal")?.token).toBe("telegram-token");
  });

  it("falls back to legacy environment variables with warnings", async () => {
    const configPath = await writeConfig({ relay: { machineId: "cloud" } });
    const loaded = await loadRelayConfig({
      configPath,
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
        PI_RELAY_DISCORD_BOT_TOKEN: "discord-token",
        PI_RELAY_SLACK_BOT_TOKEN: "slack-token",
        PI_RELAY_SLACK_SIGNING_SECRET: "slack-secret",
      },
    });

    expect(loaded.messengers.map((messenger) => `${messenger.ref.kind}:${messenger.ref.instanceId}`).sort()).toEqual([
      "discord:default",
      "slack:default",
      "telegram:default",
    ]);
    expect(loaded.warnings.some((warning) => warning.includes("legacy"))).toBe(true);
  });

  it("loads shared-room machine identity and messenger settings", async () => {
    const configPath = await writeConfig({
      relay: { machineId: "laptop", displayName: "Laptop", aliases: ["lap", "devbox"] },
      messengers: { telegram: { default: { tokenEnv: "TELEGRAM_TOKEN", sharedRoom: { enabled: true, plainText: "addressed-only", roomHint: "PiRelay" } } } },
    });

    const loaded = await loadRelayConfig({
      configPath,
      env: { TELEGRAM_TOKEN: "telegram-token", PI_RELAY_MACHINE_ALIASES: "macbook" },
    });

    expect(loaded.relay).toMatchObject({ machineId: "laptop", displayName: "Laptop", aliases: ["lap", "devbox", "macbook"] });
    expect(loaded.messengers[0]?.sharedRoom).toMatchObject({ enabled: true, plainText: "addressed-only", roomHint: "PiRelay" });
  });

  it("resolves Discord Application ID from applicationId and legacy clientId aliases", async () => {
    const appPath = await writeConfig({
      messengers: { discord: { default: { enabled: true, tokenEnv: "DISCORD_TOKEN", applicationId: "app-id" } } },
    });
    const appLoaded = await loadRelayConfig({ configPath: appPath, env: { DISCORD_TOKEN: "token" }, supportedMessengers: ["discord"] });
    expect(appLoaded.messengers[0]?.applicationId).toBe("app-id");
    expect(appLoaded.messengers[0]?.clientId).toBe("app-id");

    const aliasPath = await writeConfig({
      messengers: { discord: { default: { enabled: true, tokenEnv: "DISCORD_TOKEN", clientId: "client-alias" } } },
    });
    const aliasLoaded = await loadRelayConfig({ configPath: aliasPath, env: { DISCORD_TOKEN: "token" }, supportedMessengers: ["discord"] });
    expect(aliasLoaded.messengers[0]?.applicationId).toBe("client-alias");
    expect(aliasLoaded.messengers[0]?.clientId).toBe("client-alias");
  });

  it("canonicalizes legacy JSON without top-level env-style keys", () => {
    const canonical = canonicalRelayConfigForWrite({
      botToken: "telegram-token",
      TELEGRAM_BOT_TOKEN: "telegram-token-from-json",
      stateDir: "~/.pi/agent/telegram-tunnel",
      allowUserIds: [1001],
      PI_RELAY_DISCORD_BOT_TOKEN: "discord-token",
      PI_RELAY_SLACK_SIGNING_SECRET: "slack-secret",
      slack: { botToken: "slack-token" },
    });

    expect(canonical.botToken).toBeUndefined();
    expect(canonical.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(canonical.PI_RELAY_DISCORD_BOT_TOKEN).toBeUndefined();
    expect(canonical.messengers?.telegram?.default?.botToken).toBe("telegram-token");
    expect(canonical.messengers?.telegram?.default?.allowUserIds).toEqual(["1001"]);
    expect(canonical.messengers?.discord?.default?.botToken).toBe("discord-token");
    expect(canonical.messengers?.slack?.default?.botToken).toBe("slack-token");
    expect(canonical.messengers?.slack?.default?.signingSecret).toBe("slack-secret");
  });

  it("canonicalizes legacy env-style messenger settings into namespaced defaults", () => {
    const canonical = canonicalRelayConfigForWrite({
      TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      maxTelegramMessageChars: 2048,
      PI_RELAY_DISCORD_ENABLED: "true",
      PI_RELAY_DISCORD_BOT_TOKEN: "discord-token",
      PI_RELAY_DISCORD_ALLOW_USER_IDS: "u1,u2",
      PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS: "true",
      PI_RELAY_DISCORD_ALLOW_GUILD_IDS: "g1,g2",
      PI_RELAY_DISCORD_MAX_TEXT_CHARS: "1800",
      PI_RELAY_SLACK_ENABLED: "true",
      PI_RELAY_SLACK_BOT_TOKEN: "slack-token",
      PI_RELAY_SLACK_SIGNING_SECRET: "slack-secret",
      PI_RELAY_SLACK_EVENT_MODE: "webhook",
      PI_RELAY_SLACK_APP_ID: "A1",
      PI_RELAY_SLACK_WORKSPACE_ID: "T1",
      PI_RELAY_SLACK_ALLOW_USER_IDS: "s1,s2",
    });

    expect(canonical.defaults?.maxTextChars).toBe(2048);
    expect(canonical.messengers?.telegram?.default?.botToken).toBe("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(canonical.messengers?.discord?.default).toMatchObject({
      enabled: true,
      botToken: "discord-token",
      allowUserIds: ["u1", "u2"],
      allowGuildChannels: true,
      allowGuildIds: ["g1", "g2"],
      limits: { maxTextChars: 1800 },
    });
    expect(canonical.messengers?.slack?.default).toMatchObject({
      enabled: true,
      botToken: "slack-token",
      signingSecret: "slack-secret",
      eventMode: "webhook",
      appId: "A1",
      workspaceId: "T1",
      allowUserIds: ["s1", "s2"],
    });
  });

  it("plans and applies default legacy config migration when canonical config is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-migrate-"));
    const activePath = join(dir, "pirelay", "config.json");
    const legacyPath = join(dir, "telegram-tunnel", "config.json");
    await mkdir(join(dir, "telegram-tunnel"), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({
      TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      PI_RELAY_DISCORD_BOT_TOKEN: "discord-token",
    }), { mode: 0o600 });

    const plan = await planRelayConfigMigrationForEnv({}, { activePath, legacyPath });
    expect(plan).toMatchObject({
      sourcePath: legacyPath,
      targetPath: activePath,
      kind: "legacy-default-to-canonical",
      legacyKeys: ["PI_RELAY_DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"],
    });

    const result = await migrateRelayConfigPlan(plan!);
    expect(result.backupPath).toContain(`${legacyPath}.bak-`);
    const migrated = JSON.parse(await readFile(activePath, "utf8"));
    expect(migrated.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(migrated.messengers.telegram.default.botToken).toBe("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(migrated.messengers.discord.default.botToken).toBe("discord-token");
  });

  it("reports unsupported configured messengers without failing supported ones", async () => {
    const configPath = await writeConfig({
      relay: { machineId: "laptop" },
      messengers: {
        telegram: { default: { tokenEnv: "TELEGRAM_TOKEN" } },
        matrix: { default: { tokenEnv: "MATRIX_TOKEN" } },
      },
    });

    const loaded = await loadRelayConfig({
      configPath,
      env: { TELEGRAM_TOKEN: "telegram-token", MATRIX_TOKEN: "matrix-token" },
      supportedMessengers: ["telegram"],
    });

    expect(loaded.messengers).toHaveLength(2);
    expect(loaded.messengers.find((messenger) => messenger.ref.kind === "matrix")?.unsupported).toBe(true);
    expect(loaded.warnings.some((warning) => warning.includes("no adapter is installed"))).toBe(true);
  });
});
