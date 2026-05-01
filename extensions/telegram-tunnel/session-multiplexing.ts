export interface SessionListEntry {
  sessionKey: string;
  sessionId: string;
  sessionLabel: string;
  sessionFile?: string;
  alias?: string;
  online: boolean;
  busy?: boolean;
  paused?: boolean;
  modelId?: string;
  lastActivityAt?: number;
}

export type SessionSelectorResult =
  | { kind: "matched"; entry: SessionListEntry; index: number }
  | { kind: "ambiguous"; matches: Array<{ entry: SessionListEntry; index: number }> }
  | { kind: "offline"; entry: SessionListEntry; index: number }
  | { kind: "missing" }
  | { kind: "no-match" }
  | { kind: "empty" };

export interface SessionTargetResolution {
  selector: string;
  prompt: string;
  result: SessionSelectorResult;
}

export interface BoundSessionIdentity {
  sessionKey: string;
  sessionId: string;
  sessionLabel: string;
  binding?: {
    chatId: number;
    userId: number;
    alias?: string;
  };
}

const BASE_SESSION_MARKERS = ["🔵", "🟢", "🟠", "🟣", "🟡", "🔴", "⚪", "⚫"];
const EXTRA_SESSION_MARKERS = ["🔷", "🟩", "🔶", "🟪", "🟨", "🟥", "⬜", "⬛"];
const SESSION_MARKERS = [...BASE_SESSION_MARKERS, ...EXTRA_SESSION_MARKERS];

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function shortSessionId(entry: Pick<SessionListEntry, "sessionId" | "sessionKey">): string {
  return (entry.sessionId || entry.sessionKey).slice(0, 8);
}

export function sessionMarkerFor(entry: Pick<SessionListEntry, "sessionKey" | "sessionId">): string {
  const identity = entry.sessionKey || entry.sessionId;
  return BASE_SESSION_MARKERS[stableHash(identity) % BASE_SESSION_MARKERS.length]!;
}

function sessionMarkerIdentity(entry: Pick<SessionListEntry, "sessionKey" | "sessionId">): string {
  return entry.sessionKey || entry.sessionId;
}

export function sessionMarkersFor(entries: Array<Pick<SessionListEntry, "sessionKey" | "sessionId">>): Map<string, string> {
  const assignments = new Map<string, string>();
  const used = new Set<string>();
  const identities = [...new Set(entries.map(sessionMarkerIdentity))].sort((left, right) => {
    const leftHash = stableHash(left);
    const rightHash = stableHash(right);
    return (leftHash % BASE_SESSION_MARKERS.length) - (rightHash % BASE_SESSION_MARKERS.length)
      || leftHash - rightHash
      || left.localeCompare(right);
  });

  for (const identity of identities) {
    const preferredIndex = stableHash(identity) % BASE_SESSION_MARKERS.length;
    let marker = SESSION_MARKERS[preferredIndex]!;
    for (let offset = 0; offset < SESSION_MARKERS.length; offset += 1) {
      const candidate = SESSION_MARKERS[(preferredIndex + offset) % SESSION_MARKERS.length]!;
      if (!used.has(candidate)) {
        marker = candidate;
        break;
      }
    }

    assignments.set(identity, marker);
    used.add(marker);
  }

  return assignments;
}

export function hasMultipleBoundSessionsForRoute(route: BoundSessionIdentity, candidates: Iterable<BoundSessionIdentity>): boolean {
  if (!route.binding) return false;
  let count = 0;
  for (const candidate of candidates) {
    if (candidate.binding?.chatId !== route.binding.chatId || candidate.binding?.userId !== route.binding.userId) continue;
    count += 1;
    if (count > 1) return true;
  }
  return false;
}

export function sessionSourcePrefixForRoute(route: BoundSessionIdentity, candidates: Iterable<BoundSessionIdentity>): string {
  if (!route.binding) return "";
  const peers = [...candidates].filter((candidate) => candidate.binding?.chatId === route.binding?.chatId && candidate.binding?.userId === route.binding?.userId);
  if (peers.length <= 1) return "";
  const marker = sessionMarkersFor(peers).get(sessionMarkerIdentity(route)) ?? sessionMarkerFor(route);
  const label = route.binding.alias?.trim() || route.sessionLabel;
  return `${marker} ${label}\n\n`;
}

function normalizeSelector(value: string): string {
  return value.trim().toLowerCase();
}

export function displaySessionLabel(entry: Pick<SessionListEntry, "sessionLabel" | "alias">): string {
  return entry.alias?.trim() || entry.sessionLabel;
}

export function disambiguatedSessionLabel(entry: SessionListEntry, duplicateLabels: Set<string>): string {
  const label = displaySessionLabel(entry);
  if (!duplicateLabels.has(label.toLowerCase())) return label;
  return `${label} [${shortSessionId(entry)}]`;
}

export function duplicateSessionLabels(entries: SessionListEntry[]): Set<string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = displaySessionLabel(entry).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([label]) => label));
}

export function formatSessionList(entries: SessionListEntry[], activeSessionKey?: string): string {
  if (entries.length === 0) {
    return [
      "Pi sessions",
      "",
      "No paired sessions were found for this chat.",
      "Run /telegram-tunnel connect [name] locally to pair a Pi session.",
    ].join("\n");
  }

  const duplicates = duplicateSessionLabels(entries);
  const markers = sessionMarkersFor(entries);
  const lines = ["Pi sessions", ""];
  entries.forEach((entry, index) => {
    const active = entry.sessionKey === activeSessionKey ? " — active" : "";
    const state = entry.online ? "online" : "offline";
    const activity = entry.online ? ` — ${entry.busy ? "busy" : "idle"}` : "";
    const paused = entry.paused ? " — paused" : "";
    const model = entry.modelId ? ` — ${entry.modelId}` : "";
    const lastActivity = entry.lastActivityAt ? ` — ${new Date(entry.lastActivityAt).toLocaleString()}` : "";
    const alias = entry.alias?.trim() ? ` (${entry.sessionLabel})` : "";
    lines.push(`${index + 1}. ${markers.get(sessionMarkerIdentity(entry)) ?? sessionMarkerFor(entry)} ${disambiguatedSessionLabel(entry, duplicates)}${alias} — ${state}${activity}${paused}${model}${lastActivity}${active}`);
  });
  lines.push("", "Use /use <number|alias|label> to switch, /to <session> <prompt> for a one-shot prompt, /alias <name> to rename the active session, or /forget <session> to remove an offline session.");
  return lines.join("\n");
}

function selectorMatches(entry: SessionListEntry, selector: string): boolean {
  const lowered = normalizeSelector(selector);
  if (!lowered) return false;
  return displaySessionLabel(entry).toLowerCase() === lowered
    || entry.sessionLabel.toLowerCase() === lowered
    || entry.sessionId.toLowerCase().startsWith(lowered)
    || entry.sessionKey.toLowerCase().startsWith(lowered);
}

export function resolveSessionSelector(entries: SessionListEntry[], selector: string): SessionSelectorResult {
  if (entries.length === 0) return { kind: "empty" };
  const trimmed = selector.trim();
  if (!trimmed) return { kind: "missing" };

  if (/^\d+$/.test(trimmed)) {
    const asNumber = parseInt(trimmed, 10);
    if (asNumber >= 1 && asNumber <= entries.length) {
      const entry = entries[asNumber - 1]!;
      return entry.online ? { kind: "matched", entry, index: asNumber - 1 } : { kind: "offline", entry, index: asNumber - 1 };
    }
  }

  const matches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => selectorMatches(entry, trimmed));
  if (matches.length === 0) return { kind: "no-match" };

  const liveMatches = matches.filter(({ entry }) => entry.online);
  if (liveMatches.length === 1) return { kind: "matched", entry: liveMatches[0]!.entry, index: liveMatches[0]!.index };
  if (liveMatches.length > 1) return { kind: "ambiguous", matches: liveMatches };

  if (matches.length === 1) return { kind: "offline", entry: matches[0]!.entry, index: matches[0]!.index };
  return { kind: "ambiguous", matches };
}

function isMeaningfulTargetResult(result: SessionSelectorResult): boolean {
  return result.kind === "matched" || result.kind === "ambiguous" || result.kind === "offline";
}

export function resolveSessionTargetArgs(entries: SessionListEntry[], args: string): SessionTargetResolution {
  const rawArgs = args.trim();
  if (!rawArgs) return { selector: "", prompt: "", result: resolveSessionSelector(entries, "") };

  const quoted = rawArgs.match(/^"([^"]+)"(?:\s+([\s\S]*))?$/);
  if (quoted) {
    const selector = quoted[1]?.trim() ?? "";
    const prompt = quoted[2]?.trim() ?? "";
    return { selector, prompt, result: resolveSessionSelector(entries, selector) };
  }

  const parts = rawArgs.split(/\s+/).filter(Boolean);
  for (let end = parts.length; end >= 1; end -= 1) {
    const selector = parts.slice(0, end).join(" ");
    const prompt = parts.slice(end).join(" ").trim();
    const result = resolveSessionSelector(entries, selector);
    if (isMeaningfulTargetResult(result)) return { selector, prompt, result };
  }

  const selector = parts[0] ?? "";
  const prompt = parts.slice(1).join(" ").trim();
  return { selector, prompt, result: resolveSessionSelector(entries, selector) };
}
