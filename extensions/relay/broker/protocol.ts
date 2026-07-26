import type { MessengerRef } from "../core/messenger-ref.js";
import type { RelayInboundEvent, RelayOutboundPayload } from "../core/adapter-contracts.js";
import type { RelaySessionRouteDescriptor } from "../core/session-contracts.js";
import type { ApprovalDecisionKind, ApprovalRiskCategory } from "../core/approval-gates.js";
import type { RelayFileDeliveryRequester } from "../core/requester-file-delivery.js";
import type { RelayRouteState } from "../core/relay-core.js";

export type BrokerEpoch = string;

export const MAX_BROKER_RECONCILIATION_ROUTES = 64;
export const MAX_BROKER_RECONCILIATION_PAYLOAD_BYTES = 256 * 1024;

export interface BrokerRouteReconciliationRequest {
  clientId: string;
  observedBrokerEpoch?: BrokerEpoch;
  routes: RelayRouteState[];
}

export type BrokerRouteReconciliationRejectionCode =
  | "invalid-request"
  | "payload-too-large"
  | "too-many-routes"
  | "duplicate-route"
  | "stale-epoch";

export interface BrokerRouteReconciliationRejection {
  index?: number;
  code: BrokerRouteReconciliationRejectionCode;
  safeMessage: string;
}

export interface BrokerRouteReconciliationResponse {
  brokerEpoch: BrokerEpoch;
  acceptedSessionKeys: string[];
  rejected: BrokerRouteReconciliationRejection[];
}

export interface BrokerHealthSnapshot {
  brokerEpoch: BrokerEpoch;
  connectedClientCount: number;
  registeredRouteCount: number;
}

export type BrokerTransportHealth = "disconnected" | "connecting" | "connected" | "reconnecting" | "unavailable";
export type BrokerRouteSynchronizationHealth = "unknown" | "pending" | "synchronized" | "missing" | "rejected";

export interface BrokerClientSynchronizationState {
  transport: BrokerTransportHealth;
  brokerEpoch?: BrokerEpoch;
  routes: Readonly<Record<string, BrokerRouteSynchronizationHealth>>;
}

export type BrokerPeerAuthKind = "shared-secret" | "keypair";

export interface BrokerPeerConfig {
  peerId: string;
  machineId: string;
  url?: string;
  authKind: BrokerPeerAuthKind;
  secretEnv?: string;
  publicKey?: string;
}

export type MessengerIngressPolicy =
  | { kind: "auto" }
  | { kind: "owner"; machineId: string }
  | { kind: "disabled" };

export interface MessengerOwnershipDescriptor {
  messenger: MessengerRef;
  botFingerprint?: string;
  policy: MessengerIngressPolicy;
  ownerMachineId?: string;
  brokerGroup?: string;
}

export interface BrokerRouteRegistration {
  protocolVersion: 1;
  route: RelaySessionRouteDescriptor;
  messengerRefs: MessengerRef[];
  registeredAt: string;
}

export interface BrokerPromptDeliveryEnvelope {
  protocolVersion: 1;
  targetSessionKey: string;
  ingressMessenger: MessengerRef;
  event: RelayInboundEvent;
  requestedAt: string;
}

export interface BrokerOutboundEnvelope {
  protocolVersion: 1;
  sourceSessionKey: string;
  payload: RelayOutboundPayload;
  requestedAt: string;
}

export interface BrokerApprovalRequestEnvelope {
  protocolVersion: 1;
  targetSessionKey: string;
  approvalId: string;
  operationId: string;
  requester: RelayFileDeliveryRequester;
  toolName: string;
  category: ApprovalRiskCategory;
  safeSummary: string;
  matcherFingerprint: string;
  expiresAt: string;
  requestedAt: string;
}

export interface BrokerApprovalDecisionEnvelope {
  protocolVersion: 1;
  targetSessionKey: string;
  approvalId: string;
  decision: ApprovalDecisionKind;
  requester: RelayFileDeliveryRequester;
  decidedAt: string;
}

export interface BrokerApprovalFailureEnvelope {
  protocolVersion: 1;
  targetSessionKey: string;
  approvalId: string;
  reason: string;
  failedAt: string;
}

export type BrokerFederationMessage =
  | { kind: "route-register"; registration: BrokerRouteRegistration }
  | { kind: "route-unregister"; sessionKey: string; machineId: string; at: string }
  | { kind: "prompt-deliver"; delivery: BrokerPromptDeliveryEnvelope }
  | { kind: "outbound-deliver"; outbound: BrokerOutboundEnvelope }
  | { kind: "approval-request"; approval: BrokerApprovalRequestEnvelope }
  | { kind: "approval-decision"; decision: BrokerApprovalDecisionEnvelope }
  | { kind: "approval-cancel"; failure: BrokerApprovalFailureEnvelope }
  | { kind: "approval-timeout"; failure: BrokerApprovalFailureEnvelope }
  | { kind: "approval-failed"; failure: BrokerApprovalFailureEnvelope }
  | { kind: "peer-offline"; machineId: string; reason?: string; at: string };
