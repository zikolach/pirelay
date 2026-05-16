import { formatMessengerRef } from "../core/messenger-ref.js";
import { findDuplicateBotInstances, resolveMessengerIngressOwnership } from "../broker/ownership.js";
import type { ResolvedRelayConfig } from "./schema.js";

export interface RelayDiagnosticItem {
  level: "ok" | "warning" | "error";
  message: string;
}

export function collectRelayDiagnostics(config: ResolvedRelayConfig): RelayDiagnosticItem[] {
  const items: RelayDiagnosticItem[] = [];
  items.push({ level: "ok", message: `Machine: ${config.relay.machineId}${config.relay.displayName ? ` (${config.relay.displayName})` : ""}` });
  if (config.relay.aliases.length > 0) items.push({ level: "ok", message: `Machine aliases: ${config.relay.aliases.join(", ")}` });
  items.push({ level: "ok", message: `State: ${config.relay.stateDir}` });

  for (const warning of config.warnings) items.push({ level: "warning", message: warning });

  const duplicates = findDuplicateBotInstances(config.messengers.map((messenger) => ({ ref: messenger.ref, token: messenger.token })));
  for (const duplicate of duplicates) {
    items.push({
      level: "error",
      message: `Duplicate bot/account fingerprint ${duplicate.fingerprint} is configured for ${duplicate.refs.map(formatMessengerRef).join(", ")}; shared-room machine-bot mode requires distinct bot/app identities, or configure one ingress owner with federation.`,
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
    if (messenger.sharedRoom.enabled) {
      items.push({ level: "ok", message: `${ref}: shared-room machine bot identity ${config.relay.displayName ?? config.relay.machineId}.` });
      if (messenger.ref.kind === "telegram") {
        items.push({ level: "warning", message: `${ref}: Telegram Bot-to-Bot Communication Mode must be enabled for both BotFather bots before bot-authored group updates can reach each other; privacy-mode groups can still use /command@bot addressed-command fallback.` });
        items.push({ level: "warning", message: `${ref}: Telegram shared-room plain text requires a group/supergroup where bot privacy mode or permissions allow ordinary messages; otherwise use mentions, replies, or addressed commands.` });
      }
      if (messenger.ref.kind === "discord") {
        items.push({ level: "ok", message: `${ref}: Discord shared-room mode should use a dedicated bot application in a shared server channel with Message Content Intent, allowed guild ids, channel permissions, and relay <command>/mention fallbacks.` });
      }
      if (messenger.ref.kind === "slack") {
        items.push({ level: "warning", message: `${ref}: Slack channel shared-room pre-routing is not yet runtime-parity with Discord; app mentions can be detected, but ordinary channel text, channel commands, and media attachments are diagnostic/deferred unless explicit runtime support is added.` });
      }
    }

    if (messenger.delegation?.enabled) {
      items.push({ level: "ok", message: `${ref}: delegation ${messenger.delegation.autonomy}; trusted peers: ${messenger.delegation.trustedPeers.length}; capabilities: ${messenger.delegation.localCapabilities.length > 0 ? messenger.delegation.localCapabilities.join(", ") : "none"}; approval gates: required for sensitive delegated work.` });
      if (!messenger.sharedRoom.enabled) items.push({ level: "warning", message: `${ref}: delegation is enabled but shared-room mode is not enabled; use propose-only or disable delegation until a room is configured.` });
      if (messenger.delegation.trustedPeers.length === 0) items.push({ level: "warning", message: `${ref}: delegation is enabled without trusted peer bots; bot-authored tasks will be rejected.` });
      if (!messenger.delegation.requireHumanApproval && messenger.delegation.autonomy !== "propose-only") items.push({ level: "warning", message: `${ref}: delegation can auto-claim under ${messenger.delegation.autonomy}; verify trusted peer, room, target, and approval policies.` });
      if (!messenger.botUserId && messenger.ref.kind === "slack") items.push({ level: "warning", message: `${ref}: delegation loop prevention works best with Slack botUserId configured.` });
      if (!messenger.applicationId && messenger.ref.kind === "discord") items.push({ level: "warning", message: `${ref}: delegation command surfaces work best with Discord applicationId/clientId configured.` });
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
