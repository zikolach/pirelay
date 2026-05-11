export type RelayStatusLineChannel = "telegram" | "discord" | "slack";

export interface RelayStatusLineBindingState {
  paused?: boolean;
  conversationKind?: string;
}

export interface RelayStatusLineState {
  channel: RelayStatusLineChannel;
  configured: boolean;
  runtimeStarted?: boolean;
  error?: string;
  binding?: RelayStatusLineBindingState;
}

export function formatRelayStatusLine(state: RelayStatusLineState): string {
  if (!state.configured) return `${state.channel}: off`;
  if (state.error) return `${state.channel} error: ${compactStatusDetail(state.error)}`;
  if (state.binding) {
    const kind = conversationKindLabel(state.binding.conversationKind);
    const suffix = kind ? ` ${kind}` : "";
    return `${state.channel}: ${state.binding.paused ? "paused" : "paired"}${suffix}`;
  }
  return `${state.channel}: ${state.runtimeStarted === false ? "starting" : "ready unpaired"}`;
}

export function conversationKindLabel(kind: string | undefined): "dm" | "group" | "channel" | undefined {
  if (kind === "private" || kind === "dm" || kind === "im") return "dm";
  if (kind === "group" || kind === "mpim") return "group";
  if (kind === "channel") return "channel";
  return undefined;
}

function compactStatusDetail(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 96) || "unknown";
}
