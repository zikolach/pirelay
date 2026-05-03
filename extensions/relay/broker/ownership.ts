import { createHash } from "node:crypto";
import type { MessengerRef } from "../core/messenger-ref.js";
import type { MessengerIngressPolicy } from "./protocol.js";

export interface MessengerOwnershipInput {
  messenger: MessengerRef;
  localMachineId: string;
  token?: string;
  tokenFingerprint?: string;
  policy: MessengerIngressPolicy;
  brokerGroup?: string;
  knownOwnerMachineId?: string;
}

export type MessengerOwnershipDecision =
  | { kind: "owner"; messenger: MessengerRef; ownerMachineId: string; botFingerprint?: string }
  | { kind: "non-owner"; messenger: MessengerRef; ownerMachineId: string; botFingerprint?: string }
  | { kind: "disabled"; messenger: MessengerRef; reason: string; botFingerprint?: string }
  | { kind: "ambiguous"; messenger: MessengerRef; reason: string; botFingerprint?: string };

export function botTokenFingerprint(kind: string, token: string): string {
  return createHash("sha256").update(`${kind}\0${token}`).digest("hex").slice(0, 16);
}

export function resolveMessengerIngressOwnership(input: MessengerOwnershipInput): MessengerOwnershipDecision {
  const botFingerprint = input.tokenFingerprint ?? (input.token ? botTokenFingerprint(input.messenger.kind, input.token) : undefined);
  if (input.policy.kind === "disabled") return { kind: "disabled", messenger: input.messenger, reason: "Ingress disabled by config.", botFingerprint };
  if (input.policy.kind === "owner") {
    if (input.policy.machineId === input.localMachineId) {
      return { kind: "owner", messenger: input.messenger, ownerMachineId: input.localMachineId, botFingerprint };
    }
    return { kind: "non-owner", messenger: input.messenger, ownerMachineId: input.policy.machineId, botFingerprint };
  }
  if (input.knownOwnerMachineId) {
    if (input.knownOwnerMachineId === input.localMachineId) return { kind: "owner", messenger: input.messenger, ownerMachineId: input.localMachineId, botFingerprint };
    return { kind: "non-owner", messenger: input.messenger, ownerMachineId: input.knownOwnerMachineId, botFingerprint };
  }
  if (input.brokerGroup) {
    return {
      kind: "ambiguous",
      messenger: input.messenger,
      reason: "Auto ingress policy in a broker group requires an explicit owner or lease before polling.",
      botFingerprint,
    };
  }
  return { kind: "owner", messenger: input.messenger, ownerMachineId: input.localMachineId, botFingerprint };
}

export interface DuplicateBotInstance {
  fingerprint: string;
  refs: MessengerRef[];
}

export function findDuplicateBotInstances(instances: Array<{ ref: MessengerRef; token?: string; tokenFingerprint?: string }>): DuplicateBotInstance[] {
  const byFingerprint = new Map<string, MessengerRef[]>();
  for (const instance of instances) {
    const fingerprint = instance.tokenFingerprint ?? (instance.token ? botTokenFingerprint(instance.ref.kind, instance.token) : undefined);
    if (!fingerprint) continue;
    const refs = byFingerprint.get(fingerprint) ?? [];
    refs.push(instance.ref);
    byFingerprint.set(fingerprint, refs);
  }
  return [...byFingerprint.entries()]
    .filter(([, refs]) => refs.length > 1)
    .map(([fingerprint, refs]) => ({ fingerprint, refs }));
}
