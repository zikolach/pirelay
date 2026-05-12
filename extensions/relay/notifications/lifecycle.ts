import type { ChannelAdapterKind } from "../core/channel-adapter.js";

export type RelayLifecycleEventKind = "offline" | "online" | "disconnected";
export type RelayLifecycleState = "online" | "offline" | "disconnected";

export interface RelayLifecycleNotificationRecord {
  channel: ChannelAdapterKind;
  instanceId: string;
  sessionKey: string;
  conversationId: string;
  userId: string;
  state: RelayLifecycleState;
  updatedAt: string;
  lastNotifiedAt?: string;
  lastEvent?: RelayLifecycleEventKind;
}

export interface RelayLifecycleNotificationDecision {
  shouldNotify: boolean;
  record: RelayLifecycleNotificationRecord;
}

export const DEFAULT_LIFECYCLE_DEBOUNCE_MS = 60_000;

export function formatRelayLifecycleNotification(input: { kind: RelayLifecycleEventKind; sessionLabel: string; channel?: ChannelAdapterKind }): string {
  const trimmedLabel = input.sessionLabel.trim();
  const subject = trimmedLabel ? `Pi session ${trimmedLabel}` : "Pi session";
  switch (input.kind) {
    case "offline":
      return `${subject} went offline locally. Restart Pi to resume relay control.`;
    case "online":
      return `${subject} is back online.`;
    case "disconnected":
      return input.channel === "slack"
        ? `PiRelay was disconnected locally for ${subject}. This chat is no longer paired; run \`pirelay pair <pin>\` from a fresh local pairing to reconnect.`
        : `PiRelay was disconnected locally for ${subject}. This chat is no longer paired; start a fresh local pairing to reconnect.`;
  }
}

export function relayLifecycleStorageKey(input: { channel: ChannelAdapterKind; instanceId?: string; sessionKey: string; conversationId: string; userId: string }): string {
  return [input.channel, input.instanceId ?? "default", input.sessionKey, input.conversationId, input.userId].join(":");
}

export function decideRelayLifecycleNotification(input: {
  previous?: RelayLifecycleNotificationRecord;
  channel: ChannelAdapterKind;
  instanceId?: string;
  sessionKey: string;
  conversationId: string;
  userId: string;
  kind: RelayLifecycleEventKind;
  nowIso?: string;
  debounceMs?: number;
}): RelayLifecycleNotificationDecision {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const nextState = lifecycleStateForEvent(input.kind);
  const base: RelayLifecycleNotificationRecord = {
    channel: input.channel,
    instanceId: input.instanceId ?? "default",
    sessionKey: input.sessionKey,
    conversationId: input.conversationId,
    userId: input.userId,
    state: nextState,
    updatedAt: nowIso,
    lastNotifiedAt: input.previous?.lastNotifiedAt,
    lastEvent: input.previous?.lastEvent,
  };

  const shouldNotify = shouldNotifyLifecycle({ previous: input.previous, kind: input.kind, nowIso, debounceMs: input.debounceMs ?? DEFAULT_LIFECYCLE_DEBOUNCE_MS });
  return {
    shouldNotify,
    record: {
      ...base,
      lastNotifiedAt: shouldNotify ? nowIso : base.lastNotifiedAt,
      lastEvent: shouldNotify ? input.kind : base.lastEvent,
    },
  };
}

function lifecycleStateForEvent(kind: RelayLifecycleEventKind): RelayLifecycleState {
  if (kind === "online") return "online";
  if (kind === "offline") return "offline";
  return "disconnected";
}

function shouldNotifyLifecycle(input: { previous?: RelayLifecycleNotificationRecord; kind: RelayLifecycleEventKind; nowIso: string; debounceMs: number }): boolean {
  if (input.kind === "online") return input.previous?.state === "offline" && !withinDebounce(input.previous, input.kind, input.nowIso, input.debounceMs);
  if (!input.previous) return true;
  if (input.previous.state !== lifecycleStateForEvent(input.kind)) return true;
  return !withinDebounce(input.previous, input.kind, input.nowIso, input.debounceMs);
}

function withinDebounce(previous: RelayLifecycleNotificationRecord, kind: RelayLifecycleEventKind, nowIso: string, debounceMs: number): boolean {
  if (previous.lastEvent !== kind || !previous.lastNotifiedAt) return false;
  const last = Date.parse(previous.lastNotifiedAt);
  const now = Date.parse(nowIso);
  return Number.isFinite(last) && Number.isFinite(now) && now - last < debounceMs;
}
