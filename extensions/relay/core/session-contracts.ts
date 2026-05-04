import type { MessengerRef } from "./messenger-ref.js";
import type { PlatformIdentity, RelayBinding } from "./adapter-contracts.js";

export type RelaySessionState = "online" | "offline";
export type RelayTurnState = "idle" | "busy" | "unknown";

export interface RelaySessionRouteDescriptor {
  sessionKey: string;
  sessionId: string;
  machineId: string;
  sessionFile?: string;
  sessionLabel: string;
  online: boolean;
  turnState: RelayTurnState;
  currentModel?: string;
  lastActivityAt?: number;
  bindings: RelayBinding[];
}

export interface RelayActiveSelection {
  messenger: MessengerRef;
  conversationId: string;
  userId: string;
  sessionKey: string;
  selectedAt: string;
  machineId?: string;
  machineDisplayName?: string;
}

export interface RelayActionScope {
  messenger: MessengerRef;
  conversationId: string;
  userId: string;
  sessionKey: string;
  turnId?: string;
}

export interface RelayActionState {
  id: string;
  scope: RelayActionScope;
  kind: "guided-answer" | "custom-answer" | "ambiguity" | "full-output" | "latest-images" | "dashboard" | (string & {});
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  payload?: Record<string, unknown>;
}

export interface RelayAuthorizationContext {
  messenger: MessengerRef;
  identity: PlatformIdentity;
  binding?: RelayBinding;
  allowUserIds: string[];
}
