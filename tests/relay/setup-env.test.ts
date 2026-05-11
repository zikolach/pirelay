import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeRelaySetupConfigPatchFromEnv, envSnippetForSetupChannel, mergeRelaySetupConfigPatch, setupEnvBindingsForChannel, writeRelaySetupConfigFromEnv } from "../../extensions/relay/config/setup-env.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pirelay-setup-env-"));
  tempDirs.push(dir);
  return join(dir, "config.json");
}

describe("relay setup env metadata", () => {
  it("uses the same env metadata for snippets and config patches", () => {
    for (const channel of ["telegram", "discord", "slack"] as const) {
      const metadataEnvNames = setupEnvBindingsForChannel(channel).map((binding) => binding.env).sort();
      const snippet = envSnippetForSetupChannel(channel).join("\n");
      for (const envName of metadataEnvNames) expect(snippet).toContain(envName);
    }
  });

  it("renders placeholder env snippets without resolved secret values", () => {
    const snippet = envSnippetForSetupChannel("slack").join("\n");

    expect(snippet).toContain("xoxb-…");
    expect(snippet).toContain("xapp-…");
    expect(snippet).toContain("PI_RELAY_SLACK_APP_TOKEN");
    expect(snippet).toContain("PI_RELAY_SLACK_APP_ID");
    expect(snippet).toContain("A0123456789");
    expect(snippet).not.toContain("xoxb-secret");
    expect(snippet).not.toContain("xapp-secret");
  });
});

describe("relay setup config from env", () => {
  it("computes secret env references and parsed non-secret values", () => {
    const patch = computeRelaySetupConfigPatchFromEnv("slack", {
      PI_RELAY_SLACK_BOT_TOKEN: "xoxb-secret-token",
      PI_RELAY_SLACK_SIGNING_SECRET: "slack-signing-secret-value",
      PI_RELAY_SLACK_APP_TOKEN: "xapp-secret-token",
      PI_RELAY_SLACK_APP_ID: "A1",
      PI_RELAY_SLACK_WORKSPACE_ID: "T1",
      PI_RELAY_SLACK_ALLOW_USER_IDS: "U1,U2",
      PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES: "true",
    });

    expect(patch.missingRequiredEnvVars).toEqual([]);
    expect(patch.patch).toMatchObject({
      tokenEnv: "PI_RELAY_SLACK_BOT_TOKEN",
      signingSecretEnv: "PI_RELAY_SLACK_SIGNING_SECRET",
      appTokenEnv: "PI_RELAY_SLACK_APP_TOKEN",
      appId: "A1",
      workspaceId: "T1",
      allowUserIds: ["U1", "U2"],
      allowChannelMessages: true,
    });
    expect(JSON.stringify(patch)).not.toContain("xoxb-secret-token");
    expect(JSON.stringify(patch)).not.toContain("slack-signing-secret-value");
    expect(JSON.stringify(patch)).not.toContain("xapp-secret-token");
  });

  it("reports missing required env vars and invalid booleans", () => {
    const patch = computeRelaySetupConfigPatchFromEnv("discord", { PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS: "sometimes" });

    expect(patch.missingRequiredEnvVars).toEqual(["PI_RELAY_DISCORD_BOT_TOKEN", "PI_RELAY_DISCORD_APPLICATION_ID"]);
    expect(patch.invalidEnvVars).toEqual(["PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS"]);
  });

  it("requires Slack app token only for Socket Mode setup", () => {
    const base = {
      PI_RELAY_SLACK_BOT_TOKEN: "xoxb-secret-token",
      PI_RELAY_SLACK_SIGNING_SECRET: "slack-signing-secret-value",
    };

    expect(computeRelaySetupConfigPatchFromEnv("slack", base).missingRequiredEnvVars).toEqual(["PI_RELAY_SLACK_APP_TOKEN"]);
    expect(computeRelaySetupConfigPatchFromEnv("slack", { ...base, PI_RELAY_SLACK_EVENT_MODE: "socket" }).missingRequiredEnvVars).toEqual(["PI_RELAY_SLACK_APP_TOKEN"]);
    expect(computeRelaySetupConfigPatchFromEnv("slack", { ...base, PI_RELAY_SLACK_EVENT_MODE: "webhook" }).missingRequiredEnvVars).toEqual([]);
  });

  it("uses legacy Telegram aliases when canonical env vars are absent", () => {
    const patch = computeRelaySetupConfigPatchFromEnv("telegram", {
      TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS: "1001,1002",
    });

    expect(patch.patch).toMatchObject({ tokenEnv: "TELEGRAM_BOT_TOKEN", allowUserIds: ["1001", "1002"] });
    expect(JSON.stringify(patch)).not.toContain("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });

  it("merges env-derived config while preserving unrelated settings", () => {
    const patch = computeRelaySetupConfigPatchFromEnv("discord", {
      PI_RELAY_DISCORD_BOT_TOKEN: "discord-secret",
      PI_RELAY_DISCORD_APPLICATION_ID: "123",
    });
    const merged = mergeRelaySetupConfigPatch({
      relay: { machineId: "laptop", aliases: ["lap"] },
      defaults: { maxTextChars: 2000 },
      messengers: {
        telegram: { default: { tokenEnv: "TELEGRAM_TOKEN" } },
        discord: { work: { tokenEnv: "DISCORD_WORK" }, default: { allowUserIds: ["u1"] } },
      },
    }, patch);

    expect(merged.relay).toMatchObject({ machineId: "laptop", aliases: ["lap"] });
    expect(merged.defaults?.maxTextChars).toBe(2000);
    expect(merged.messengers?.telegram?.default?.tokenEnv).toBe("TELEGRAM_TOKEN");
    expect(merged.messengers?.discord?.work?.tokenEnv).toBe("DISCORD_WORK");
    expect(merged.messengers?.discord?.default).toMatchObject({ tokenEnv: "PI_RELAY_DISCORD_BOT_TOKEN", applicationId: "123", clientId: "123", allowUserIds: ["u1"] });
  });

  it("writes new config files with owner-only permissions", async () => {
    const configPath = await tempConfigPath();
    const result = await writeRelaySetupConfigFromEnv("slack", {
      configPath,
      env: {
        PI_RELAY_SLACK_BOT_TOKEN: "xoxb-secret-token",
        PI_RELAY_SLACK_SIGNING_SECRET: "slack-signing-secret-value",
        PI_RELAY_SLACK_APP_TOKEN: "xapp-secret-token",
        PI_RELAY_SLACK_APP_ID: "A1",
        PI_RELAY_SLACK_WORKSPACE_ID: "T1",
      },
    });

    const written = await readFile(configPath, "utf8");
    expect(result.backupPath).toBeUndefined();
    expect(written).toContain("PI_RELAY_SLACK_BOT_TOKEN");
    expect(written).not.toContain("xoxb-secret-token");
    expect(written).not.toContain("slack-signing-secret-value");
    expect(written).not.toContain("xapp-secret-token");
    expect((await stat(configPath)).mode & 0o077).toBe(0);
  });

  it("backs up existing config before writing", async () => {
    const configPath = await tempConfigPath();
    await writeFile(configPath, JSON.stringify({ relay: { machineId: "old" } }), { mode: 0o600 });

    const result = await writeRelaySetupConfigFromEnv("telegram", {
      configPath,
      now: new Date("2026-05-11T10:00:00.000Z"),
      env: { PI_RELAY_TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" },
    });

    expect(result.backupPath).toBe(`${configPath}.bak-2026-05-11T10-00-00-000Z`);
    await expect(readFile(result.backupPath!, "utf8")).resolves.toContain("old");
    const written = await readFile(configPath, "utf8");
    expect(written).toContain("PI_RELAY_TELEGRAM_BOT_TOKEN");
    expect(written).not.toContain("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });
});
