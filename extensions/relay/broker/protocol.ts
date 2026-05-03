import type { MessengerRef } from "../core/messenger-ref.js";
import type { RelayInboundEvent, RelayOutboundPayload } from "../core/adapter-contracts.js";
import type { RelaySessionRouteDescriptor } from "../core/session-contracts.js";

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

export type BrokerFederationMessage =
  | { kind: "route-register"; registration: BrokerRouteRegistration }
  | { kind: "route-unregister"; sessionKey: string; machineId: string; at: string }
  | { kind: "prompt-deliver"; delivery: BrokerPromptDeliveryEnvelope }
  | { kind: "outbound-deliver"; outbound: BrokerOutboundEnvelope }
  | { kind: "peer-offline"; machineId: string; reason?: string; at: string };
