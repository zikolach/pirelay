import { appendFile, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export interface CommunicationDiagnosticsConfigInput {
  enabled?: boolean;
  logPath?: string;
  maxFileBytes?: number;
  maxFiles?: number;
  includeContentPreview?: boolean;
  previewChars?: number;
}

export interface ResolvedCommunicationDiagnosticsConfig {
  enabled: boolean;
  logPath: string;
  maxFileBytes: number;
  maxFiles: number;
  includeContentPreview: boolean;
  previewChars: number;
  redactionPatterns: string[];
}

export interface CommunicationDiagnosticsStatus {
  enabled: boolean;
  logPath: string;
  maxFileBytes: number;
  maxFiles: number;
  includeContentPreview: boolean;
  latestWriteOk?: boolean;
  latestWriteError?: string;
}

export type CommunicationDiagnosticComponent = "runtime" | "broker" | "telegram" | "discord" | "slack" | "config";
export type CommunicationDiagnosticSeverity = "debug" | "info" | "warning" | "error";

export interface CommunicationDiagnosticEvent {
  component: CommunicationDiagnosticComponent;
  event: string;
  severity?: CommunicationDiagnosticSeverity;
  outcome?: string;
  sessionKey?: string;
  sessionId?: string;
  sessionLabel?: string;
  turnId?: string;
  routeKey?: string;
  messenger?: string;
  instanceId?: string;
  conversationId?: string;
  userId?: string;
  updateId?: string | number;
  command?: string;
  action?: string;
  details?: Record<string, unknown>;
}

export interface CommunicationDiagnosticRecord extends CommunicationDiagnosticEvent {
  ts: string;
  severity: CommunicationDiagnosticSeverity;
  pid: number;
}

export interface CommunicationDiagnosticsLogger {
  readonly config: ResolvedCommunicationDiagnosticsConfig;
  status(): CommunicationDiagnosticsStatus;
  record(event: CommunicationDiagnosticEvent): Promise<void>;
}

export interface FinalAssistantExtractionDiagnostics {
  messageCount: number;
  roleHistogram: Record<string, number>;
  assistantMessageCount: number;
  assistantContentShapes: string[];
  assistantTextBlockCount: number;
  assistantTextLengthTotal: number;
  finalTextFound: boolean;
  missingReason?: "no-assistant-message" | "no-non-empty-assistant-text";
  contentPreview?: string;
}

export interface FinalAssistantExtractionResult {
  finalText?: string;
  diagnostics: FinalAssistantExtractionDiagnostics;
}

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_PREVIEW_CHARS = 240;
const MAX_EVENT_JSON_BYTES = 32 * 1024;
const builtinSecretPatterns: RegExp[] = [
  /\b\d+:[A-Za-z0-9_-]{20,}\b/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /xapp-[A-Za-z0-9-]+/g,
  /https:\/\/hooks\.slack(?:-gov)?\.com\/[^\s"'\\]+/g,
  /[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g,
  /\b(?:pair|connect)\s+[A-Za-z0-9_-]{8,}\b/gi,
  /\b(?:approval|pairing|nonce|secret|token|signingSecret|botToken)[:=][A-Za-z0-9_.\-\/]{8,}\b/gi,
];

export function parseDiagnosticsBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function parseDiagnosticsNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveCommunicationDiagnosticsConfig(input: {
  stateDir: string;
  config?: CommunicationDiagnosticsConfigInput;
  env?: NodeJS.ProcessEnv;
  redactionPatterns?: string[];
}): ResolvedCommunicationDiagnosticsConfig {
  const env = input.env ?? process.env;
  const fileConfig = input.config;
  const enabled = parseDiagnosticsBoolean(env.PI_RELAY_COMMUNICATION_DIAGNOSTICS)
    ?? parseDiagnosticsBoolean(env.PI_RELAY_DIAGNOSTICS_ENABLED)
    ?? fileConfig?.enabled
    ?? false;
  const includeContentPreview = parseDiagnosticsBoolean(env.PI_RELAY_DIAGNOSTICS_INCLUDE_CONTENT_PREVIEW)
    ?? fileConfig?.includeContentPreview
    ?? false;
  const configuredPath = env.PI_RELAY_DIAGNOSTICS_LOG_PATH ?? fileConfig?.logPath;
  const home = env.HOME ?? process.env.HOME ?? "~";
  const expandedPath = configuredPath?.replace(/^~(?=\/)/, home);
  const logPath = expandedPath ? resolve(expandedPath) : join(resolve(input.stateDir), "logs", "communication.jsonl");
  const maxFileBytes = Math.max(1024, parseDiagnosticsNumber(env.PI_RELAY_DIAGNOSTICS_MAX_BYTES) ?? fileConfig?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  const maxFiles = Math.max(1, Math.min(50, Math.floor(parseDiagnosticsNumber(env.PI_RELAY_DIAGNOSTICS_MAX_FILES) ?? fileConfig?.maxFiles ?? DEFAULT_MAX_FILES)));
  const previewChars = Math.max(40, Math.min(2000, Math.floor(parseDiagnosticsNumber(env.PI_RELAY_DIAGNOSTICS_PREVIEW_CHARS) ?? fileConfig?.previewChars ?? DEFAULT_PREVIEW_CHARS)));
  return {
    enabled,
    logPath: isAbsolute(logPath) ? logPath : resolve(logPath),
    maxFileBytes,
    maxFiles,
    includeContentPreview,
    previewChars,
    redactionPatterns: input.redactionPatterns ?? [],
  };
}

export function redactDiagnosticText(text: string, patterns: readonly string[] = []): string {
  let output = text;
  for (const pattern of builtinSecretPatterns) output = output.replace(pattern, "[redacted]");
  for (const pattern of patterns) {
    try {
      output = output.replace(new RegExp(pattern, "gm"), "[redacted]");
    } catch {
      // Invalid user-provided redaction patterns are ignored for log safety.
    }
  }
  return output;
}

export function boundedDiagnosticPreview(text: string, config: Pick<ResolvedCommunicationDiagnosticsConfig, "includeContentPreview" | "previewChars" | "redactionPatterns">): string | undefined {
  if (!config.includeContentPreview) return undefined;
  const redacted = redactDiagnosticText(String(text), config.redactionPatterns).replace(/\s+/g, " ").trim();
  if (!redacted) return undefined;
  return redacted.length <= config.previewChars ? redacted : `${redacted.slice(0, config.previewChars - 1).trimEnd()}…`;
}

function sanitizeDiagnosticValue(value: unknown, patterns: readonly string[]): unknown {
  if (typeof value === "string") return redactDiagnosticText(value, patterns);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeDiagnosticValue(entry, patterns));
  if (typeof value === "object" && value) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 100)) output[key] = sanitizeDiagnosticValue(nested, patterns);
    return output;
  }
  return undefined;
}

export function sanitizeDiagnosticEvent(event: CommunicationDiagnosticEvent, config: ResolvedCommunicationDiagnosticsConfig): CommunicationDiagnosticRecord {
  const record: CommunicationDiagnosticRecord = {
    ts: new Date().toISOString(),
    pid: process.pid,
    severity: event.severity ?? "info",
    component: event.component,
    event: event.event,
  };
  for (const key of ["outcome", "sessionKey", "sessionId", "sessionLabel", "turnId", "routeKey", "messenger", "instanceId", "conversationId", "userId", "updateId", "command", "action"] as const) {
    const value = event[key];
    if (value !== undefined) (record as unknown as Record<string, unknown>)[key] = sanitizeDiagnosticValue(value, config.redactionPatterns);
  }
  if (event.details) record.details = sanitizeDiagnosticValue(event.details, config.redactionPatterns) as Record<string, unknown>;
  return record;
}

function rotatedPath(path: string, index: number): string {
  return `${path}.${index}`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function rotateIfNeeded(path: string, lineBytes: number, maxFileBytes: number, maxFiles: number): Promise<void> {
  try {
    const info = await stat(path);
    if (info.size + lineBytes <= maxFileBytes) return;
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  if (maxFiles <= 1) {
    await rm(path, { force: true });
    return;
  }
  await rm(rotatedPath(path, maxFiles - 1), { force: true });
  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    try {
      await rename(rotatedPath(path, index), rotatedPath(path, index + 1));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  try {
    await rename(path, rotatedPath(path, 1));
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function boundRecordJson(record: CommunicationDiagnosticRecord): string {
  let json = JSON.stringify(record);
  if (Buffer.byteLength(json, "utf8") <= MAX_EVENT_JSON_BYTES) return json;
  const bounded = {
    ...record,
    details: {
      truncated: true,
      originalDetailKeys: record.details ? Object.keys(record.details) : [],
    },
  };
  json = JSON.stringify(bounded);
  return Buffer.byteLength(json, "utf8") <= MAX_EVENT_JSON_BYTES ? json : JSON.stringify({ ts: record.ts, pid: record.pid, component: record.component, event: record.event, severity: record.severity, details: { truncated: true } });
}

export function createCommunicationDiagnosticsLogger(config: ResolvedCommunicationDiagnosticsConfig | undefined): CommunicationDiagnosticsLogger {
  config = config ?? { enabled: false, logPath: "", maxFileBytes: DEFAULT_MAX_FILE_BYTES, maxFiles: DEFAULT_MAX_FILES, includeContentPreview: false, previewChars: DEFAULT_PREVIEW_CHARS, redactionPatterns: [] };
  let latestWriteOk: boolean | undefined;
  let latestWriteError: string | undefined;
  return {
    config,
    status: () => ({
      enabled: config.enabled,
      logPath: config.logPath,
      maxFileBytes: config.maxFileBytes,
      maxFiles: config.maxFiles,
      includeContentPreview: config.includeContentPreview,
      latestWriteOk,
      latestWriteError,
    }),
    record: async (event) => {
      if (!config.enabled) return;
      try {
        const record = sanitizeDiagnosticEvent(event, config);
        const line = `${boundRecordJson(record)}\n`;
        await mkdir(dirname(config.logPath), { recursive: true, mode: 0o700 });
        await rotateIfNeeded(config.logPath, Buffer.byteLength(line, "utf8"), config.maxFileBytes, config.maxFiles);
        await appendFile(config.logPath, line, { mode: 0o600 });
        await chmod(config.logPath, 0o600).catch(() => undefined);
        latestWriteOk = true;
        latestWriteError = undefined;
      } catch (error) {
        latestWriteOk = false;
        latestWriteError = error instanceof Error ? error.message : String(error);
      }
    },
  };
}

export function analyzeFinalAssistantExtraction(messages: AgentMessage[], config?: Pick<ResolvedCommunicationDiagnosticsConfig, "includeContentPreview" | "previewChars" | "redactionPatterns">): FinalAssistantExtractionResult {
  const roleHistogram: Record<string, number> = {};
  const assistantContentShapes: string[] = [];
  let assistantMessageCount = 0;
  let assistantTextBlockCount = 0;
  let assistantTextLengthTotal = 0;
  let finalText: string | undefined;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as unknown as { role?: unknown; content?: unknown };
    const role = typeof message.role === "string" ? message.role : "unknown";
    roleHistogram[role] = (roleHistogram[role] ?? 0) + 1;
    if (role !== "assistant") continue;
    assistantMessageCount += 1;
    const content = message.content;
    if (typeof content === "string") {
      assistantContentShapes.push("string");
      assistantTextBlockCount += 1;
      assistantTextLengthTotal += content.length;
      if (content.trim()) finalText = content.trim();
      continue;
    }
    if (Array.isArray(content)) {
      const blockTypes: string[] = [];
      const texts: string[] = [];
      for (const block of content as Array<{ type?: unknown; text?: unknown }>) {
        const type = typeof block.type === "string" ? block.type : "unknown";
        blockTypes.push(type);
        if (type === "text" && typeof block.text === "string") {
          assistantTextBlockCount += 1;
          assistantTextLengthTotal += block.text.length;
          if (block.text.trim()) texts.push(block.text);
        }
      }
      assistantContentShapes.push(`array:${blockTypes.join(",") || "empty"}`);
      const text = texts.join("\n").trim();
      if (text) finalText = text;
      continue;
    }
    assistantContentShapes.push(content === undefined ? "undefined" : typeof content);
  }

  return {
    finalText,
    diagnostics: {
      messageCount: messages.length,
      roleHistogram,
      assistantMessageCount,
      assistantContentShapes,
      assistantTextBlockCount,
      assistantTextLengthTotal,
      finalTextFound: Boolean(finalText),
      missingReason: finalText ? undefined : assistantMessageCount === 0 ? "no-assistant-message" : "no-non-empty-assistant-text",
      contentPreview: finalText && config ? boundedDiagnosticPreview(finalText, config) : undefined,
    },
  };
}
