import type { MessengerInstanceFileConfig, RelayConfigFile } from "./schema.js";

const legacyTopLevelKeys = new Set([
  "botToken",
  "TELEGRAM_BOT_TOKEN",
  "stateDir",
  "pairingExpiryMs",
  "busyDeliveryMode",
  "maxTelegramMessageChars",
  "maxInboundImageBytes",
  "maxOutboundImageBytes",
  "allowedImageMimeTypes",
  "allowUserIds",
  "discord",
  "slack",
  "PI_RELAY_DISCORD_ENABLED",
  "PI_RELAY_DISCORD_BOT_TOKEN",
  "PI_RELAY_DISCORD_CLIENT_ID",
  "PI_RELAY_DISCORD_ALLOW_USER_IDS",
  "PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS",
  "PI_RELAY_DISCORD_ALLOW_GUILD_IDS",
  "PI_RELAY_DISCORD_MAX_TEXT_CHARS",
  "PI_RELAY_DISCORD_MAX_FILE_BYTES",
  "PI_RELAY_DISCORD_ALLOWED_IMAGE_MIME_TYPES",
  "PI_RELAY_SLACK_ENABLED",
  "PI_RELAY_SLACK_BOT_TOKEN",
  "PI_RELAY_SLACK_SIGNING_SECRET",
  "PI_RELAY_SLACK_EVENT_MODE",
  "PI_RELAY_SLACK_WORKSPACE_ID",
  "PI_RELAY_SLACK_ALLOW_USER_IDS",
  "PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES",
  "PI_RELAY_SLACK_MAX_TEXT_CHARS",
  "PI_RELAY_SLACK_MAX_FILE_BYTES",
  "PI_RELAY_SLACK_ALLOWED_IMAGE_MIME_TYPES",
]);

interface LegacyMessengerShape extends MessengerInstanceFileConfig {
  maxTextChars?: number;
  maxFileBytes?: number;
  allowedImageMimeTypes?: string[];
}

interface LegacyRelayFileShape extends RelayConfigFile {
  maxTelegramMessageChars?: number;
  maxInboundImageBytes?: number;
  maxOutboundImageBytes?: number;
  allowedImageMimeTypes?: string[];
}

function stringIds(values: number[] | string[] | undefined): string[] | undefined {
  return values?.map(String);
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withLimits(
  config: MessengerInstanceFileConfig,
  legacy: LegacyMessengerShape | undefined,
  envStyle: { maxTextChars?: string; maxFileBytes?: string; allowedImageMimeTypes?: string[] },
): MessengerInstanceFileConfig {
  const limits = {
    ...config.limits,
    maxTextChars: config.limits?.maxTextChars ?? parseNumber(envStyle.maxTextChars) ?? legacy?.maxTextChars,
    maxFileBytes: config.limits?.maxFileBytes ?? parseNumber(envStyle.maxFileBytes) ?? legacy?.maxFileBytes,
    allowedImageMimeTypes: config.limits?.allowedImageMimeTypes ?? envStyle.allowedImageMimeTypes ?? legacy?.allowedImageMimeTypes,
  };
  const cleanLimits = JSON.parse(JSON.stringify(limits)) as MessengerInstanceFileConfig["limits"];
  return cleanLimits && Object.keys(cleanLimits).length > 0 ? { ...config, limits: cleanLimits } : config;
}

export function canonicalizeRelayConfigFile(input: RelayConfigFile): RelayConfigFile {
  const legacyInput = input as LegacyRelayFileShape;
  const preserved = Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key]) => key !== "relay" && key !== "defaults" && key !== "messengers" && !legacyTopLevelKeys.has(key))
      .map(([key, value]) => [key, structuredClone(value)]),
  );
  const canonical: RelayConfigFile = {
    ...preserved,
    relay: input.relay ? { ...input.relay } : undefined,
    defaults: input.defaults ? { ...input.defaults } : undefined,
    messengers: input.messengers ? structuredClone(input.messengers) : {},
  };

  if (input.stateDir) canonical.relay = { ...canonical.relay, stateDir: input.stateDir };
  if (input.pairingExpiryMs || input.busyDeliveryMode || legacyInput.maxTelegramMessageChars || legacyInput.maxInboundImageBytes || legacyInput.maxOutboundImageBytes || legacyInput.allowedImageMimeTypes) {
    canonical.defaults = {
      ...canonical.defaults,
      pairingExpiryMs: input.pairingExpiryMs ?? canonical.defaults?.pairingExpiryMs,
      busyDeliveryMode: input.busyDeliveryMode ?? canonical.defaults?.busyDeliveryMode,
      maxTextChars: legacyInput.maxTelegramMessageChars ?? canonical.defaults?.maxTextChars,
      maxInboundImageBytes: legacyInput.maxInboundImageBytes ?? canonical.defaults?.maxInboundImageBytes,
      maxOutboundImageBytes: legacyInput.maxOutboundImageBytes ?? canonical.defaults?.maxOutboundImageBytes,
      allowedImageMimeTypes: legacyInput.allowedImageMimeTypes ?? canonical.defaults?.allowedImageMimeTypes,
    };
  }

  const messengers = canonical.messengers ?? {};
  canonical.messengers = messengers;

  if (input.botToken || input.TELEGRAM_BOT_TOKEN || input.allowUserIds) {
    messengers.telegram = {
      ...messengers.telegram,
      default: {
        ...messengers.telegram?.default,
        botToken: messengers.telegram?.default?.botToken ?? input.botToken ?? input.TELEGRAM_BOT_TOKEN,
        allowUserIds: messengers.telegram?.default?.allowUserIds ?? stringIds(input.allowUserIds),
      },
    };
  }

  if (
    input.discord
    || input.PI_RELAY_DISCORD_ENABLED
    || input.PI_RELAY_DISCORD_BOT_TOKEN
    || input.PI_RELAY_DISCORD_CLIENT_ID
    || input.PI_RELAY_DISCORD_ALLOW_USER_IDS
    || input.PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS
    || input.PI_RELAY_DISCORD_ALLOW_GUILD_IDS
  ) {
    const legacy = input.discord as LegacyMessengerShape | undefined;
    const base: MessengerInstanceFileConfig = {
      ...legacy,
      ...messengers.discord?.default,
      enabled: messengers.discord?.default?.enabled ?? parseBoolean(input.PI_RELAY_DISCORD_ENABLED) ?? legacy?.enabled,
      botToken: messengers.discord?.default?.botToken ?? legacy?.botToken ?? input.PI_RELAY_DISCORD_BOT_TOKEN,
      clientId: messengers.discord?.default?.clientId ?? legacy?.clientId ?? input.PI_RELAY_DISCORD_CLIENT_ID,
      allowUserIds: messengers.discord?.default?.allowUserIds ?? parseStringList(input.PI_RELAY_DISCORD_ALLOW_USER_IDS) ?? legacy?.allowUserIds,
      allowGuildChannels: messengers.discord?.default?.allowGuildChannels ?? parseBoolean(input.PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS) ?? legacy?.allowGuildChannels,
      allowGuildIds: messengers.discord?.default?.allowGuildIds ?? parseStringList(input.PI_RELAY_DISCORD_ALLOW_GUILD_IDS) ?? legacy?.allowGuildIds,
    };
    messengers.discord = {
      ...messengers.discord,
      default: withLimits(base, legacy, {
        maxTextChars: input.PI_RELAY_DISCORD_MAX_TEXT_CHARS,
        maxFileBytes: input.PI_RELAY_DISCORD_MAX_FILE_BYTES,
        allowedImageMimeTypes: parseStringList(input.PI_RELAY_DISCORD_ALLOWED_IMAGE_MIME_TYPES),
      }),
    };
  }

  if (
    input.slack
    || input.PI_RELAY_SLACK_ENABLED
    || input.PI_RELAY_SLACK_BOT_TOKEN
    || input.PI_RELAY_SLACK_SIGNING_SECRET
    || input.PI_RELAY_SLACK_EVENT_MODE
    || input.PI_RELAY_SLACK_WORKSPACE_ID
    || input.PI_RELAY_SLACK_ALLOW_USER_IDS
    || input.PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES
  ) {
    const legacy = input.slack as LegacyMessengerShape | undefined;
    const eventMode = input.PI_RELAY_SLACK_EVENT_MODE === "webhook" ? "webhook" : input.PI_RELAY_SLACK_EVENT_MODE === "socket" ? "socket" : undefined;
    const base: MessengerInstanceFileConfig = {
      ...legacy,
      ...messengers.slack?.default,
      enabled: messengers.slack?.default?.enabled ?? parseBoolean(input.PI_RELAY_SLACK_ENABLED) ?? legacy?.enabled,
      botToken: messengers.slack?.default?.botToken ?? legacy?.botToken ?? input.PI_RELAY_SLACK_BOT_TOKEN,
      signingSecret: messengers.slack?.default?.signingSecret ?? legacy?.signingSecret ?? input.PI_RELAY_SLACK_SIGNING_SECRET,
      eventMode: messengers.slack?.default?.eventMode ?? legacy?.eventMode ?? eventMode,
      workspaceId: messengers.slack?.default?.workspaceId ?? legacy?.workspaceId ?? input.PI_RELAY_SLACK_WORKSPACE_ID,
      allowUserIds: messengers.slack?.default?.allowUserIds ?? parseStringList(input.PI_RELAY_SLACK_ALLOW_USER_IDS) ?? legacy?.allowUserIds,
      allowChannelMessages: messengers.slack?.default?.allowChannelMessages ?? parseBoolean(input.PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES) ?? legacy?.allowChannelMessages,
    };
    messengers.slack = {
      ...messengers.slack,
      default: withLimits(base, legacy, {
        maxTextChars: input.PI_RELAY_SLACK_MAX_TEXT_CHARS,
        maxFileBytes: input.PI_RELAY_SLACK_MAX_FILE_BYTES,
        allowedImageMimeTypes: parseStringList(input.PI_RELAY_SLACK_ALLOWED_IMAGE_MIME_TYPES),
      }),
    };
  }

  return JSON.parse(JSON.stringify(canonical)) as RelayConfigFile;
}

export function legacyRelayConfigKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((key) => legacyTopLevelKeys.has(key));
}

export function hasLegacyRelayConfigKeys(input: Record<string, unknown>): boolean {
  return legacyRelayConfigKeys(input).length > 0;
}
