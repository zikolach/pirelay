export interface SessionListEntry {
  sessionKey: string;
  sessionId: string;
  sessionLabel: string;
  sessionFile?: string;
  online: boolean;
  busy?: boolean;
  paused?: boolean;
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

const SESSION_MARKERS = ["🟦", "🟩", "🟧", "🟪", "🟨", "🟥", "⬜", "⬛"];

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
  return SESSION_MARKERS[stableHash(identity) % SESSION_MARKERS.length]!;
}

function normalizeSelector(value: string): string {
  return value.trim().toLowerCase();
}

export function disambiguatedSessionLabel(entry: SessionListEntry, duplicateLabels: Set<string>): string {
  if (!duplicateLabels.has(entry.sessionLabel.toLowerCase())) return entry.sessionLabel;
  return `${entry.sessionLabel} [${shortSessionId(entry)}]`;
}

export function duplicateSessionLabels(entries: SessionListEntry[]): Set<string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.sessionLabel.toLowerCase();
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
  const lines = ["Pi sessions", ""];
  entries.forEach((entry, index) => {
    const active = entry.sessionKey === activeSessionKey ? " — active" : "";
    const state = entry.online ? "online" : "offline";
    const activity = entry.online ? ` — ${entry.busy ? "busy" : "idle"}` : "";
    const paused = entry.paused ? " — paused" : "";
    lines.push(`${index + 1}. ${sessionMarkerFor(entry)} ${disambiguatedSessionLabel(entry, duplicates)} — ${state}${activity}${paused}${active}`);
  });
  lines.push("", "Use /use <number|label> to switch, or /to <session> <prompt> for a one-shot prompt.");
  return lines.join("\n");
}

function selectorMatches(entry: SessionListEntry, selector: string): boolean {
  const lowered = normalizeSelector(selector);
  if (!lowered) return false;
  return entry.sessionLabel.toLowerCase() === lowered
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
