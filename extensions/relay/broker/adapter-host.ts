import { formatMessengerRef } from "../core/messenger-ref.js";
import type { MessengerRef } from "../core/messenger-ref.js";
import type { MessengerAdapter, MessengerInboundHandler } from "../core/adapter-contracts.js";
import { resolveMessengerIngressOwnership } from "./ownership.js";
import type { MessengerOwnershipDecision, MessengerOwnershipInput } from "./ownership.js";

export interface MessengerAdapterRegistration {
  ref: MessengerRef;
  enabled: boolean;
  token?: string;
  adapter: MessengerAdapter;
  ownership: Omit<MessengerOwnershipInput, "messenger" | "token">;
}

export type MessengerAdapterLifecyclePlan =
  | { kind: "start"; ref: MessengerRef; adapter: MessengerAdapter; ownership: Extract<MessengerOwnershipDecision, { kind: "owner" }> }
  | { kind: "skip"; ref: MessengerRef; reason: string; ownership: Exclude<MessengerOwnershipDecision, { kind: "owner" }> };

export function planMessengerAdapterLifecycles(registrations: MessengerAdapterRegistration[]): MessengerAdapterLifecyclePlan[] {
  return registrations.map((registration) => {
    if (!registration.enabled) {
      return {
        kind: "skip",
        ref: registration.ref,
        reason: "Messenger disabled by config.",
        ownership: { kind: "disabled", messenger: registration.ref, reason: "Messenger disabled by config." },
      };
    }
    const ownership = resolveMessengerIngressOwnership({
      ...registration.ownership,
      messenger: registration.ref,
      token: registration.token,
    });
    if (ownership.kind === "owner") return { kind: "start", ref: registration.ref, adapter: registration.adapter, ownership };
    const reason = ownership.kind === "non-owner" ? `Ingress owned by ${ownership.ownerMachineId}.` : ownership.reason;
    return { kind: "skip", ref: registration.ref, reason, ownership };
  });
}

export class MessengerAdapterHost {
  private readonly started = new Map<string, MessengerAdapter>();

  constructor(private readonly registrations: MessengerAdapterRegistration[]) {}

  lifecyclePlan(): MessengerAdapterLifecyclePlan[] {
    return planMessengerAdapterLifecycles(this.registrations);
  }

  async startOwnedIngress(handler: MessengerInboundHandler): Promise<MessengerAdapterLifecyclePlan[]> {
    const plan = this.lifecyclePlan();
    for (const item of plan) {
      if (item.kind !== "start") continue;
      if (!item.adapter.startIngress) continue;
      await item.adapter.startIngress(handler);
      this.started.set(formatMessengerRef(item.ref), item.adapter);
    }
    return plan;
  }

  async stopStartedIngress(): Promise<void> {
    for (const adapter of this.started.values()) {
      await adapter.stopIngress?.();
    }
    this.started.clear();
  }

  startedRefs(): string[] {
    return [...this.started.keys()].sort();
  }
}
