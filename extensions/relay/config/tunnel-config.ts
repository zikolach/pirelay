import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_STATE_DIR, getDefaultConfigPath } from "../state/paths.js";
import type { ConfigLoadResult, DiscordRelayConfig, SlackRelayConfig, TelegramTunnelConfig } from "../core/types.js";
import type { MessengerInstanceFileConfig, RelayConfigFile } from "./schema.js";
import { DEFAULT_MAX_PROGRESS_MESSAGE_CHARS, DEFAULT_PROGRESS_INTERVAL_MS, DEFAULT_PROGRESS_MODE, DEFAULT_RECENT_ACTIVITY_LIMIT, DEFAULT_VERBOSE_PROGRESS_INTERVAL_MS, normalizeProgressMode } from "../notifications/progress.js";
import { getDefaultRedactionPatterns } from "../core/utils.js";

interface LegacyMessengerFileShape extends MessengerInstanceFileConfig {
  maxTextChars?: number;
  maxFileBytes?: number;
  allowedImageMimeTypes?: string[];
}

interface ConfigFileShape extends RelayConfigFile {
  botToken?: string;
  TELEGRAM_BOT_TOKEN?: string;
  PI_RELAY_DISCORD_ENABLED?: string;
  PI_RELAY_DISCORD_BOT_TOKEN?: string;
  PI_RELAY_DISCORD_CLIENT_ID?: string;
  PI_RELAY_DISCORD_APPLICATION_ID?: string;
  PI_RELAY_DISCORD_ALLOW_USER_IDS?: string;
  PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS?: string;
  PI_RELAY_DISCORD_ALLOW_GUILD_IDS?: string;
  PI_RELAY_DISCORD_MAX_TEXT_CHARS?: string;
  PI_RELAY_DISCORD_MAX_FILE_BYTES?: string;
  PI_RELAY_DISCORD_ALLOWED_IMAGE_MIME_TYPES?: string;
  PI_RELAY_SLACK_ENABLED?: string;
  PI_RELAY_SLACK_BOT_TOKEN?: string;
  PI_RELAY_SLACK_SIGNING_SECRET?: string;
  PI_RELAY_SLACK_APP_TOKEN?: string;
  PI_RELAY_SLACK_EVENT_MODE?: string;
  PI_RELAY_SLACK_APP_ID?: string;
  PI_RELAY_SLACK_WORKSPACE_ID?: string;
  PI_RELAY_SLACK_BOT_USER_ID?: string;
  PI_RELAY_SLACK_ALLOW_USER_IDS?: string;
  PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES?: string;
  PI_RELAY_SLACK_MAX_TEXT_CHARS?: string;
  PI_RELAY_SLACK_MAX_FILE_BYTES?: string;
  PI_RELAY_SLACK_ALLOWED_IMAGE_MIME_TYPES?: string;
  stateDir?: string;
  pairingExpiryMs?: number;
  busyDeliveryMode?: "followUp" | "steer";
  allowUserIds?: number[];
  summaryMode?: "deterministic" | "llm";
  maxTelegramMessageChars?: number;
  sendRetryCount?: number;
  sendRetryBaseMs?: number;
  pollingTimeoutSeconds?: number;
  redactionPatterns?: string[];
  maxInboundImageBytes?: number;
  maxOutboundImageBytes?: number;
  maxLatestImages?: number;
  allowedImageMimeTypes?: string[];
  progressMode?: string;
  progressIntervalMs?: number;
  verboseProgressIntervalMs?: number;
  recentActivityLimit?: number;
  maxProgressMessageChars?: number;
  discord?: DiscordRelayConfig & LegacyMessengerFileShape;
  slack?: SlackRelayConfig & LegacyMessengerFileShape;
}

export class ConfigError extends Error {}

function expandHome(path: string): string {
  return path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path);
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAllowUserIds(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part) && part > 0);
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseNumericList(values: number[] | string[] | undefined): number[] | undefined {
  if (!values) return undefined;
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function configString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveConfigSecret(value: string | undefined, envName: string | undefined): string | undefined {
  if (value) return value;
  if (envName) return process.env[envName];
  return undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean | undefined): boolean | undefined {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function readConfigFile(configPath: string): Promise<ConfigFileShape | undefined> {
  try {
    await access(configPath, constants.R_OK);
  } catch {
    return undefined;
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as ConfigFileShape;
  return parsed;
}

function resolveDiscordConfigForInstance(fileConfig: ConfigFileShape | undefined, defaultImageMimeTypes: string[], instanceId: string): DiscordRelayConfig | undefined {
  const discordConfig = fileConfig?.messengers?.discord?.[instanceId] as LegacyMessengerFileShape | undefined;
  const legacyConfig = fileConfig?.discord;
  const useLegacyFallback = instanceId === "default";
  const botToken = (useLegacyFallback ? process.env.PI_RELAY_DISCORD_BOT_TOKEN : undefined)
    ?? resolveConfigSecret(discordConfig?.botToken ?? discordConfig?.token, discordConfig?.tokenEnv)
    ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_BOT_TOKEN : undefined)
    ?? (useLegacyFallback ? legacyConfig?.botToken : undefined);
  const enabled = parseBoolean(
    (useLegacyFallback ? process.env.PI_RELAY_DISCORD_ENABLED : undefined) ?? configString(useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_ENABLED : undefined),
    discordConfig?.enabled ?? (useLegacyFallback ? legacyConfig?.enabled : undefined) ?? Boolean(botToken),
  );
  if (!enabled && !botToken) return undefined;
  return {
    enabled,
    botToken,
    applicationId: (useLegacyFallback ? process.env.PI_RELAY_DISCORD_APPLICATION_ID : undefined) ?? (useLegacyFallback ? process.env.PI_RELAY_DISCORD_CLIENT_ID : undefined) ?? discordConfig?.applicationId ?? discordConfig?.clientId ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_APPLICATION_ID : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_CLIENT_ID : undefined) ?? (useLegacyFallback ? legacyConfig?.applicationId : undefined) ?? (useLegacyFallback ? legacyConfig?.clientId : undefined),
    clientId: (useLegacyFallback ? process.env.PI_RELAY_DISCORD_APPLICATION_ID : undefined) ?? (useLegacyFallback ? process.env.PI_RELAY_DISCORD_CLIENT_ID : undefined) ?? discordConfig?.applicationId ?? discordConfig?.clientId ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_APPLICATION_ID : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_CLIENT_ID : undefined) ?? (useLegacyFallback ? legacyConfig?.applicationId : undefined) ?? (useLegacyFallback ? legacyConfig?.clientId : undefined),
    allowUserIds: parseStringList((useLegacyFallback ? process.env.PI_RELAY_DISCORD_ALLOW_USER_IDS : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_ALLOW_USER_IDS : undefined)) ?? discordConfig?.allowUserIds ?? (useLegacyFallback ? legacyConfig?.allowUserIds : undefined) ?? [],
    allowGuildChannels: parseBoolean(
      (useLegacyFallback ? process.env.PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS : undefined) ?? configString(useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS : undefined),
      discordConfig?.allowGuildChannels ?? (useLegacyFallback ? legacyConfig?.allowGuildChannels : undefined) ?? false,
    ),
    allowGuildIds: parseStringList((useLegacyFallback ? process.env.PI_RELAY_DISCORD_ALLOW_GUILD_IDS : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_ALLOW_GUILD_IDS : undefined)) ?? discordConfig?.allowGuildIds ?? (useLegacyFallback ? legacyConfig?.allowGuildIds : undefined) ?? [],
    sharedRoom: discordConfig?.sharedRoom ?? (useLegacyFallback ? legacyConfig?.sharedRoom : undefined),
    maxTextChars: parseNumber((useLegacyFallback ? process.env.PI_RELAY_DISCORD_MAX_TEXT_CHARS : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_MAX_TEXT_CHARS : undefined), discordConfig?.limits?.maxTextChars ?? discordConfig?.maxTextChars ?? (useLegacyFallback ? legacyConfig?.maxTextChars : undefined) ?? 2_000),
    maxFileBytes: parseNumber((useLegacyFallback ? process.env.PI_RELAY_DISCORD_MAX_FILE_BYTES : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_MAX_FILE_BYTES : undefined), discordConfig?.limits?.maxFileBytes ?? discordConfig?.maxFileBytes ?? (useLegacyFallback ? legacyConfig?.maxFileBytes : undefined) ?? 8 * 1024 * 1024),
    allowedImageMimeTypes: parseStringList((useLegacyFallback ? process.env.PI_RELAY_DISCORD_ALLOWED_IMAGE_MIME_TYPES : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_DISCORD_ALLOWED_IMAGE_MIME_TYPES : undefined)) ?? discordConfig?.limits?.allowedImageMimeTypes ?? discordConfig?.allowedImageMimeTypes ?? (useLegacyFallback ? legacyConfig?.allowedImageMimeTypes : undefined) ?? defaultImageMimeTypes,
  };
}

function resolveDiscordConfigs(fileConfig: ConfigFileShape | undefined, defaultImageMimeTypes: string[]): Record<string, DiscordRelayConfig> {
  const instanceIds = new Set(Object.keys(fileConfig?.messengers?.discord ?? {}));
  if (fileConfig?.discord || fileConfig?.PI_RELAY_DISCORD_BOT_TOKEN || process.env.PI_RELAY_DISCORD_BOT_TOKEN || process.env.PI_RELAY_DISCORD_ENABLED) instanceIds.add("default");
  const configs: Record<string, DiscordRelayConfig> = {};
  for (const instanceId of instanceIds) {
    const config = resolveDiscordConfigForInstance(fileConfig, defaultImageMimeTypes, instanceId);
    if (config) configs[instanceId] = config;
  }
  return configs;
}

function resolveDiscordConfig(fileConfig: ConfigFileShape | undefined, defaultImageMimeTypes: string[]): DiscordRelayConfig | undefined {
  const configs = resolveDiscordConfigs(fileConfig, defaultImageMimeTypes);
  return configs.default ?? Object.values(configs)[0];
}

function resolveSlackEventMode(value: string | undefined): "socket" | "webhook" {
  return value === "webhook" ? "webhook" : "socket";
}

function resolveSlackConfigForInstance(fileConfig: ConfigFileShape | undefined, defaultImageMimeTypes: string[], instanceId: string): SlackRelayConfig | undefined {
  const slackConfig = fileConfig?.messengers?.slack?.[instanceId] as LegacyMessengerFileShape | undefined;
  const legacyConfig = fileConfig?.slack;
  const useLegacyFallback = instanceId === "default";
  const botToken = (useLegacyFallback ? process.env.PI_RELAY_SLACK_BOT_TOKEN : undefined)
    ?? resolveConfigSecret(slackConfig?.botToken ?? slackConfig?.token, slackConfig?.tokenEnv)
    ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_BOT_TOKEN : undefined)
    ?? (useLegacyFallback ? legacyConfig?.botToken : undefined);
  const signingSecret = (useLegacyFallback ? process.env.PI_RELAY_SLACK_SIGNING_SECRET : undefined)
    ?? resolveConfigSecret(slackConfig?.signingSecret, slackConfig?.signingSecretEnv)
    ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_SIGNING_SECRET : undefined)
    ?? (useLegacyFallback ? legacyConfig?.signingSecret : undefined);
  const appToken = (useLegacyFallback ? process.env.PI_RELAY_SLACK_APP_TOKEN : undefined)
    ?? resolveConfigSecret(slackConfig?.appToken, slackConfig?.appTokenEnv)
    ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_APP_TOKEN : undefined)
    ?? (useLegacyFallback ? legacyConfig?.appToken : undefined);
  const enabled = parseBoolean(
    (useLegacyFallback ? process.env.PI_RELAY_SLACK_ENABLED : undefined) ?? configString(useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_ENABLED : undefined),
    slackConfig?.enabled ?? (useLegacyFallback ? legacyConfig?.enabled : undefined) ?? Boolean(botToken && signingSecret),
  );
  if (!enabled && !botToken && !signingSecret) return undefined;
  return {
    enabled,
    botToken,
    signingSecret,
    appToken,
    appId: (useLegacyFallback ? process.env.PI_RELAY_SLACK_APP_ID : undefined) ?? slackConfig?.appId ?? slackConfig?.applicationId ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_APP_ID : undefined) ?? (useLegacyFallback ? legacyConfig?.appId ?? legacyConfig?.applicationId : undefined),
    eventMode: resolveSlackEventMode((useLegacyFallback ? process.env.PI_RELAY_SLACK_EVENT_MODE : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_EVENT_MODE : undefined) ?? slackConfig?.eventMode ?? (useLegacyFallback ? legacyConfig?.eventMode : undefined)),
    workspaceId: (useLegacyFallback ? process.env.PI_RELAY_SLACK_WORKSPACE_ID : undefined) ?? slackConfig?.workspaceId ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_WORKSPACE_ID : undefined) ?? (useLegacyFallback ? legacyConfig?.workspaceId : undefined),
    botUserId: (useLegacyFallback ? process.env.PI_RELAY_SLACK_BOT_USER_ID : undefined) ?? slackConfig?.botUserId ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_BOT_USER_ID : undefined) ?? (useLegacyFallback ? legacyConfig?.botUserId : undefined),
    allowUserIds: parseStringList((useLegacyFallback ? process.env.PI_RELAY_SLACK_ALLOW_USER_IDS : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_ALLOW_USER_IDS : undefined)) ?? slackConfig?.allowUserIds ?? (useLegacyFallback ? legacyConfig?.allowUserIds : undefined) ?? [],
    allowChannelMessages: parseBoolean(
      (useLegacyFallback ? process.env.PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES : undefined) ?? configString(useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES : undefined),
      slackConfig?.allowChannelMessages ?? (useLegacyFallback ? legacyConfig?.allowChannelMessages : undefined) ?? false,
    ),
    sharedRoom: slackConfig?.sharedRoom ?? (useLegacyFallback ? legacyConfig?.sharedRoom : undefined),
    maxTextChars: parseNumber((useLegacyFallback ? process.env.PI_RELAY_SLACK_MAX_TEXT_CHARS : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_MAX_TEXT_CHARS : undefined), slackConfig?.limits?.maxTextChars ?? slackConfig?.maxTextChars ?? (useLegacyFallback ? legacyConfig?.maxTextChars : undefined) ?? 3_000),
    maxFileBytes: parseNumber((useLegacyFallback ? process.env.PI_RELAY_SLACK_MAX_FILE_BYTES : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_MAX_FILE_BYTES : undefined), slackConfig?.limits?.maxFileBytes ?? slackConfig?.maxFileBytes ?? (useLegacyFallback ? legacyConfig?.maxFileBytes : undefined) ?? 10 * 1024 * 1024),
    allowedImageMimeTypes: parseStringList((useLegacyFallback ? process.env.PI_RELAY_SLACK_ALLOWED_IMAGE_MIME_TYPES : undefined) ?? (useLegacyFallback ? fileConfig?.PI_RELAY_SLACK_ALLOWED_IMAGE_MIME_TYPES : undefined)) ?? slackConfig?.limits?.allowedImageMimeTypes ?? slackConfig?.allowedImageMimeTypes ?? (useLegacyFallback ? legacyConfig?.allowedImageMimeTypes : undefined) ?? defaultImageMimeTypes,
  };
}

function resolveSlackConfigs(fileConfig: ConfigFileShape | undefined, defaultImageMimeTypes: string[]): Record<string, SlackRelayConfig> {
  const instanceIds = new Set(Object.keys(fileConfig?.messengers?.slack ?? {}));
  if (fileConfig?.slack || fileConfig?.PI_RELAY_SLACK_BOT_TOKEN || fileConfig?.PI_RELAY_SLACK_APP_TOKEN || fileConfig?.PI_RELAY_SLACK_APP_ID || process.env.PI_RELAY_SLACK_BOT_TOKEN || process.env.PI_RELAY_SLACK_SIGNING_SECRET || process.env.PI_RELAY_SLACK_APP_TOKEN || process.env.PI_RELAY_SLACK_APP_ID || process.env.PI_RELAY_SLACK_ENABLED) instanceIds.add("default");
  const configs: Record<string, SlackRelayConfig> = {};
  for (const instanceId of instanceIds) {
    const config = resolveSlackConfigForInstance(fileConfig, defaultImageMimeTypes, instanceId);
    if (config) configs[instanceId] = config;
  }
  return configs;
}

function resolveSlackConfig(fileConfig: ConfigFileShape | undefined, defaultImageMimeTypes: string[]): SlackRelayConfig | undefined {
  const configs = resolveSlackConfigs(fileConfig, defaultImageMimeTypes);
  return configs.default ?? Object.values(configs)[0];
}

async function collectFileWarnings(configPath: string, warnings: string[]): Promise<void> {
  try {
    const info = await stat(configPath);
    if ((info.mode & 0o077) !== 0) {
      warnings.push(`Config file ${configPath} is group/world readable. Run chmod 600 to protect bot secrets.`);
    }
  } catch {
    // Ignore stat failures for warnings.
  }
}

export async function loadTelegramTunnelConfig(): Promise<ConfigLoadResult> {
  const envConfigPath = process.env.PI_RELAY_CONFIG ?? process.env.PI_TELEGRAM_TUNNEL_CONFIG;
  const configPath = expandHome(envConfigPath || getDefaultConfigPath(DEFAULT_STATE_DIR));
  const fileConfig = await readConfigFile(configPath);
  const warnings: string[] = [];

  if (fileConfig) {
    await collectFileWarnings(configPath, warnings);
    if (fileConfig.botToken || fileConfig.TELEGRAM_BOT_TOKEN) {
      warnings.push(`Bot token loaded from ${configPath}. Prefer TELEGRAM_BOT_TOKEN in the environment when possible.`);
    }
  }

  const telegramConfig = fileConfig?.messengers?.telegram?.default;
  const botToken = process.env.PI_RELAY_TELEGRAM_BOT_TOKEN
    ?? process.env.TELEGRAM_BOT_TOKEN
    ?? resolveConfigSecret(telegramConfig?.botToken ?? telegramConfig?.token, telegramConfig?.tokenEnv)
    ?? fileConfig?.botToken
    ?? fileConfig?.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new ConfigError(
      `Missing Telegram bot token. Set TELEGRAM_BOT_TOKEN or PI_RELAY_TELEGRAM_BOT_TOKEN, or create ${configPath} with {\n  \"botToken\": \"<token>\"\n}.`,
    );
  }

  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    throw new ConfigError("Telegram bot token format looks invalid.");
  }

  const stateDir = expandHome(process.env.PI_RELAY_STATE_DIR || process.env.PI_TELEGRAM_TUNNEL_STATE_DIR || fileConfig?.relay?.stateDir || fileConfig?.stateDir || DEFAULT_STATE_DIR);
  const machineId = fileConfig?.relay?.machineId ?? fileConfig?.relay?.machine?.id ?? process.env.PI_RELAY_MACHINE_ID;
  const machineDisplayName = fileConfig?.relay?.displayName ?? process.env.PI_RELAY_MACHINE_DISPLAY_NAME;
  const brokerNamespace = fileConfig?.relay?.brokerNamespace ?? process.env.PI_RELAY_BROKER_NAMESPACE;
  const machineAliases = [...new Set([...(fileConfig?.relay?.aliases ?? []), ...(parseStringList(process.env.PI_RELAY_MACHINE_ALIASES) ?? [])].map((alias) => alias.trim()).filter(Boolean))];
  const busyDeliveryMode = (process.env.PI_TELEGRAM_TUNNEL_BUSY_MODE || fileConfig?.defaults?.busyDeliveryMode || fileConfig?.busyDeliveryMode || "followUp") as
    | "followUp"
    | "steer";

  if (busyDeliveryMode !== "followUp" && busyDeliveryMode !== "steer") {
    throw new ConfigError(`Invalid busy delivery mode: ${busyDeliveryMode}`);
  }

  const summaryMode = (process.env.PI_TELEGRAM_TUNNEL_SUMMARY_MODE || fileConfig?.summaryMode || "deterministic") as
    | "deterministic"
    | "llm";

  if (summaryMode !== "deterministic" && summaryMode !== "llm") {
    throw new ConfigError(`Invalid summary mode: ${summaryMode}`);
  }

  const allowUserIds = parseAllowUserIds(process.env.PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS) ?? parseNumericList(telegramConfig?.allowUserIds) ?? fileConfig?.allowUserIds ?? [];
  const pairingExpiryMs = parseNumber(process.env.PI_TELEGRAM_TUNNEL_PAIRING_EXPIRY_MS, fileConfig?.defaults?.pairingExpiryMs ?? fileConfig?.pairingExpiryMs ?? 5 * 60_000);
  const maxTelegramMessageChars = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_MAX_MESSAGE_CHARS,
    fileConfig?.defaults?.maxTextChars ?? fileConfig?.maxTelegramMessageChars ?? 3900,
  );
  const sendRetryCount = parseNumber(process.env.PI_TELEGRAM_TUNNEL_SEND_RETRY_COUNT, fileConfig?.sendRetryCount ?? 3);
  const sendRetryBaseMs = parseNumber(process.env.PI_TELEGRAM_TUNNEL_SEND_RETRY_BASE_MS, fileConfig?.sendRetryBaseMs ?? 800);
  const pollingTimeoutSeconds = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_POLLING_TIMEOUT_SECONDS,
    fileConfig?.pollingTimeoutSeconds ?? 20,
  );
  const maxInboundImageBytes = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_MAX_INBOUND_IMAGE_BYTES,
    fileConfig?.defaults?.maxInboundImageBytes ?? fileConfig?.maxInboundImageBytes ?? 10 * 1024 * 1024,
  );
  const maxOutboundImageBytes = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_MAX_OUTBOUND_IMAGE_BYTES,
    fileConfig?.defaults?.maxOutboundImageBytes ?? fileConfig?.maxOutboundImageBytes ?? 10 * 1024 * 1024,
  );
  const maxLatestImages = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_MAX_LATEST_IMAGES,
    fileConfig?.maxLatestImages ?? 4,
  );
  const allowedImageMimeTypes = parseStringList(process.env.PI_TELEGRAM_TUNNEL_ALLOWED_IMAGE_MIME_TYPES)
    ?? fileConfig?.defaults?.allowedImageMimeTypes
    ?? fileConfig?.allowedImageMimeTypes
    ?? ["image/jpeg", "image/png", "image/webp"];
  const rawProgressMode = process.env.PI_TELEGRAM_TUNNEL_PROGRESS_MODE ?? fileConfig?.progressMode;
  const progressMode = rawProgressMode === undefined ? DEFAULT_PROGRESS_MODE : normalizeProgressMode(rawProgressMode);
  const progressIntervalMs = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_PROGRESS_INTERVAL_MS,
    fileConfig?.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS,
  );
  const verboseProgressIntervalMs = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_VERBOSE_PROGRESS_INTERVAL_MS,
    fileConfig?.verboseProgressIntervalMs ?? DEFAULT_VERBOSE_PROGRESS_INTERVAL_MS,
  );
  const recentActivityLimit = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_RECENT_ACTIVITY_LIMIT,
    fileConfig?.recentActivityLimit ?? DEFAULT_RECENT_ACTIVITY_LIMIT,
  );
  const maxProgressMessageChars = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_MAX_PROGRESS_CHARS,
    fileConfig?.maxProgressMessageChars ?? DEFAULT_MAX_PROGRESS_MESSAGE_CHARS,
  );
  const discordInstances = resolveDiscordConfigs(fileConfig, allowedImageMimeTypes);
  const slackInstances = resolveSlackConfigs(fileConfig, allowedImageMimeTypes);
  const discord = discordInstances.default ?? Object.values(discordInstances)[0];
  const slack = slackInstances.default ?? Object.values(slackInstances)[0];

  if (pairingExpiryMs < 30_000) {
    throw new ConfigError("pairingExpiryMs must be at least 30000.");
  }
  if (maxTelegramMessageChars < 256 || maxTelegramMessageChars > 4096) {
    throw new ConfigError("maxTelegramMessageChars must be between 256 and 4096.");
  }
  if (pollingTimeoutSeconds < 1 || pollingTimeoutSeconds > 50) {
    throw new ConfigError("pollingTimeoutSeconds must be between 1 and 50 seconds.");
  }
  if (maxInboundImageBytes < 1 || maxOutboundImageBytes < 1) {
    throw new ConfigError("Image byte limits must be positive.");
  }
  if (maxLatestImages < 1 || maxLatestImages > 20) {
    throw new ConfigError("maxLatestImages must be between 1 and 20.");
  }
  if (allowedImageMimeTypes.length === 0) {
    throw new ConfigError("allowedImageMimeTypes must include at least one MIME type.");
  }
  if (!normalizeProgressMode(progressMode)) {
    throw new ConfigError("progressMode must be quiet, normal, verbose, completion-only, or completionOnly.");
  }
  if (progressIntervalMs < 5_000 || progressIntervalMs > 10 * 60_000) {
    throw new ConfigError("progressIntervalMs must be between 5000 and 600000.");
  }
  if (verboseProgressIntervalMs < 2_000 || verboseProgressIntervalMs > 10 * 60_000) {
    throw new ConfigError("verboseProgressIntervalMs must be between 2000 and 600000.");
  }
  if (recentActivityLimit < 1 || recentActivityLimit > 50) {
    throw new ConfigError("recentActivityLimit must be between 1 and 50.");
  }
  if (maxProgressMessageChars < 120 || maxProgressMessageChars > 1500) {
    throw new ConfigError("maxProgressMessageChars must be between 120 and 1500.");
  }

  const config: TelegramTunnelConfig = {
    botToken,
    configPath,
    stateDir,
    machineId,
    machineDisplayName,
    machineAliases,
    brokerNamespace,
    pairingExpiryMs,
    busyDeliveryMode,
    allowUserIds,
    summaryMode,
    maxTelegramMessageChars,
    sendRetryCount,
    sendRetryBaseMs,
    pollingTimeoutSeconds,
    redactionPatterns: fileConfig?.redactionPatterns ?? getDefaultRedactionPatterns(),
    maxInboundImageBytes,
    maxOutboundImageBytes,
    maxLatestImages,
    allowedImageMimeTypes,
    progressMode,
    progressIntervalMs,
    verboseProgressIntervalMs,
    recentActivityLimit,
    maxProgressMessageChars,
    discord,
    discordInstances,
    slack,
    slackInstances,
  };

  return { config, warnings };
}
