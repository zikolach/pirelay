import type { ProgressActivityEntry, ProgressMode, SessionNotificationState, TelegramBindingMetadata, TelegramTunnelConfig } from "./types.js";

export const DEFAULT_PROGRESS_MODE: ProgressMode = "normal";
export const DEFAULT_PROGRESS_INTERVAL_MS = 30_000;
export const DEFAULT_VERBOSE_PROGRESS_INTERVAL_MS = 10_000;
export const DEFAULT_RECENT_ACTIVITY_LIMIT = 10;
export const DEFAULT_MAX_PROGRESS_MESSAGE_CHARS = 700;

export const PROGRESS_MODES: ProgressMode[] = ["quiet", "normal", "verbose", "completionOnly"];

export function normalizeProgressMode(value: string | undefined): ProgressMode | undefined {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (!normalized) return undefined;
  if (normalized === "quiet") return "quiet";
  if (normalized === "normal" || normalized === "default") return "normal";
  if (normalized === "verbose") return "verbose";
  if (normalized === "completiononly" || normalized === "completion") return "completionOnly";
  return undefined;
}

export function displayProgressMode(mode: ProgressMode | undefined): string {
  if (mode === "completionOnly") return "completion-only";
  return mode ?? DEFAULT_PROGRESS_MODE;
}

export function progressModeFor(binding: Pick<TelegramBindingMetadata, "progressMode"> | undefined, config: Pick<TelegramTunnelConfig, "progressMode">): ProgressMode {
  return binding?.progressMode ?? config.progressMode ?? DEFAULT_PROGRESS_MODE;
}

export function shouldSendNonTerminalProgress(mode: ProgressMode): boolean {
  return mode === "normal" || mode === "verbose";
}

export function progressIntervalMsFor(mode: ProgressMode, config: Pick<TelegramTunnelConfig, "progressIntervalMs" | "verboseProgressIntervalMs">): number {
  if (mode === "verbose") return positiveNumber(config.verboseProgressIntervalMs, DEFAULT_VERBOSE_PROGRESS_INTERVAL_MS);
  return positiveNumber(config.progressIntervalMs, DEFAULT_PROGRESS_INTERVAL_MS);
}

export function recentActivityLimit(config: Pick<TelegramTunnelConfig, "recentActivityLimit">): number {
  return clamp(positiveNumber(config.recentActivityLimit, DEFAULT_RECENT_ACTIVITY_LIMIT), 1, 50);
}

export function maxProgressMessageChars(config: Pick<TelegramTunnelConfig, "maxProgressMessageChars">): number {
  return clamp(positiveNumber(config.maxProgressMessageChars, DEFAULT_MAX_PROGRESS_MESSAGE_CHARS), 120, 1_500);
}

export function sanitizeProgressText(text: string | undefined, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">): string {
  let output = String(text ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const pattern of config.redactionPatterns ?? []) {
    try {
      output = output.replace(new RegExp(pattern, "gm"), "[redacted]");
    } catch {
      // Invalid user-provided redaction patterns are ignored elsewhere too.
    }
  }
  const maxChars = maxProgressMessageChars(config);
  if (output.length > maxChars) output = `${output.slice(0, maxChars - 1).trimEnd()}…`;
  return output;
}

export function createProgressActivity(input: {
  id: string;
  kind: ProgressActivityEntry["kind"];
  text: string;
  detail?: string;
  at?: number;
}, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">): ProgressActivityEntry | undefined {
  const text = sanitizeProgressText(input.text, config);
  const detail = sanitizeProgressText(input.detail, config);
  if (!text) return undefined;
  return {
    id: input.id,
    kind: input.kind,
    text,
    detail: detail || undefined,
    at: input.at ?? Date.now(),
  };
}

export function appendRecentActivity(
  notification: SessionNotificationState,
  entry: ProgressActivityEntry,
  limit: number,
): ProgressActivityEntry[] {
  const current = notification.recentActivity ?? [];
  const deduped = current.filter((candidate) => candidate.id !== entry.id);
  const next = [...deduped, entry].slice(-Math.max(1, limit));
  notification.recentActivity = next;
  return next;
}

export function formatProgressUpdate(entries: ProgressActivityEntry[], config: Pick<TelegramTunnelConfig, "maxProgressMessageChars">): string | undefined {
  const latest = coalesceProgressEntries(entries);
  if (latest.length === 0) return undefined;
  const body = latest.map((entry) => `• ${entry.text}${entry.detail ? ` — ${entry.detail}` : ""}`).join("\n");
  const output = `Pi progress\n${body}`;
  const maxChars = maxProgressMessageChars(config);
  return output.length > maxChars ? `${output.slice(0, maxChars - 1).trimEnd()}…` : output;
}

export function formatRecentActivity(entries: ProgressActivityEntry[] | undefined, options: { now?: number; limit?: number } = {}): string {
  const recent = (entries ?? []).slice(-(options.limit ?? DEFAULT_RECENT_ACTIVITY_LIMIT));
  if (recent.length === 0) return "No recent activity is available for this session yet.";
  const now = options.now ?? Date.now();
  const lines = ["Recent Pi activity", ""];
  for (const entry of recent) {
    lines.push(`• ${relativeTime(entry.at, now)} — ${entry.text}${entry.detail ? ` — ${entry.detail}` : ""}`);
  }
  return lines.join("\n");
}

export function sessionDisplayName(entry: { sessionLabel: string; alias?: string }): string {
  return entry.alias?.trim() || entry.sessionLabel;
}

function coalesceProgressEntries(entries: ProgressActivityEntry[]): ProgressActivityEntry[] {
  const byText = new Map<string, ProgressActivityEntry & { count?: number }>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.text}:${entry.detail ?? ""}`;
    const existing = byText.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      existing.at = Math.max(existing.at, entry.at);
      continue;
    }
    byText.set(key, { ...entry });
  }
  return [...byText.values()]
    .sort((left, right) => left.at - right.at)
    .slice(-5)
    .map((entry) => entry.count && entry.count > 1 ? { ...entry, text: `${entry.text} (${entry.count}×)` } : entry);
}

function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
