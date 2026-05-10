import type { BrokerPeerConfig, MessengerIngressPolicy } from "../broker/protocol.js";
import type { MessengerKind, MessengerRef } from "../core/messenger-ref.js";

export interface RelayDefaultsConfig {
  pairingExpiryMs: number;
  busyDeliveryMode: "followUp" | "steer";
  maxTextChars: number;
  maxInboundImageBytes: number;
  maxOutboundImageBytes: number;
  allowedImageMimeTypes: string[];
}

export interface RelayMachineConfig {
  machineId: string;
  stateDir: string;
  displayName?: string;
  aliases: string[];
  brokerNamespace?: string;
  brokerGroup?: string;
  brokerPeers: BrokerPeerConfig[];
}

export interface MessengerSharedRoomConfig {
  enabled?: boolean;
  roomHint?: string;
  plainText?: "auto" | "enabled" | "addressed-only";
  machineAliases?: string[];
}

export interface MessengerLimitsConfig {
  maxTextChars?: number;
  maxFileBytes?: number;
  allowedImageMimeTypes?: string[];
}

export interface MessengerInstanceFileConfig {
  enabled?: boolean;
  displayName?: string;
  botToken?: string;
  token?: string;
  tokenEnv?: string;
  signingSecret?: string;
  signingSecretEnv?: string;
  appToken?: string;
  appTokenEnv?: string;
  botUserId?: string;
  applicationId?: string;
  clientId?: string;
  eventMode?: "socket" | "webhook";
  workspaceId?: string;
  allowUserIds?: string[];
  allowGuildChannels?: boolean;
  allowGuildIds?: string[];
  allowChannelMessages?: boolean;
  sharedRoom?: MessengerSharedRoomConfig;
  ingressPolicy?: MessengerIngressPolicy;
  ownerMachineId?: string;
  brokerGroup?: string;
  limits?: MessengerLimitsConfig;
}

export interface RelayConfigFile {
  relay?: Partial<RelayMachineConfig> & { machine?: { id?: string } };
  defaults?: Partial<RelayDefaultsConfig>;
  messengers?: Record<string, Record<string, MessengerInstanceFileConfig>>;
  // Legacy input accepted only by migration/canonicalization.
  botToken?: string;
  TELEGRAM_BOT_TOKEN?: string;
  stateDir?: string;
  pairingExpiryMs?: number;
  busyDeliveryMode?: "followUp" | "steer";
  maxTelegramMessageChars?: number;
  maxInboundImageBytes?: number;
  maxOutboundImageBytes?: number;
  allowedImageMimeTypes?: string[];
  allowUserIds?: number[];
  discord?: MessengerInstanceFileConfig;
  slack?: MessengerInstanceFileConfig;
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
  PI_RELAY_SLACK_WORKSPACE_ID?: string;
  PI_RELAY_SLACK_BOT_USER_ID?: string;
  PI_RELAY_SLACK_ALLOW_USER_IDS?: string;
  PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES?: string;
  PI_RELAY_SLACK_MAX_TEXT_CHARS?: string;
  PI_RELAY_SLACK_MAX_FILE_BYTES?: string;
  PI_RELAY_SLACK_ALLOWED_IMAGE_MIME_TYPES?: string;
}

export interface ResolvedMessengerInstanceConfig {
  ref: MessengerRef;
  enabled: boolean;
  displayName: string;
  token?: string;
  tokenEnv?: string;
  signingSecret?: string;
  signingSecretEnv?: string;
  appToken?: string;
  appTokenEnv?: string;
  botUserId?: string;
  applicationId?: string;
  clientId?: string;
  eventMode?: "socket" | "webhook";
  workspaceId?: string;
  allowUserIds: string[];
  allowGuildChannels?: boolean;
  allowGuildIds: string[];
  allowChannelMessages?: boolean;
  sharedRoom: MessengerSharedRoomConfig;
  ingressPolicy: MessengerIngressPolicy;
  ownerMachineId?: string;
  brokerGroup?: string;
  limits: Required<MessengerLimitsConfig>;
  unsupported: boolean;
}

export interface ResolvedRelayConfig {
  configPath: string;
  relay: RelayMachineConfig;
  defaults: RelayDefaultsConfig;
  messengers: ResolvedMessengerInstanceConfig[];
  warnings: string[];
}

export interface RelayConfigLoadOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  supportedMessengers?: readonly MessengerKind[];
}

export class RelayConfigError extends Error {}
