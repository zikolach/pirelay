import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalizeRelayConfigFile } from "./legacy.js";
import { DEFAULT_PIRELAY_STATE_DIR, expandHome, getDefaultRelayConfigPath } from "./paths.js";
import type { MessengerInstanceFileConfig, RelayConfigFile } from "./schema.js";
import type { RelaySetupChannel } from "./setup.js";

export type RelaySetupEnvBindingKind = "secret-ref" | "string" | "string-list" | "boolean";

export interface RelaySetupEnvBinding {
  env: string;
  aliases?: string[];
  placeholder: string;
  configKeys: string[];
  kind: RelaySetupEnvBindingKind;
  required?: boolean;
  description: string;
}

export interface RelaySetupConfigPatch {
  channel: RelaySetupChannel;
  instanceId: "default";
  patch: MessengerInstanceFileConfig;
  changedFields: string[];
  missingRequiredEnvVars: string[];
  invalidEnvVars: string[];
  usedEnvVars: string[];
}

export interface RelaySetupConfigWriteResult extends RelaySetupConfigPatch {
  configPath: string;
  backupPath?: string;
}

export interface RelaySetupConfigPatchOptions {
  existingConfig?: RelayConfigFile;
  effectiveEventMode?: string;
}

const setupEnvBindings: Record<RelaySetupChannel, RelaySetupEnvBinding[]> = {
  telegram: [
    { env: "PI_RELAY_TELEGRAM_BOT_TOKEN", aliases: ["TELEGRAM_BOT_TOKEN"], placeholder: "123456789:AA…", configKeys: ["tokenEnv"], kind: "secret-ref", required: true, description: "Telegram bot token" },
    { env: "PI_RELAY_TELEGRAM_ALLOW_USER_IDS", aliases: ["PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS"], placeholder: "123456789", configKeys: ["allowUserIds"], kind: "string-list", description: "Telegram allow-listed user ids" },
  ],
  discord: [
    { env: "PI_RELAY_DISCORD_ENABLED", placeholder: "true", configKeys: ["enabled"], kind: "boolean", description: "Enable Discord relay" },
    { env: "PI_RELAY_DISCORD_BOT_TOKEN", placeholder: "MTIz…", configKeys: ["tokenEnv"], kind: "secret-ref", required: true, description: "Discord bot token" },
    { env: "PI_RELAY_DISCORD_APPLICATION_ID", aliases: ["PI_RELAY_DISCORD_CLIENT_ID"], placeholder: "123456789012345678", configKeys: ["applicationId", "clientId"], kind: "string", required: true, description: "Discord application id for invite/QR guidance" },
    { env: "PI_RELAY_DISCORD_ALLOW_USER_IDS", placeholder: "123456789012345678", configKeys: ["allowUserIds"], kind: "string-list", description: "Discord allow-listed user ids" },
    { env: "PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS", placeholder: "false", configKeys: ["allowGuildChannels"], kind: "boolean", description: "Allow Discord guild channel messages" },
    { env: "PI_RELAY_DISCORD_ALLOW_GUILD_IDS", placeholder: "987654321098765432", configKeys: ["allowGuildIds"], kind: "string-list", description: "Discord allowed guild ids" },
  ],
  slack: [
    { env: "PI_RELAY_SLACK_ENABLED", placeholder: "true", configKeys: ["enabled"], kind: "boolean", description: "Enable Slack relay" },
    { env: "PI_RELAY_SLACK_BOT_TOKEN", placeholder: "xoxb-…", configKeys: ["tokenEnv"], kind: "secret-ref", required: true, description: "Slack bot token" },
    { env: "PI_RELAY_SLACK_SIGNING_SECRET", placeholder: "8f742231b10e…", configKeys: ["signingSecretEnv"], kind: "secret-ref", required: true, description: "Slack signing secret" },
    { env: "PI_RELAY_SLACK_APP_TOKEN", placeholder: "xapp-…", configKeys: ["appTokenEnv"], kind: "secret-ref", required: true, description: "Slack Socket Mode app-level token" },
    { env: "PI_RELAY_SLACK_EVENT_MODE", placeholder: "socket", configKeys: ["eventMode"], kind: "string", description: "Slack event mode" },
    { env: "PI_RELAY_SLACK_APP_ID", placeholder: "A0123456789", configKeys: ["appId"], kind: "string", description: "Slack app id for App Home/DM QR links" },
    { env: "PI_RELAY_SLACK_WORKSPACE_ID", placeholder: "T0123456789", configKeys: ["workspaceId"], kind: "string", description: "Slack workspace id" },
    { env: "PI_RELAY_SLACK_BOT_USER_ID", placeholder: "U0123456789", configKeys: ["botUserId"], kind: "string", description: "Slack bot user id fallback" },
    { env: "PI_RELAY_SLACK_ALLOW_USER_IDS", placeholder: "U9876543210", configKeys: ["allowUserIds"], kind: "string-list", description: "Slack allow-listed user ids" },
    { env: "PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES", placeholder: "false", configKeys: ["allowChannelMessages"], kind: "boolean", description: "Allow Slack channel messages" },
  ],
};

export function setupEnvBindingsForChannel(channel: RelaySetupChannel): readonly RelaySetupEnvBinding[] {
  return setupEnvBindings[channel];
}

export function envSnippetForSetupChannel(channel: RelaySetupChannel): string[] {
  const title = channel[0]!.toUpperCase() + channel.slice(1);
  return [
    `# PiRelay ${title}`,
    ...setupEnvBindings[channel].map((binding) => `export ${binding.env}=${shellQuote(binding.placeholder)}`),
  ];
}

export function envSnippetTextForSetupChannel(channel: RelaySetupChannel): string {
  return `${envSnippetForSetupChannel(channel).join("\n")}\n`;
}

export function computeRelaySetupConfigPatchFromEnv(channel: RelaySetupChannel, env: NodeJS.ProcessEnv = process.env, options: RelaySetupConfigPatchOptions = {}): RelaySetupConfigPatch {
  const patch: Record<string, unknown> = {};
  const changedFields = new Set<string>();
  const missingRequiredEnvVars: string[] = [];
  const invalidEnvVars: string[] = [];
  const usedEnvVars: string[] = [];

  for (const binding of setupEnvBindings[channel]) {
    const resolved = resolveBindingEnv(binding, env);
    if (!resolved) {
      if (setupEnvBindingRequired(channel, binding, env, options)) missingRequiredEnvVars.push(binding.env);
      continue;
    }

    const parsed = parseBindingValue(binding, resolved.envName, resolved.value);
    if (!parsed.ok) {
      invalidEnvVars.push(resolved.envName);
      continue;
    }

    usedEnvVars.push(resolved.envName);
    for (const key of binding.configKeys) {
      patch[key] = parsed.value;
      changedFields.add(key);
    }
  }

  return {
    channel,
    instanceId: "default",
    patch: patch as MessengerInstanceFileConfig,
    changedFields: [...changedFields].sort(),
    missingRequiredEnvVars,
    invalidEnvVars,
    usedEnvVars,
  };
}

export function mergeRelaySetupConfigPatch(input: RelayConfigFile, patch: RelaySetupConfigPatch): RelayConfigFile {
  const canonical = canonicalizeRelayConfigFile(input);
  const messengers = { ...(canonical.messengers ?? {}) };
  const instances = { ...(messengers[patch.channel] ?? {}) };
  const current = { ...(instances.default ?? {}) };
  instances.default = { ...current, ...patch.patch };
  messengers[patch.channel] = instances;
  return JSON.parse(JSON.stringify({ ...canonical, messengers })) as RelayConfigFile;
}

export function resolveRelaySetupConfigPath(env: NodeJS.ProcessEnv = process.env, explicitPath?: string): string {
  return expandHome(explicitPath ?? env.PI_RELAY_CONFIG ?? env.PI_TELEGRAM_TUNNEL_CONFIG ?? getDefaultRelayConfigPath(DEFAULT_PIRELAY_STATE_DIR));
}

export async function writeRelaySetupConfigFromEnv(
  channel: RelaySetupChannel,
  options: { env?: NodeJS.ProcessEnv; configPath?: string; now?: Date } = {},
): Promise<RelaySetupConfigWriteResult> {
  const env = options.env ?? process.env;
  const configPath = resolveRelaySetupConfigPath(env, options.configPath);
  const existing = await readRelayConfigFile(configPath) ?? {};
  const patch = computeRelaySetupConfigPatchFromEnv(channel, env, { existingConfig: existing });
  const merged = mergeRelaySetupConfigPatch(existing, patch);
  const backupPath = await backupExistingConfig(configPath, options.now ?? new Date());
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  return { ...patch, configPath, backupPath };
}

async function readRelayConfigFile(configPath: string): Promise<RelayConfigFile | undefined> {
  try {
    await access(configPath, constants.R_OK);
  } catch {
    return undefined;
  }
  return JSON.parse(await readFile(configPath, "utf8")) as RelayConfigFile;
}

async function backupExistingConfig(configPath: string, now: Date): Promise<string | undefined> {
  try {
    await access(configPath, constants.F_OK);
  } catch {
    return undefined;
  }
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.bak-${stamp}`;
  await copyFile(configPath, backupPath, constants.COPYFILE_EXCL);
  return backupPath;
}

function resolveBindingEnv(binding: RelaySetupEnvBinding, env: NodeJS.ProcessEnv): { envName: string; value: string } | undefined {
  for (const envName of [binding.env, ...(binding.aliases ?? [])]) {
    const value = env[envName];
    if (value !== undefined && value !== "") return { envName, value };
  }
  return undefined;
}

function setupEnvBindingRequired(channel: RelaySetupChannel, binding: RelaySetupEnvBinding, env: NodeJS.ProcessEnv, options: RelaySetupConfigPatchOptions): boolean {
  if (!binding.required) return false;
  if (channel === "slack" && binding.env === "PI_RELAY_SLACK_APP_TOKEN") {
    return effectiveSlackEventMode(env, options) !== "webhook";
  }
  return true;
}

function effectiveSlackEventMode(env: NodeJS.ProcessEnv, options: RelaySetupConfigPatchOptions): "socket" | "webhook" {
  const rawMode = env.PI_RELAY_SLACK_EVENT_MODE ?? options.effectiveEventMode ?? existingSlackEventMode(options.existingConfig);
  return rawMode?.trim().toLowerCase() === "webhook" ? "webhook" : "socket";
}

function existingSlackEventMode(existingConfig: RelayConfigFile | undefined): string | undefined {
  if (!existingConfig) return undefined;
  const canonical = canonicalizeRelayConfigFile(existingConfig);
  return canonical.messengers?.slack?.default?.eventMode ?? canonical.slack?.eventMode ?? existingConfig.PI_RELAY_SLACK_EVENT_MODE;
}

function parseBindingValue(binding: RelaySetupEnvBinding, envName: string, value: string): { ok: true; value: unknown } | { ok: false } {
  switch (binding.kind) {
    case "secret-ref":
      return { ok: true, value: envName };
    case "string":
      return { ok: true, value };
    case "string-list":
      return { ok: true, value: value.split(",").map((part) => part.trim()).filter(Boolean) };
    case "boolean": {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return { ok: true, value: true };
      if (["0", "false", "no", "off"].includes(normalized)) return { ok: true, value: false };
      return { ok: false };
    }
  }
}

function shellQuote(value: string): string {
  return `"${value.replace(/[$`"\\]/g, "\\$&")}"`;
}
