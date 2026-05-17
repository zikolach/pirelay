export type RelayStatusLineChannel = "telegram" | "discord" | "slack";
export type RelayStatusLineTone = "accent" | "dim" | "error" | "muted" | "success" | "warning";

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

export interface RelayStatusLineFormatOptions {
  colorize?: (tone: RelayStatusLineTone, text: string) => string;
}

export function formatRelayStatusLine(state: RelayStatusLineState, options: RelayStatusLineFormatOptions = {}): string {
  const segment = relayStatusLineSegment(state);
  const detail = segment.detail ? ` ${segment.detail}` : "";
  const text = `${channelLabel(state.channel)} ${segment.icon}${detail}`;
  return options.colorize ? options.colorize(segment.tone, text) : text;
}

export function conversationKindIcon(kind: string | undefined): "✉" | "◉" | "#" | undefined {
  if (kind === "private" || kind === "dm" || kind === "im") return "✉";
  if (kind === "group" || kind === "mpim") return "◉";
  if (kind === "channel") return "#";
  return undefined;
}

function relayStatusLineSegment(state: RelayStatusLineState): { icon: string; detail?: string; tone: RelayStatusLineTone } {
  if (!state.configured) return { icon: "○", tone: "dim" };
  if (state.error) return { icon: "✖", tone: "error" };
  if (state.binding) {
    const detail = conversationKindIcon(state.binding.conversationKind);
    return state.binding.paused
      ? { icon: "Ⅱ", detail, tone: "warning" }
      : { icon: "●", detail, tone: "success" };
  }
  if (state.runtimeStarted === false) return { icon: "◌", tone: "accent" };
  return { icon: "◇", tone: "muted" };
}

function channelLabel(channel: RelayStatusLineChannel): string {
  if (channel === "telegram") return "tg";
  if (channel === "discord") return "dc";
  return "sl";
}
