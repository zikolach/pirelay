import { messengerRefsEqual } from "../core/messenger-ref.js";
import type { MessengerRef } from "../core/messenger-ref.js";
import type { RelaySessionRouteDescriptor } from "../core/session-contracts.js";
import type { BrokerRouteRegistration } from "./protocol.js";

export interface RegisteredBrokerRoute {
  route: RelaySessionRouteDescriptor;
  messengerRefs: MessengerRef[];
  ownerMachineId: string;
  local: boolean;
  registeredAt: string;
}

export class BrokerRouteRegistry {
  private readonly routes = new Map<string, RegisteredBrokerRoute>();

  registerLocalRoute(route: RelaySessionRouteDescriptor, messengerRefs: MessengerRef[], registeredAt = new Date().toISOString()): RegisteredBrokerRoute {
    const record: RegisteredBrokerRoute = {
      route,
      messengerRefs,
      ownerMachineId: route.machineId,
      local: true,
      registeredAt,
    };
    this.routes.set(route.sessionKey, record);
    return record;
  }

  registerRemoteRoute(registration: BrokerRouteRegistration): RegisteredBrokerRoute {
    const record: RegisteredBrokerRoute = {
      route: registration.route,
      messengerRefs: registration.messengerRefs,
      ownerMachineId: registration.route.machineId,
      local: false,
      registeredAt: registration.registeredAt,
    };
    this.routes.set(registration.route.sessionKey, record);
    return record;
  }

  unregisterRoute(sessionKey: string): boolean {
    return this.routes.delete(sessionKey);
  }

  markMachineOffline(machineId: string): string[] {
    const removed: string[] = [];
    for (const [sessionKey, route] of this.routes.entries()) {
      if (route.ownerMachineId === machineId) {
        this.routes.delete(sessionKey);
        removed.push(sessionKey);
      }
    }
    return removed;
  }

  get(sessionKey: string): RegisteredBrokerRoute | undefined {
    return this.routes.get(sessionKey);
  }

  list(): RegisteredBrokerRoute[] {
    return [...this.routes.values()];
  }

  listForMessenger(messenger: MessengerRef): RegisteredBrokerRoute[] {
    return this.list().filter((record) => record.messengerRefs.some((ref) => messengerRefsEqual(ref, messenger)));
  }
}
