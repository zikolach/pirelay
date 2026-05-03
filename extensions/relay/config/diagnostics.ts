import { formatMessengerRef } from "../core/messenger-ref.js";
import { findDuplicateBotInstances, resolveMessengerIngressOwnership } from "../broker/ownership.js";
import type { ResolvedRelayConfig } from "./schema.js";

export interface RelayDiagnosticItem {
  level: "ok" | "warning" | "error";
  message: string;
}

export function collectRelayDiagnostics(config: ResolvedRelayConfig): RelayDiagnosticItem[] {
  const items: RelayDiagnosticItem[] = [];
  items.push({ level: "ok", message: `Machine: ${config.relay.machineId}` });
  items.push({ level: "ok", message: `State: ${config.relay.stateDir}` });

  for (const warning of config.warnings) items.push({ level: "warning", message: warning });

  const duplicates = findDuplicateBotInstances(config.messengers.map((messenger) => ({ ref: messenger.ref, token: messenger.token })));
  for (const duplicate of duplicates) {
    items.push({
      level: "error",
      message: `Duplicate bot/account fingerprint ${duplicate.fingerprint} is configured for ${duplicate.refs.map(formatMessengerRef).join(", ")}; configure one ingress owner.`,
    });
  }

  for (const messenger of config.messengers) {
    const ref = formatMessengerRef(messenger.ref);
    if (messenger.unsupported) {
      items.push({ level: "warning", message: `${ref}: configured but adapter is not installed.` });
      continue;
    }
    if (!messenger.enabled) {
      items.push({ level: "ok", message: `${ref}: disabled.` });
      continue;
    }
    if (!messenger.token && messenger.ref.kind !== "slack") {
      items.push({ level: "error", message: `${ref}: enabled but missing bot token.` });
      continue;
    }
    if (messenger.ref.kind === "slack" && (!messenger.token || !messenger.signingSecret)) {
      items.push({ level: "error", message: `${ref}: enabled but missing Slack bot token or signing secret.` });
      continue;
    }
    const ownership = resolveMessengerIngressOwnership({
      messenger: messenger.ref,
      localMachineId: config.relay.machineId,
      token: messenger.token,
      policy: messenger.ingressPolicy,
      brokerGroup: messenger.brokerGroup,
      knownOwnerMachineId: messenger.ownerMachineId,
    });
    if (ownership.kind === "owner") items.push({ level: "ok", message: `${ref}: ingress owner on ${ownership.ownerMachineId}.` });
    if (ownership.kind === "non-owner") items.push({ level: "ok", message: `${ref}: ingress owned by ${ownership.ownerMachineId}; local broker will use federation.` });
    if (ownership.kind === "disabled") items.push({ level: "warning", message: `${ref}: ${ownership.reason}` });
    if (ownership.kind === "ambiguous") items.push({ level: "error", message: `${ref}: ${ownership.reason}` });
  }

  return items;
}

export function renderRelayDiagnostics(config: ResolvedRelayConfig): string {
  return collectRelayDiagnostics(config)
    .map((item) => `${item.level.toUpperCase()}: ${item.message}`)
    .join("\n");
}
