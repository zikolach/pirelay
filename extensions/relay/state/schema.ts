import type { MessengerRef } from "../core/messenger-ref.js";
import type { RelayBinding, RelayPendingPairing } from "../core/adapter-contracts.js";
import type { RelayActionState, RelayActiveSelection, RelaySessionRouteDescriptor } from "../core/session-contracts.js";

export interface RelayPersistedBindingRecord extends RelayBinding {
  status: "active" | "revoked";
}

export interface RelayStateMigrationRecord {
  id: string;
  source: "telegram-tunnel" | (string & {});
  migratedAt: string;
  sourceStatePath?: string;
  importedBindings: number;
  skippedPendingPairings: number;
}

export interface RelayStoreData {
  version: 1;
  pendingPairings: Record<string, RelayPendingPairing>;
  messengerBindings: Record<string, RelayPersistedBindingRecord>;
  activeSelections: Record<string, RelayActiveSelection>;
  actions: Record<string, RelayActionState>;
  routes: Record<string, RelaySessionRouteDescriptor>;
  migrations: RelayStateMigrationRecord[];
}

export function emptyRelayStore(): RelayStoreData {
  return {
    version: 1,
    pendingPairings: {},
    messengerBindings: {},
    activeSelections: {},
    actions: {},
    routes: {},
    migrations: [],
  };
}

export function relayBindingStorageKey(messenger: MessengerRef, sessionKey: string): string {
  return `${messenger.kind}:${messenger.instanceId}:${sessionKey}`;
}

export function relaySelectionStorageKey(messenger: MessengerRef, conversationId: string, userId: string): string {
  return `${messenger.kind}:${messenger.instanceId}:${conversationId}:${userId}`;
}
