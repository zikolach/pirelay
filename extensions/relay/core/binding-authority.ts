import type { ChannelAdapterKind, ChannelBinding } from "./channel-adapter.js";
import type { ChannelPersistedBindingRecord, PersistedBindingRecord, TelegramBindingMetadata, TunnelStoreData } from "./types.js";

export type BindingAuthorityState =
  | { kind: "loaded"; data: TunnelStoreData; missing?: boolean }
  | { kind: "state-unavailable"; error?: unknown };

export type BindingAuthorityKind = "active" | "paused" | "revoked" | "moved" | "missing" | "state-unavailable";

export type BindingAuthorityOutcome<TBinding> =
  | { kind: "active"; source: "persisted" | "volatile"; binding: TBinding }
  | { kind: "paused"; binding: TBinding }
  | { kind: "revoked"; binding: TBinding }
  | { kind: "moved"; binding: TBinding }
  | { kind: "missing" }
  | { kind: "state-unavailable"; error?: unknown };

export interface TelegramBindingAuthorityExpected {
  sessionKey: string;
  chatId?: number;
  userId?: number;
  includePaused?: boolean;
  allowVolatileFallback?: boolean;
}

export interface ChannelBindingAuthorityExpected {
  channel: ChannelAdapterKind;
  sessionKey: string;
  instanceId?: string;
  conversationId?: string;
  userId?: string;
  includePaused?: boolean;
  allowVolatileFallback?: boolean;
}

export interface TelegramDestinationKeyInput {
  sessionKey: string;
  chatId: number;
  userId?: number;
}

export interface ChannelDestinationKeyInput {
  channel: ChannelAdapterKind;
  instanceId?: string;
  sessionKey: string;
  conversationId: string;
  userId?: string;
}

export function bindingAuthorityStateFromData(data: TunnelStoreData, options: { missing?: boolean } = {}): BindingAuthorityState {
  return { kind: "loaded", data, missing: options.missing };
}

export function stateUnavailableBindingAuthority(error?: unknown): BindingAuthorityState {
  return { kind: "state-unavailable", error };
}

export function resolveTelegramBindingAuthority(
  snapshot: BindingAuthorityState,
  expected: TelegramBindingAuthorityExpected,
  volatileCandidate?: TelegramBindingMetadata | PersistedBindingRecord,
): BindingAuthorityOutcome<PersistedBindingRecord | TelegramBindingMetadata> {
  if (snapshot.kind === "state-unavailable") return { kind: "state-unavailable", error: snapshot.error };
  const persisted = snapshot.data.bindings[expected.sessionKey];
  if (persisted) return classifyTelegramPersisted(persisted, expected);
  return resolveTelegramVolatileFallback(expected, volatileCandidate);
}

export function resolveChannelBindingAuthority(
  snapshot: BindingAuthorityState,
  expected: ChannelBindingAuthorityExpected,
  volatileCandidate?: ChannelBinding | ChannelPersistedBindingRecord,
): BindingAuthorityOutcome<ChannelBinding | ChannelPersistedBindingRecord> {
  if (snapshot.kind === "state-unavailable") return { kind: "state-unavailable", error: snapshot.error };
  const persisted = findChannelBinding(snapshot.data, expected.channel, expected.sessionKey, expected.instanceId ?? "default");
  if (persisted) return classifyChannelPersisted(persisted, expected);
  return resolveChannelVolatileFallback(expected, volatileCandidate);
}

export function authorityOutcomeAllowsDelivery<TBinding>(outcome: BindingAuthorityOutcome<TBinding>): outcome is { kind: "active"; source: "persisted" | "volatile"; binding: TBinding } {
  return outcome.kind === "active";
}

export function telegramDestinationKey(input: TelegramDestinationKeyInput): string {
  return ["telegram", "default", input.sessionKey, String(input.chatId), input.userId === undefined ? "" : String(input.userId)].join(":");
}

export function channelDestinationKey(input: ChannelDestinationKeyInput): string {
  return [input.channel, input.instanceId ?? "default", input.sessionKey, input.conversationId, input.userId ?? ""].join(":");
}

export function bindingAuthorityDiagnostic(outcome: BindingAuthorityOutcome<unknown>): string | undefined {
  switch (outcome.kind) {
    case "state-unavailable":
      return "Relay state is unavailable; protected messenger delivery was suppressed.";
    case "revoked":
      return "Relay binding is revoked; protected messenger delivery was suppressed.";
    case "paused":
      return "Relay binding is paused; protected messenger delivery was suppressed.";
    case "moved":
      return "Relay binding moved; stale messenger delivery was suppressed.";
    case "missing":
      return "Relay binding is missing; protected messenger delivery was suppressed.";
    case "active":
      return undefined;
  }
}

function classifyTelegramPersisted(binding: PersistedBindingRecord, expected: TelegramBindingAuthorityExpected): BindingAuthorityOutcome<PersistedBindingRecord> {
  if (binding.status === "revoked" || binding.revokedAt) return { kind: "revoked", binding };
  if (!telegramMatches(binding, expected)) return { kind: "moved", binding };
  if (binding.paused && !expected.includePaused) return { kind: "paused", binding };
  return { kind: "active", source: "persisted", binding };
}

function classifyChannelPersisted(binding: ChannelPersistedBindingRecord, expected: ChannelBindingAuthorityExpected): BindingAuthorityOutcome<ChannelPersistedBindingRecord> {
  const instanceId = expected.instanceId ?? "default";
  if (binding.status === "revoked" || binding.revokedAt) return { kind: "revoked", binding };
  if (binding.channel !== expected.channel || (binding.instanceId ?? "default") !== instanceId || binding.sessionKey !== expected.sessionKey) return { kind: "moved", binding };
  if (!channelMatches(binding, expected)) return { kind: "moved", binding };
  if (binding.paused && !expected.includePaused) return { kind: "paused", binding };
  return { kind: "active", source: "persisted", binding };
}

function resolveTelegramVolatileFallback(expected: TelegramBindingAuthorityExpected, volatileCandidate?: TelegramBindingMetadata | PersistedBindingRecord): BindingAuthorityOutcome<PersistedBindingRecord | TelegramBindingMetadata> {
  if (!expected.allowVolatileFallback || !volatileCandidate) return { kind: "missing" };
  if ("status" in volatileCandidate && volatileCandidate.status === "revoked") return { kind: "missing" };
  if (volatileCandidate.revokedAt || volatileCandidate.paused) return { kind: "missing" };
  if (!telegramMatches(volatileCandidate, expected)) return { kind: "missing" };
  return { kind: "active", source: "volatile", binding: volatileCandidate };
}

function resolveChannelVolatileFallback(expected: ChannelBindingAuthorityExpected, volatileCandidate?: ChannelBinding | ChannelPersistedBindingRecord): BindingAuthorityOutcome<ChannelBinding | ChannelPersistedBindingRecord> {
  if (!expected.allowVolatileFallback || !volatileCandidate) return { kind: "missing" };
  if ("status" in volatileCandidate && volatileCandidate.status === "revoked") return { kind: "missing" };
  if (volatileCandidate.revokedAt || volatileCandidate.paused) return { kind: "missing" };
  const instanceId = expected.instanceId ?? "default";
  if (volatileCandidate.channel !== expected.channel || (volatileCandidate.instanceId ?? "default") !== instanceId || volatileCandidate.sessionKey !== expected.sessionKey) return { kind: "missing" };
  if (!channelMatches(volatileCandidate, expected)) return { kind: "missing" };
  return { kind: "active", source: "volatile", binding: volatileCandidate };
}

function telegramMatches(binding: TelegramBindingMetadata, expected: TelegramBindingAuthorityExpected): boolean {
  if (binding.sessionKey !== expected.sessionKey) return false;
  if (expected.chatId !== undefined && binding.chatId !== expected.chatId) return false;
  if (expected.userId !== undefined && binding.userId !== expected.userId) return false;
  return true;
}

function channelMatches(binding: ChannelBinding, expected: ChannelBindingAuthorityExpected): boolean {
  if (expected.conversationId !== undefined && binding.conversationId !== expected.conversationId) return false;
  if (expected.userId !== undefined && binding.userId !== expected.userId) return false;
  return true;
}

function findChannelBinding(data: TunnelStoreData, channel: ChannelAdapterKind, sessionKey: string, instanceId: string): ChannelPersistedBindingRecord | undefined {
  return Object.values(data.channelBindings).find((binding) => binding.channel === channel && binding.sessionKey === sessionKey && (binding.instanceId ?? "default") === instanceId);
}
