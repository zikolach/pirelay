import type { ProgressActivityEntry, TelegramTunnelConfig } from "../core/types.js";
import { maxProgressMessageChars, sanitizeProgressText } from "./progress.js";

const MAX_TOOL_PROGRESS_RECORDS = 50;

export type ToolProgressState = "active" | "completed" | "failed";

export interface ToolProgressLabel {
  toolName: string;
  label: string;
  semanticKey: string;
}

export interface ToolProgressRecord extends ToolProgressLabel {
  toolCallId: string;
  state: ToolProgressState;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ToolProgressAggregate {
  toolName: string;
  count: number;
}

export interface ToolProgressFormattedRow {
  state: ToolProgressState | "aggregate";
  text: string;
  at: number;
}

export interface ToolProgressAccumulatorSnapshot {
  records: ToolProgressRecord[];
  aggregates: ToolProgressAggregate[];
}

export interface ToolProgressEventInput {
  toolName?: unknown;
  toolCallId?: unknown;
  input?: unknown;
  at?: number;
}

export interface ToolProgressActivityOptions {
  id: string;
  at?: number;
}

export class ToolProgressAccumulator {
  private readonly records = new Map<string, ToolProgressRecord>();
  private readonly missingIdBySemanticKey = new Map<string, string>();
  private missingSequence = 0;

  reset(): void {
    this.records.clear();
    this.missingIdBySemanticKey.clear();
    this.missingSequence = 0;
  }

  has(toolCallId: unknown): boolean {
    if (typeof toolCallId !== "string" || !toolCallId.trim()) return false;
    return this.records.has(toolCallId.trim());
  }

  start(event: ToolProgressEventInput, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">): ToolProgressRecord | undefined {
    const now = event.at ?? Date.now();
    const label = summarizeToolProgress(event.toolName, event.input, config);
    if (!label) return undefined;
    const toolCallId = this.stableToolCallId(event.toolCallId, label.semanticKey);
    const existing = this.records.get(toolCallId);
    const record: ToolProgressRecord = {
      ...label,
      toolCallId,
      state: existing?.state === "failed" || existing?.state === "completed" ? existing.state : "active",
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      completedAt: existing?.completedAt,
    };
    this.records.set(toolCallId, record);
    this.pruneRecords();
    return record;
  }

  finish(event: ToolProgressEventInput & { failed?: boolean }, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">): ToolProgressRecord | undefined {
    const now = event.at ?? Date.now();
    const fallbackLabel = summarizeToolProgress(event.toolName, event.input, config);
    if (!fallbackLabel) return undefined;
    const toolCallId = this.finishToolCallId(event.toolCallId, fallbackLabel.semanticKey);
    const existing = this.records.get(toolCallId);
    const label = existing ?? fallbackLabel;
    const record: ToolProgressRecord = {
      toolCallId,
      toolName: label.toolName,
      label: label.label,
      semanticKey: label.semanticKey,
      state: event.failed ? "failed" : "completed",
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      completedAt: now,
    };
    this.records.set(toolCallId, record);
    this.pruneRecords();
    return record;
  }

  snapshot(): ToolProgressAccumulatorSnapshot {
    const records = [...this.records.values()].sort((left, right) => left.updatedAt - right.updatedAt);
    const aggregateMap = new Map<string, ToolProgressAggregate>();
    for (const record of records) {
      const current = aggregateMap.get(record.toolName) ?? { toolName: record.toolName, count: 0 };
      current.count += 1;
      aggregateMap.set(record.toolName, current);
    }
    return {
      records,
      aggregates: [...aggregateMap.values()].sort((left, right) => left.toolName.localeCompare(right.toolName)),
    };
  }

  activity(options: ToolProgressActivityOptions, config: Pick<TelegramTunnelConfig, "maxProgressMessageChars">): ProgressActivityEntry | undefined {
    const detail = formatToolProgressCard(this.snapshot(), config);
    if (!detail) return undefined;
    const at = options.at ?? Date.now();
    return {
      id: options.id,
      kind: "tool",
      text: "Tool progress",
      detail,
      at,
      delivery: "milestone",
      semanticKey: "tool-progress",
    };
  }

  private stableToolCallId(toolCallId: unknown, semanticKey: string): string {
    if (typeof toolCallId === "string" && toolCallId.trim()) return toolCallId.trim();
    const existing = this.missingIdBySemanticKey.get(semanticKey);
    if (existing) return existing;
    const generated = `missing-${++this.missingSequence}`;
    this.missingIdBySemanticKey.set(semanticKey, generated);
    return generated;
  }

  private finishToolCallId(toolCallId: unknown, semanticKey: string): string {
    if (typeof toolCallId === "string" && toolCallId.trim()) return toolCallId.trim();
    const existing = this.missingIdBySemanticKey.get(semanticKey);
    if (existing && this.records.get(existing)?.state === "active") {
      this.missingIdBySemanticKey.delete(semanticKey);
      return existing;
    }
    return `missing-${++this.missingSequence}`;
  }

  private pruneRecords(): void {
    while (this.records.size > MAX_TOOL_PROGRESS_RECORDS) {
      const oldest = [...this.records.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
      if (!oldest) return;
      this.records.delete(oldest.toolCallId);
      for (const [semanticKey, toolCallId] of this.missingIdBySemanticKey) {
        if (toolCallId === oldest.toolCallId) this.missingIdBySemanticKey.delete(semanticKey);
      }
    }
  }
}

export function createToolProgressAccumulator(): ToolProgressAccumulator {
  return new ToolProgressAccumulator();
}

export function summarizeToolProgress(
  toolName: unknown,
  input: unknown,
  config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">,
): ToolProgressLabel | undefined {
  const tool = sanitizeToolName(toolName);
  if (!tool) return undefined;
  const rawDetail = summarizeToolIntent(tool, input);
  const labelText = rawDetail ? `${tool}: ${rawDetail}` : tool;
  const label = boundedToolLabel(labelText, config);
  if (!label) return undefined;
  return {
    toolName: tool,
    label,
    semanticKey: semanticToolKey(tool, label),
  };
}

export function formatToolProgressCard(snapshot: ToolProgressAccumulatorSnapshot, config: Pick<TelegramTunnelConfig, "maxProgressMessageChars">): string | undefined {
  if (snapshot.records.length === 0) return undefined;
  const rows = toolProgressRows(snapshot);
  const limit = maxProgressMessageChars(config);
  const parts: string[] = [];
  for (const row of rows) {
    const next = [...parts, row.text].join(" · ");
    if (next.length > limit) break;
    parts.push(row.text);
  }
  if (parts.length === 0) return undefined;
  const output = parts.join(" · ");
  return output.length > limit ? `${output.slice(0, limit - 1).trimEnd()}…` : output;
}

export function toolProgressRows(snapshot: ToolProgressAccumulatorSnapshot): ToolProgressFormattedRow[] {
  const active = snapshot.records.filter((record) => record.state === "active").sort((left, right) => right.updatedAt - left.updatedAt);
  const failed = snapshot.records.filter((record) => record.state === "failed").sort((left, right) => right.updatedAt - left.updatedAt);
  const completed = snapshot.records.filter((record) => record.state === "completed").sort((left, right) => right.updatedAt - left.updatedAt);
  const rows: ToolProgressFormattedRow[] = [
    ...active.slice(0, 3).map((record) => ({ state: record.state, text: `▶ ${record.label}`, at: record.updatedAt } satisfies ToolProgressFormattedRow)),
    ...failed.slice(0, 2).map((record) => ({ state: record.state, text: `✕ ${record.label}`, at: record.updatedAt } satisfies ToolProgressFormattedRow)),
    ...completed.slice(0, Math.max(0, 4 - active.length - failed.length)).map((record) => ({ state: record.state, text: `✓ ${record.label}`, at: record.updatedAt } satisfies ToolProgressFormattedRow)),
  ];
  const aggregate = snapshot.aggregates.filter((entry) => entry.count > 1);
  if (aggregate.length > 0) {
    rows.push({
      state: "aggregate",
      text: `tools: ${aggregate.map((entry) => `${entry.toolName}×${entry.count}`).join(" ")}`,
      at: snapshot.records.at(-1)?.updatedAt ?? Date.now(),
    });
  }
  return rows;
}

function summarizeToolIntent(toolName: string, input: unknown): string | undefined {
  const args = objectInput(input);
  switch (toolName) {
    case "bash":
    case "shell":
      return firstCommandLine(stringField(args, ["command", "cmd", "script"]));
    case "read":
      return pathWithRange(args, ["path", "file", "filePath", "relativePath"]);
    case "edit":
    case "write":
      return firstStringField(args, ["path", "file", "filePath", "relativePath"]);
    case "grep":
    case "rg":
    case "ripgrep": {
      const pattern = firstStringField(args, ["pattern", "query", "search", "regex"]);
      const path = firstStringField(args, ["path", "dir", "directory", "cwd", "root"]);
      if (pattern && path) return `${pattern} in ${path}`;
      return pattern ?? path;
    }
    case "find":
    case "ls":
    case "list":
      return firstStringField(args, ["path", "dir", "directory", "cwd", "root"]);
    default:
      return undefined;
  }
}

function objectInput(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
}

function stringField(input: Record<string, unknown> | undefined, names: string[]): string | undefined {
  return firstStringField(input, names);
}

function firstStringField(input: Record<string, unknown> | undefined, names: string[]): string | undefined {
  if (!input) return undefined;
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function pathWithRange(input: Record<string, unknown> | undefined, names: string[]): string | undefined {
  const path = firstStringField(input, names);
  if (!path || !input) return path;
  const offset = numericField(input, ["offset", "line", "start", "startLine"]);
  const limit = numericField(input, ["limit", "lines", "end", "endLine"]);
  if (offset !== undefined && limit !== undefined) return `${path}:${offset}+${limit}`;
  if (offset !== undefined) return `${path}:${offset}`;
  return path;
}

function numericField(input: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  }
  return undefined;
}

function firstCommandLine(command: string | undefined): string | undefined {
  return command?.split(/\r?\n/, 1)[0]?.trim() || undefined;
}

function sanitizeToolName(toolName: unknown): string | undefined {
  const raw = String(toolName ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  const sanitized = raw.replace(/[^a-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return sanitized || "tool";
}

function boundedToolLabel(label: string, config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars">): string {
  const maxLabelChars = Math.min(180, Math.max(48, Math.floor(maxProgressMessageChars(config) / 3)));
  const sanitized = sanitizeProgressText(label, { ...config, maxProgressMessageChars: maxLabelChars });
  return sanitized.length > maxLabelChars ? `${sanitized.slice(0, maxLabelChars - 1).trimEnd()}…` : sanitized;
}

function semanticToolKey(toolName: string, label: string): string {
  return `${toolName}:${label}`.toLowerCase().replace(/[^a-z0-9_.:/-]+/g, "-").slice(0, 160);
}
