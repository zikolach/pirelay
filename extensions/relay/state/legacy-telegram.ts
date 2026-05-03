import type { RelayBinding } from "../core/adapter-contracts.js";
import type { RelayPersistedBindingRecord } from "./schema.js";

export interface LegacyTelegramBindingRecord {
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  chatId: number;
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  boundAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  paused?: boolean;
  alias?: string;
  progressMode?: string;
  status?: string;
}

export interface LegacyChannelBindingRecord {
  channel: string;
  conversationId: string;
  userId: string;
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  boundAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  paused?: boolean;
  identity?: RelayBinding["identity"];
  metadata?: Record<string, unknown>;
  status?: string;
}

export interface LegacyPendingPairingRecord {
  nonceHash: string;
  channel?: string;
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface LegacyTelegramTunnelStoreData {
  setup?: unknown;
  pendingPairings?: Record<string, LegacyPendingPairingRecord>;
  bindings?: Record<string, LegacyTelegramBindingRecord>;
  channelBindings?: Record<string, LegacyChannelBindingRecord>;
}

export function legacyTelegramBindingToRelayBinding(binding: LegacyTelegramBindingRecord): RelayPersistedBindingRecord {
  return {
    messenger: { kind: "telegram", instanceId: "default" },
    conversationId: String(binding.chatId),
    userId: String(binding.userId),
    sessionKey: binding.sessionKey,
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    sessionLabel: binding.sessionLabel,
    boundAt: binding.boundAt,
    lastSeenAt: binding.lastSeenAt,
    revokedAt: binding.revokedAt,
    paused: binding.paused,
    alias: binding.alias,
    identity: {
      username: binding.username,
      firstName: binding.firstName,
      lastName: binding.lastName,
      displayName: binding.username ?? ([binding.firstName, binding.lastName].filter(Boolean).join(" ") || undefined),
    },
    metadata: {
      legacySource: "telegram-tunnel.bindings",
      progressMode: binding.progressMode,
    },
    status: binding.revokedAt || binding.status === "revoked" ? "revoked" : "active",
  };
}

export function legacyChannelBindingToRelayBinding(binding: LegacyChannelBindingRecord): RelayPersistedBindingRecord {
  return {
    messenger: { kind: binding.channel, instanceId: "default" },
    conversationId: binding.conversationId,
    userId: binding.userId,
    sessionKey: binding.sessionKey,
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    sessionLabel: binding.sessionLabel,
    boundAt: binding.boundAt,
    lastSeenAt: binding.lastSeenAt,
    revokedAt: binding.revokedAt,
    paused: binding.paused,
    identity: binding.identity,
    metadata: {
      ...binding.metadata,
      legacySource: "telegram-tunnel.channelBindings",
    },
    status: binding.revokedAt || binding.status === "revoked" ? "revoked" : "active",
  };
}
