import type { ProgressActivityEntry, ProgressMode, SessionNotificationState, TelegramBindingMetadata, TelegramTunnelConfig } from "../core/types.js";

export const DEFAULT_PROGRESS_MODE: ProgressMode = "normal";
export const DEFAULT_PROGRESS_INTERVAL_MS = 30_000;
export const DEFAULT_VERBOSE_PROGRESS_INTERVAL_MS = 10_000;
export const DEFAULT_RECENT_ACTIVITY_LIMIT = 10;
export const DEFAULT_MAX_PROGRESS_MESSAGE_CHARS = 700;
export const COMPACTION_PROGRESS_STARTED_TEXT = "Context compaction started";
export const COMPACTION_PROGRESS_COMPLETED_TEXT = "Context compaction completed";
export const DEFAULT_LIVE_PROGRESS_MARKER = "●";

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

export function shouldSendCompactionProgress(mode: ProgressMode): boolean {
  return mode !== "quiet";
}

export function shouldSendProgressActivity(mode: ProgressMode, entry: Pick<ProgressActivityEntry, "kind"> & Partial<Pick<ProgressActivityEntry, "text" | "delivery">>): boolean {
  if (entry.kind === "compaction") return shouldSendCompactionProgress(mode);
  if (progressActivityDelivery(entry) === "volatile") return mode === "verbose";
  return shouldSendNonTerminalProgress(mode);
}

export function progressActivityDelivery(entry: Pick<ProgressActivityEntry, "kind"> & Partial<Pick<ProgressActivityEntry, "text" | "delivery">>): "milestone" | "volatile" {
  if (entry.delivery) return entry.delivery;
  if (entry.kind === "assistant") return "volatile";
  const text = entry.text?.trim() ?? "";
  if (entry.kind === "status" && /^model update$/i.test(text)) return "volatile";
  if (entry.kind === "tool" && /^processed tool result$/i.test(text)) return "volatile";
  return "milestone";
}

export function progressSemanticKey(entry: Pick<ProgressActivityEntry, "kind" | "text" | "detail" | "semanticKey" | "delivery">): string {
  if (entry.semanticKey?.trim()) return normalizeProgressKey(entry.semanticKey);
  const delivery = progressActivityDelivery(entry);
  return normalizeProgressKey(`${delivery}:${entry.kind}:${entry.text}:${entry.detail ?? ""}`);
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
  delivery?: ProgressActivityEntry["delivery"];
  semanticKey?: string;
}, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">): ProgressActivityEntry | undefined {
  const text = sanitizeProgressText(input.text, config);
  const detail = sanitizeProgressText(input.detail, config);
  const semanticKey = sanitizeProgressText(input.semanticKey, config);
  if (!text) return undefined;
  return {
    id: input.id,
    kind: input.kind,
    text,
    detail: detail || undefined,
    at: input.at ?? Date.now(),
    delivery: input.delivery,
    semanticKey: semanticKey ? normalizeProgressKey(semanticKey) : undefined,
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

export function coalesceLiveProgressEntries(entries: ProgressActivityEntry[]): ProgressActivityEntry[] {
  type CountedProgressActivityEntry = ProgressActivityEntry & { count?: number };
  const milestones = new Map<string, ProgressActivityEntry & { count?: number }>();
  const volatileByKind = new Map<string, ProgressActivityEntry>();

  for (const entry of entries) {
    const delivery = progressActivityDelivery(entry);
    if (delivery === "volatile") {
      volatileByKind.set(`${entry.kind}:${normalizeProgressKey(entry.text)}`, { ...entry });
      continue;
    }
    const key = progressSemanticKey(entry);
    const existing = milestones.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      existing.at = Math.max(existing.at, entry.at);
      continue;
    }
    milestones.set(key, { ...entry });
  }

  const latestVolatile = [...volatileByKind.values()];
  return ([...milestones.values(), ...latestVolatile] as CountedProgressActivityEntry[])
    .sort((left, right) => left.at - right.at)
    .slice(-5)
    .map((entry) => entry.count && entry.count > 1 ? { ...entry, text: `${entry.text} (${entry.count}×)` } : entry);
}

export function formatProgressUpdate(entries: ProgressActivityEntry[], config: Pick<TelegramTunnelConfig, "maxProgressMessageChars">, options: { header?: boolean; marker?: string } = {}): string | undefined {
  const latest = coalesceLiveProgressEntries(entries);
  if (latest.length === 0) return undefined;
  const marker = options.marker ?? DEFAULT_LIVE_PROGRESS_MARKER;
  const body = latest.map((entry) => `${marker} ${entry.text}${entry.detail ? ` — ${entry.detail}` : ""}`).join("\n");
  const output = (options.header ?? true) ? `Pi progress\n${body}` : body;
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

function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function normalizeProgressKey(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
