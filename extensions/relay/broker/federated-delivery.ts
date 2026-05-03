import type { MessengerRef } from "../core/messenger-ref.js";
import type { RelayInboundEvent, RelayOutboundPayload } from "../core/adapter-contracts.js";
import type { BrokerFederationMessage } from "./protocol.js";
import { BrokerRouteRegistry } from "./route-registry.js";

export type FederatedDeliveryResult =
  | { status: "local"; sessionKey: string }
  | { status: "forwarded"; sessionKey: string; machineId: string }
  | { status: "offline"; sessionKey: string; reason: string };

export interface BrokerPeerMessageTransport {
  send(machineId: string, message: BrokerFederationMessage): Promise<void>;
}

export class FederatedDeliveryRouter {
  constructor(
    private readonly registry: BrokerRouteRegistry,
    private readonly transport: BrokerPeerMessageTransport,
  ) {}

  async deliverPrompt(input: {
    targetSessionKey: string;
    ingressMessenger: MessengerRef;
    event: RelayInboundEvent;
    requestedAt?: string;
  }): Promise<FederatedDeliveryResult> {
    const route = this.registry.get(input.targetSessionKey);
    if (!route) return { status: "offline", sessionKey: input.targetSessionKey, reason: "No online route is registered for that session." };
    if (route.local) return { status: "local", sessionKey: input.targetSessionKey };
    try {
      await this.transport.send(route.ownerMachineId, {
        kind: "prompt-deliver",
        delivery: {
          protocolVersion: 1,
          targetSessionKey: input.targetSessionKey,
          ingressMessenger: input.ingressMessenger,
          event: input.event,
          requestedAt: input.requestedAt ?? new Date().toISOString(),
        },
      });
      return { status: "forwarded", sessionKey: input.targetSessionKey, machineId: route.ownerMachineId };
    } catch (error) {
      return { status: "offline", sessionKey: input.targetSessionKey, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async forwardOutbound(input: {
    sourceSessionKey: string;
    payload: RelayOutboundPayload;
    requestedAt?: string;
  }): Promise<FederatedDeliveryResult> {
    const route = this.registry.get(input.sourceSessionKey);
    if (!route) return { status: "offline", sessionKey: input.sourceSessionKey, reason: "No online route is registered for that session." };
    if (route.local) return { status: "local", sessionKey: input.sourceSessionKey };
    try {
      await this.transport.send(route.ownerMachineId, {
        kind: "outbound-deliver",
        outbound: {
          protocolVersion: 1,
          sourceSessionKey: input.sourceSessionKey,
          payload: input.payload,
          requestedAt: input.requestedAt ?? new Date().toISOString(),
        },
      });
      return { status: "forwarded", sessionKey: input.sourceSessionKey, machineId: route.ownerMachineId };
    } catch (error) {
      return { status: "offline", sessionKey: input.sourceSessionKey, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
