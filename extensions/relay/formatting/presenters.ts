import type { ChannelBinding } from "../core/channel-adapter.js";
import { statusSnapshotForRoute } from "../core/relay-core.js";
import { type SessionListEntry, type SessionSelectorResult } from "../core/session-selection.js";
import { displayProgressMode, formatRecentActivity } from "../notifications/progress.js";
import type { ProgressMode, SessionRoute, SessionStatusSnapshot, TelegramBindingMetadata, TelegramTunnelConfig } from "../core/types.js";

export type RelayBindingSummary = TelegramBindingMetadata | ChannelBinding | undefined;

export interface RelayStatusFormatOptions {
  binding?: RelayBindingSummary;
  progressMode?: ProgressMode;
  includeLastStatus?: boolean;
}

export function formatRelayStatus(snapshot: SessionStatusSnapshot, options: RelayStatusFormatOptions = {}): string {
  const binding = options.binding ?? snapshot.binding;
  const displayLabel = bindingAlias(binding) || snapshot.sessionLabel;
  const originalLabel = bindingAlias(binding) ? snapshot.sessionLabel : undefined;
  return [
    `Session: ${displayLabel}`,
    originalLabel ? `Label: ${originalLabel}` : undefined,
    `Binding: ${formatSafeBindingSummary(binding)}`,
    `Online: ${snapshot.online ? "yes" : "no"}`,
    `Busy: ${snapshot.busy ? "yes" : "no"}`,
    `Model: ${snapshot.modelId ?? "unknown"}`,
    `Progress mode: ${displayProgressMode(options.progressMode)}`,
    `Last activity: ${snapshot.lastActivityAt ? new Date(snapshot.lastActivityAt).toLocaleString() : "unknown"}`,
    options.includeLastStatus ? `Last status: ${snapshot.notification.lastStatus ?? "unknown"}` : undefined,
  ].filter(Boolean).join("\n");
}

export function formatRelayStatusForRoute(
  route: SessionRoute,
  options: { online: boolean; busy: boolean; binding?: RelayBindingSummary; progressMode?: ProgressMode; includeLastStatus?: boolean },
): string {
  return formatRelayStatus(statusSnapshotForRoute(route, { online: options.online, busy: options.busy }), options);
}

export function formatSafeBindingSummary(binding: RelayBindingSummary): string {
  if (!binding) return "not paired";
  if (isTelegramBinding(binding)) {
    const paused = binding.paused ? ", paused" : "";
    const user = binding.username ? `@${binding.username}` : `user ${binding.userId}`;
    return `Telegram private chat with ${user}${paused}`;
  }

  const paused = binding.paused ? ", paused" : "";
  const channel = String(binding.channel).charAt(0).toUpperCase() + String(binding.channel).slice(1);
  const identityName = binding.identity?.displayName || binding.identity?.username;
  const user = identityName ? `${identityName} (${binding.userId})` : `user ${binding.userId}`;
  return `${channel} private chat with ${user}${paused}`;
}

export function formatNoFullOutputMessage(): string {
  return "No completed assistant output is available yet for this session.";
}

export function formatLatestImageEmptyMessage(): string {
  return "No image outputs are available for the latest completed Pi turn. /images can send captured image outputs or safe workspace image files mentioned by the latest Pi reply. If Pi saved an image file, use /send-image <relative-path>.";
}

export function formatSummaryOutput(route: Pick<SessionRoute, "notification">): string {
  return route.notification.lastSummary || route.notification.lastFailure || route.notification.lastAssistantText || "No summary is available yet for this session.";
}

export function formatFullOutput(route: Pick<SessionRoute, "notification">): string {
  return route.notification.lastAssistantText || formatNoFullOutputMessage();
}

export function formatRelayRecentActivity(route: Pick<SessionRoute, "notification">, config: Pick<TelegramTunnelConfig, "recentActivityLimit">): string {
  return formatRecentActivity(route.notification.recentActivity, { limit: recentActivityLimitValue(config) });
}

export function formatSessionSelectorError(result: SessionSelectorResult, selector: string): string {
  switch (result.kind) {
    case "empty":
      return "No paired sessions were found for this chat. Run /relay connect <messenger> locally to pair a Pi session.";
    case "missing":
      return "Usage: /use <number|alias|label> or /to <session> <prompt>. Use /sessions to list sessions.";
    case "no-match":
      return `No session matches ${selector || "that selector"}. Use /sessions to list sessions.`;
    case "offline":
      return `Pi session ${result.entry.alias || result.entry.sessionLabel} is offline. Resume it locally, then try again.`;
    case "ambiguous":
      return `Multiple sessions match ${selector || "that selector"}. Use /sessions and choose a number.`;
    case "matched":
      return "Session selected.";
  }
}

export function sessionEntryForRoute(
  route: SessionRoute,
  options: { online: boolean; busy: boolean; binding?: RelayBindingSummary; modelId?: string; lastActivityAt?: number },
): SessionListEntry {
  return {
    sessionKey: route.sessionKey,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    sessionLabel: route.sessionLabel,
    alias: bindingAlias(options.binding),
    online: options.online,
    busy: options.busy,
    paused: Boolean(options.binding?.paused),
    modelId: options.modelId,
    lastActivityAt: options.lastActivityAt ?? route.lastActivityAt,
  };
}

function recentActivityLimitValue(config: Pick<TelegramTunnelConfig, "recentActivityLimit">): number {
  const raw = typeof config.recentActivityLimit === "number" ? config.recentActivityLimit : 10;
  return Math.max(1, Math.min(raw, 50));
}

function bindingAlias(binding: RelayBindingSummary): string | undefined {
  if (!binding) return undefined;
  const alias = isTelegramBinding(binding) ? binding.alias : channelAlias(binding);
  return alias?.trim() || undefined;
}

function channelAlias(binding: ChannelBinding): string | undefined {
  const alias = binding.metadata?.alias;
  return typeof alias === "string" ? alias : undefined;
}

function isTelegramBinding(binding: TelegramBindingMetadata | ChannelBinding): binding is TelegramBindingMetadata {
  return "chatId" in binding;
}
