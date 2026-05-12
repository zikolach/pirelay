import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DEFAULT_PIRELAY_STATE_DIR, expandHome, getDefaultRelayConfigPath, LEGACY_TELEGRAM_TUNNEL_STATE_DIR } from "./paths.js";
import { canonicalizeRelayConfigFile, hasLegacyRelayConfigKeys } from "./legacy.js";
import { DEFAULT_MESSENGER_INSTANCE_ID, isValidMessengerInstanceId, isValidMessengerKind } from "../core/messenger-ref.js";
import type { MessengerKind, MessengerRef } from "../core/messenger-ref.js";
import type { MessengerIngressPolicy } from "../broker/protocol.js";
import type { MessengerInstanceFileConfig, RelayConfigFile, RelayConfigLoadOptions, RelayDefaultsConfig, RelayMachineConfig, ResolvedMessengerInstanceConfig, ResolvedRelayConfig } from "./schema.js";
import { RelayConfigError } from "./schema.js";

const defaultSupportedMessengers = ["telegram", "discord", "slack"] as const;

const defaultDefaults: RelayDefaultsConfig = {
  pairingExpiryMs: 5 * 60_000,
  busyDeliveryMode: "followUp",
  maxTextChars: 3900,
  maxInboundImageBytes: 10 * 1024 * 1024,
  maxOutboundImageBytes: 10 * 1024 * 1024,
  allowedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

function parseStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function resolveConfigPath(env: NodeJS.ProcessEnv, explicitPath?: string): string {
  return expandHome(explicitPath ?? env.PI_RELAY_CONFIG ?? env.PI_TELEGRAM_TUNNEL_CONFIG ?? getDefaultRelayConfigPath(DEFAULT_PIRELAY_STATE_DIR));
}

async function readConfigFile(configPath: string): Promise<RelayConfigFile | undefined> {
  try {
    await access(configPath, constants.R_OK);
  } catch {
    return undefined;
  }
  return JSON.parse(await readFile(configPath, "utf8")) as RelayConfigFile;
}

async function collectPermissionWarning(configPath: string, warnings: string[]): Promise<void> {
  try {
    const info = await stat(configPath);
    if ((info.mode & 0o077) !== 0) warnings.push(`Config file ${configPath} is group/world readable. Run chmod 600 to protect relay secrets.`);
  } catch {
    // Ignore missing files and stat failures for diagnostics.
  }
}

function envToken(env: NodeJS.ProcessEnv, kind: string): string | undefined {
  if (kind === "telegram") return env.TELEGRAM_BOT_TOKEN;
  if (kind === "discord") return env.PI_RELAY_DISCORD_BOT_TOKEN;
  if (kind === "slack") return env.PI_RELAY_SLACK_BOT_TOKEN;
  return undefined;
}

function envSigningSecret(env: NodeJS.ProcessEnv, kind: string): string | undefined {
  if (kind === "slack") return env.PI_RELAY_SLACK_SIGNING_SECRET;
  return undefined;
}

function envAppToken(env: NodeJS.ProcessEnv, kind: string): string | undefined {
  if (kind === "slack") return env.PI_RELAY_SLACK_APP_TOKEN;
  return undefined;
}

function envBotUserId(env: NodeJS.ProcessEnv, kind: string): string | undefined {
  if (kind === "slack") return env.PI_RELAY_SLACK_BOT_USER_ID;
  return undefined;
}

function envApplicationId(env: NodeJS.ProcessEnv, kind: string): string | undefined {
  if (kind === "discord") return env.PI_RELAY_DISCORD_APPLICATION_ID ?? env.PI_RELAY_DISCORD_CLIENT_ID;
  if (kind === "slack") return env.PI_RELAY_SLACK_APP_ID;
  return undefined;
}

function envAllowUserIds(env: NodeJS.ProcessEnv, kind: string): string[] | undefined {
  if (kind === "telegram") return parseStringList(env.PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS);
  if (kind === "discord") return parseStringList(env.PI_RELAY_DISCORD_ALLOW_USER_IDS);
  if (kind === "slack") return parseStringList(env.PI_RELAY_SLACK_ALLOW_USER_IDS);
  return undefined;
}

function relayMachineAliases(fileConfig: RelayConfigFile, env: NodeJS.ProcessEnv): string[] {
  const fileAliases = Array.isArray(fileConfig.relay?.aliases) ? fileConfig.relay.aliases : [];
  const envAliases = parseStringList(env.PI_RELAY_MACHINE_ALIASES) ?? [];
  return [...new Set([...fileAliases, ...envAliases].map((alias) => alias.trim()).filter(Boolean))];
}

function resolveSecret(env: NodeJS.ProcessEnv, value: string | undefined, envName: string | undefined): string | undefined {
  if (value) return value;
  if (envName) return env[envName];
  return undefined;
}

function normalizePolicy(config: MessengerInstanceFileConfig, relay: RelayMachineConfig): MessengerIngressPolicy {
  if (config.ingressPolicy) return config.ingressPolicy;
  if (config.ownerMachineId) return { kind: "owner", machineId: config.ownerMachineId };
  if (relay.brokerGroup) return { kind: "auto" };
  return { kind: "auto" };
}

function ensureValidDefaults(defaults: RelayDefaultsConfig): void {
  if (defaults.pairingExpiryMs < 30_000) throw new RelayConfigError("defaults.pairingExpiryMs must be at least 30000.");
  if (defaults.busyDeliveryMode !== "followUp" && defaults.busyDeliveryMode !== "steer") throw new RelayConfigError("defaults.busyDeliveryMode must be followUp or steer.");
  if (defaults.maxTextChars < 256) throw new RelayConfigError("defaults.maxTextChars must be at least 256.");
  if (defaults.allowedImageMimeTypes.length === 0) throw new RelayConfigError("defaults.allowedImageMimeTypes must include at least one MIME type.");
}

function resolveMessengerInstance(input: {
  ref: MessengerRef;
  config: MessengerInstanceFileConfig;
  defaults: RelayDefaultsConfig;
  relay: RelayMachineConfig;
  env: NodeJS.ProcessEnv;
  supportedMessengers: readonly MessengerKind[];
  warnings: string[];
}): ResolvedMessengerInstanceConfig {
  const { ref, config, defaults, relay, env, supportedMessengers, warnings } = input;
  const token = resolveSecret(env, config.botToken ?? config.token, config.tokenEnv) ?? envToken(env, ref.kind);
  const signingSecret = resolveSecret(env, config.signingSecret, config.signingSecretEnv) ?? envSigningSecret(env, ref.kind);
  const appToken = resolveSecret(env, config.appToken, config.appTokenEnv) ?? envAppToken(env, ref.kind);
  const usedLegacyTokenEnv = !config.botToken && !config.token && !config.tokenEnv && Boolean(envToken(env, ref.kind));
  if (usedLegacyTokenEnv) warnings.push(`Using legacy environment token fallback for ${ref.kind}:${ref.instanceId}; prefer a namespaced PiRelay messenger config with tokenEnv.`);

  const unsupported = !supportedMessengers.includes(ref.kind);
  const enabled = config.enabled ?? Boolean(token || signingSecret);
  const limits = {
    maxTextChars: config.limits?.maxTextChars ?? defaults.maxTextChars,
    maxFileBytes: config.limits?.maxFileBytes ?? defaults.maxOutboundImageBytes,
    allowedImageMimeTypes: config.limits?.allowedImageMimeTypes ?? defaults.allowedImageMimeTypes,
  };

  if (limits.maxTextChars < 256) throw new RelayConfigError(`${ref.kind}:${ref.instanceId} limits.maxTextChars must be at least 256.`);
  if (limits.maxFileBytes < 1) throw new RelayConfigError(`${ref.kind}:${ref.instanceId} limits.maxFileBytes must be positive.`);
  if (limits.allowedImageMimeTypes.length === 0) throw new RelayConfigError(`${ref.kind}:${ref.instanceId} limits.allowedImageMimeTypes must not be empty.`);

  return {
    ref,
    enabled,
    displayName: config.displayName ?? `${ref.kind}:${ref.instanceId}`,
    token,
    tokenEnv: config.tokenEnv,
    signingSecret,
    signingSecretEnv: config.signingSecretEnv,
    appToken,
    appTokenEnv: config.appTokenEnv,
    appId: config.appId ?? config.applicationId ?? envApplicationId(env, ref.kind),
    botUserId: config.botUserId ?? envBotUserId(env, ref.kind),
    applicationId: config.applicationId ?? config.clientId ?? envApplicationId(env, ref.kind),
    clientId: config.clientId ?? config.applicationId ?? envApplicationId(env, ref.kind),
    eventMode: config.eventMode,
    workspaceId: config.workspaceId,
    allowUserIds: envAllowUserIds(env, ref.kind) ?? config.allowUserIds ?? [],
    allowGuildChannels: config.allowGuildChannels,
    allowGuildIds: config.allowGuildIds ?? [],
    allowChannelMessages: config.allowChannelMessages,
    sharedRoom: config.sharedRoom ?? {},
    ingressPolicy: normalizePolicy(config, relay),
    ownerMachineId: config.ownerMachineId,
    brokerGroup: config.brokerGroup ?? relay.brokerGroup,
    limits,
    unsupported,
  };
}

function addDefaultEnvMessengers(fileConfig: RelayConfigFile, env: NodeJS.ProcessEnv): RelayConfigFile {
  const canonical = canonicalizeRelayConfigFile(fileConfig);
  const messengers = canonical.messengers ?? {};
  canonical.messengers = messengers;
  const ensure = (kind: "telegram" | "discord" | "slack"): MessengerInstanceFileConfig => {
    messengers[kind] = messengers[kind] ?? {};
    messengers[kind][DEFAULT_MESSENGER_INSTANCE_ID] = messengers[kind][DEFAULT_MESSENGER_INSTANCE_ID] ?? {};
    return messengers[kind][DEFAULT_MESSENGER_INSTANCE_ID];
  };

  if (!messengers.telegram?.default && env.TELEGRAM_BOT_TOKEN) ensure("telegram").tokenEnv = "TELEGRAM_BOT_TOKEN";
  if (!messengers.discord?.default && env.PI_RELAY_DISCORD_BOT_TOKEN) ensure("discord").tokenEnv = "PI_RELAY_DISCORD_BOT_TOKEN";
  if (!messengers.slack?.default && (env.PI_RELAY_SLACK_BOT_TOKEN || env.PI_RELAY_SLACK_SIGNING_SECRET || env.PI_RELAY_SLACK_APP_TOKEN || env.PI_RELAY_SLACK_APP_ID || env.PI_RELAY_SLACK_BOT_USER_ID)) {
    const slack = ensure("slack");
    if (env.PI_RELAY_SLACK_BOT_TOKEN) slack.tokenEnv = "PI_RELAY_SLACK_BOT_TOKEN";
    if (env.PI_RELAY_SLACK_SIGNING_SECRET) slack.signingSecretEnv = "PI_RELAY_SLACK_SIGNING_SECRET";
    if (env.PI_RELAY_SLACK_APP_TOKEN) slack.appTokenEnv = "PI_RELAY_SLACK_APP_TOKEN";
    if (env.PI_RELAY_SLACK_APP_ID) slack.appId = env.PI_RELAY_SLACK_APP_ID;
    if (env.PI_RELAY_SLACK_BOT_USER_ID) slack.botUserId = env.PI_RELAY_SLACK_BOT_USER_ID;
  }

  return canonical;
}

export function canonicalRelayConfigForWrite(input: RelayConfigFile): RelayConfigFile {
  return canonicalizeRelayConfigFile(input);
}

export async function loadRelayConfig(options: RelayConfigLoadOptions = {}): Promise<ResolvedRelayConfig> {
  const env = options.env ?? process.env;
  const configPath = resolveConfigPath(env, options.configPath);
  const warnings: string[] = [];
  await collectPermissionWarning(configPath, warnings);
  const rawFileConfig = await readConfigFile(configPath) ?? {};
  if (hasLegacyRelayConfigKeys(rawFileConfig as Record<string, unknown>)) warnings.push("Legacy Telegram tunnel config keys were detected; migrate to namespaced PiRelay config.");
  const fileConfig = addDefaultEnvMessengers(rawFileConfig, env);
  if (env.TELEGRAM_BOT_TOKEN || env.PI_TELEGRAM_TUNNEL_STATE_DIR || env.PI_TELEGRAM_TUNNEL_CONFIG) {
    warnings.push("Using legacy Telegram tunnel environment fallback; prefer namespaced PiRelay config and tokenEnv settings.");
  }
  if (env.PI_RELAY_DISCORD_BOT_TOKEN || env.PI_RELAY_SLACK_BOT_TOKEN || env.PI_RELAY_SLACK_SIGNING_SECRET || env.PI_RELAY_SLACK_APP_TOKEN || env.PI_RELAY_SLACK_APP_ID) {
    warnings.push("Using legacy top-level messenger environment fallback; prefer namespaced PiRelay messenger config with tokenEnv/signingSecretEnv.");
  }

  const relay: RelayMachineConfig = {
    machineId: fileConfig.relay?.machineId ?? fileConfig.relay?.machine?.id ?? env.PI_RELAY_MACHINE_ID ?? randomUUID(),
    stateDir: expandHome(fileConfig.relay?.stateDir ?? env.PI_RELAY_STATE_DIR ?? env.PI_TELEGRAM_TUNNEL_STATE_DIR ?? fileConfig.stateDir ?? DEFAULT_PIRELAY_STATE_DIR),
    displayName: fileConfig.relay?.displayName ?? env.PI_RELAY_MACHINE_DISPLAY_NAME,
    aliases: relayMachineAliases(fileConfig, env),
    brokerNamespace: fileConfig.relay?.brokerNamespace ?? env.PI_RELAY_BROKER_NAMESPACE,
    brokerGroup: fileConfig.relay?.brokerGroup ?? env.PI_RELAY_BROKER_GROUP,
    brokerPeers: fileConfig.relay?.brokerPeers ?? [],
  };
  if (relay.stateDir === LEGACY_TELEGRAM_TUNNEL_STATE_DIR || env.PI_TELEGRAM_TUNNEL_STATE_DIR) warnings.push("Using legacy Telegram tunnel state directory fallback; prefer ~/.pi/agent/pirelay.");

  const defaults: RelayDefaultsConfig = {
    ...defaultDefaults,
    ...fileConfig.defaults,
  };
  ensureValidDefaults(defaults);

  const supportedMessengers = options.supportedMessengers ?? defaultSupportedMessengers;
  const messengers: ResolvedMessengerInstanceConfig[] = [];
  for (const [kind, instances] of Object.entries(fileConfig.messengers ?? {})) {
    if (!isValidMessengerKind(kind)) throw new RelayConfigError(`Invalid messenger kind: ${kind}`);
    for (const [instanceId, config] of Object.entries(instances)) {
      if (!isValidMessengerInstanceId(instanceId)) throw new RelayConfigError(`Invalid messenger instance id for ${kind}: ${instanceId}`);
      messengers.push(resolveMessengerInstance({
        ref: { kind, instanceId },
        config,
        defaults,
        relay,
        env,
        supportedMessengers,
        warnings,
      }));
    }
  }

  for (const messenger of messengers) {
    if (messenger.unsupported) warnings.push(`Messenger ${messenger.ref.kind}:${messenger.ref.instanceId} is configured but no adapter is installed.`);
    if (messenger.enabled && !messenger.token && messenger.ref.kind !== "slack") warnings.push(`Messenger ${messenger.ref.kind}:${messenger.ref.instanceId} is enabled but missing a bot token.`);
    if (messenger.enabled && messenger.ref.kind === "slack" && (!messenger.token || !messenger.signingSecret)) warnings.push(`Messenger slack:${messenger.ref.instanceId} is enabled but missing Slack bot token or signing secret.`);
    if (messenger.ingressPolicy.kind === "owner" && !messenger.ingressPolicy.machineId) throw new RelayConfigError(`${messenger.ref.kind}:${messenger.ref.instanceId} owner ingress policy requires a machine id.`);
  }

  return { configPath, relay, defaults, messengers, warnings };
}
