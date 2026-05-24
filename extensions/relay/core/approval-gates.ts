import { createHash, randomUUID } from "node:crypto";
import type { ChannelButtonLayout } from "./channel-adapter.js";
import type { RelayFileDeliveryRequester } from "./requester-file-delivery.js";
import type { SessionRoute } from "./types.js";
import { redactSecrets } from "../config/setup.js";

export type ApprovalDecisionKind = "approve-once" | "approve-session" | "approve-persistent" | "deny";
export type ApprovalRiskCategory = "shell" | "file-write" | "git-remote" | "publish" | "destructive" | "custom";
export type ApprovalGrantScope = "session" | "persistent";
export type ApprovalRequestStatus = "pending" | "approved" | "denied" | "expired" | "cancelled" | "failed";
export type ApprovalAuditEventKind = "requested" | "approved-once" | "approved-for-session" | "persistent-grant-created" | "denied" | "expired" | "cancelled" | "failed" | "grant-used" | "grant-revoked";

export interface ApprovalGateRule {
  id?: string;
  tools?: string[];
  toolNames?: string[];
  categories?: ApprovalRiskCategory[];
  commandPatterns?: string[];
  pathPatterns?: string[];
  textPatterns?: string[];
  description?: string;
}

export interface ApprovalGateConfig {
  enabled?: boolean;
  timeoutMs?: number;
  rules?: ApprovalGateRule[];
  sessionGrants?: boolean;
  sessionGrantTtlMs?: number;
  allowRemotePersistentGrants?: boolean;
  persistentGrantTtlMs?: number;
  maxAuditEvents?: number;
}

export interface ResolvedApprovalGateConfig {
  enabled: boolean;
  timeoutMs: number;
  rules: ApprovalGateRule[];
  sessionGrants: boolean;
  sessionGrantTtlMs: number;
  allowRemotePersistentGrants: boolean;
  persistentGrantTtlMs: number;
  maxAuditEvents: number;
}

export interface ApprovalOperation {
  operationId: string;
  toolName: string;
  input: unknown;
  category: ApprovalRiskCategory;
  summary: string;
  matcherFingerprint: string;
  matchedRuleId?: string;
}

export interface ApprovalRequestRecord {
  approvalId: string;
  sessionKey: string;
  sessionLabel: string;
  operationId: string;
  toolName: string;
  category: ApprovalRiskCategory;
  safeSummary: string;
  matcherFingerprint: string;
  matchedRuleId?: string;
  requester: RelayFileDeliveryRequester;
  createdAt: string;
  expiresAt: string;
  status: ApprovalRequestStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  decision?: ApprovalDecisionKind;
}

export interface ApprovalGrantRecord {
  grantId: string;
  scope: ApprovalGrantScope;
  sessionKey?: string;
  matcherFingerprint: string;
  requester: RelayFileDeliveryRequester;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export interface ApprovalAuditEvent {
  eventId: string;
  kind: ApprovalAuditEventKind;
  approvalId?: string;
  grantId?: string;
  sessionKey: string;
  sessionLabel?: string;
  toolName?: string;
  category?: ApprovalRiskCategory;
  matcherFingerprint?: string;
  requester?: Pick<RelayFileDeliveryRequester, "channel" | "instanceId" | "conversationId" | "userId" | "threadId" | "safeLabel">;
  summary?: string;
  at: string;
  expiresAt?: string;
  detail?: string;
}

export interface ApprovalDecisionRequest {
  approvalId: string;
  decision: ApprovalDecisionKind;
  channel: string;
  instanceId?: string;
  conversationId: string;
  userId: string;
  threadId?: string;
}

export interface ApprovalDecisionResult {
  ok: boolean;
  status: "approved" | "denied" | "expired" | "cancelled" | "stale" | "unauthorized" | "failed";
  message: string;
}

export const DEFAULT_APPROVAL_TIMEOUT_MS = 2 * 60_000;
export const DEFAULT_APPROVAL_SESSION_GRANT_TTL_MS = 60 * 60_000;
export const DEFAULT_APPROVAL_PERSISTENT_GRANT_TTL_MS = 7 * 24 * 60 * 60_000;
export const DEFAULT_APPROVAL_AUDIT_EVENTS = 200;
export const MIN_APPROVAL_TIMEOUT_MS = 5_000;
export const MAX_APPROVAL_TIMEOUT_MS = 30 * 60_000;
export const MAX_APPROVAL_SUMMARY_CHARS = 700;
const ACTION_PREFIX = "pirelay:approval";

export function resolveApprovalGateConfig(config: ApprovalGateConfig | undefined): ResolvedApprovalGateConfig {
  const enabled = config?.enabled === true;
  return {
    enabled,
    timeoutMs: clampNumber(config?.timeoutMs, DEFAULT_APPROVAL_TIMEOUT_MS, MIN_APPROVAL_TIMEOUT_MS, MAX_APPROVAL_TIMEOUT_MS),
    rules: Array.isArray(config?.rules) ? config.rules : [],
    sessionGrants: config?.sessionGrants ?? true,
    sessionGrantTtlMs: clampNumber(config?.sessionGrantTtlMs, DEFAULT_APPROVAL_SESSION_GRANT_TTL_MS, MIN_APPROVAL_TIMEOUT_MS, 24 * 60 * 60_000),
    allowRemotePersistentGrants: config?.allowRemotePersistentGrants === true,
    persistentGrantTtlMs: clampNumber(config?.persistentGrantTtlMs, DEFAULT_APPROVAL_PERSISTENT_GRANT_TTL_MS, MIN_APPROVAL_TIMEOUT_MS, 30 * 24 * 60 * 60_000),
    maxAuditEvents: Math.max(1, Math.min(1_000, Math.trunc(config?.maxAuditEvents ?? DEFAULT_APPROVAL_AUDIT_EVENTS))),
  };
}

export function approvalConfigFindings(config: ResolvedApprovalGateConfig): string[] {
  if (!config.enabled) return ["Approval gates disabled."];
  const findings = [`Approval gates enabled with ${config.rules.length} rule(s).`];
  findings.push(`Timeout: ${Math.round(config.timeoutMs / 1000)}s.`);
  findings.push(`Session grants: ${config.sessionGrants ? `enabled (${Math.round(config.sessionGrantTtlMs / 1000)}s TTL)` : "disabled"}.`);
  findings.push(`Remote persistent grants: ${config.allowRemotePersistentGrants ? "enabled" : "disabled"}.`);
  return findings;
}

export function classifyApprovalOperation(input: { toolName: string; toolCallId?: string; input: unknown }, config: ResolvedApprovalGateConfig): ApprovalOperation | undefined {
  if (!config.enabled || config.rules.length === 0) return undefined;
  const toolName = input.toolName.trim();
  const summary = summarizeToolCall(toolName, input.input);
  const category = inferApprovalCategory(toolName, input.input, summary);
  const searchable = `${toolName}\n${category}\n${rawSearchText(input.input)}\n${summary}`.toLowerCase();
  const pathText = extractPathText(input.input).toLowerCase();
  const commandText = extractCommandText(input.input).toLowerCase();
  const matched = config.rules.find((rule) => ruleMatches(rule, { toolName, category, searchable, pathText, commandText }));
  if (!matched) return undefined;
  const matcherFingerprint = approvalMatcherFingerprint({ toolName, category, matchedRuleId: matched.id, summaryBasis: fingerprintBasis(toolName, input.input, summary) });
  return {
    operationId: input.toolCallId?.trim() || randomUUID(),
    toolName,
    input: input.input,
    category,
    summary,
    matcherFingerprint,
    matchedRuleId: matched.id,
  };
}

export function summarizeToolCall(toolName: string, input: unknown): string {
  const name = toolName.trim() || "tool";
  if (name === "bash") {
    const command = extractStringField(input, "command") ?? rawSearchText(input);
    return boundSummary(`Run shell command: ${redactApprovalText(command)}`);
  }
  if (name === "write") {
    const path = extractStringField(input, "path") ?? extractStringField(input, "filePath") ?? "unknown path";
    const content = extractStringField(input, "content") ?? "";
    return boundSummary(`Write file: ${redactApprovalText(path)}${content ? ` (${content.length} chars)` : ""}`);
  }
  if (name === "edit") {
    const path = extractStringField(input, "path") ?? extractStringField(input, "filePath") ?? "unknown path";
    const oldText = extractStringField(input, "oldText") ?? "";
    const newText = extractStringField(input, "newText") ?? "";
    return boundSummary(`Edit file: ${redactApprovalText(path)} (${oldText.length} → ${newText.length} chars)`);
  }
  return boundSummary(`${name}: ${redactApprovalText(rawSearchText(input))}`);
}

export function redactApprovalText(text: string): string {
  return redactSecrets(text)
    .replace(/(token|secret|password|passwd|api[_-]?key|authorization)\s*[:=]\s*([^\s"']+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/--(token|password|secret|api-key|api_key)\s+[^\s"']+/gi, "--$1 [redacted]")
    .replace(/https?:\/\/[^\s"']*(token|secret|key|signature|sig|X-Amz-Signature)[^\s"']*/gi, "[redacted-url]");
}

export function inferApprovalCategory(toolName: string, input: unknown, summary = rawSearchText(input)): ApprovalRiskCategory {
  if (toolName === "write" || toolName === "edit") return "file-write";
  if (toolName !== "bash") return "custom";
  const command = (extractCommandText(input) || summary).toLowerCase();
  if (/\b(git\s+push|git\s+pull|git\s+fetch|git\s+remote|gh\s+release|gh\s+repo)\b/.test(command)) return "git-remote";
  if (/\b(npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|twine\s+upload|docker\s+push|cargo\s+publish)\b/.test(command)) return "publish";
  if (/\b(rm\s+-[^\n]*r|rm\s+-rf|sudo\b|chmod\s+777|chown\b|mkfs\b|dd\s+if=|killall\b|pkill\b)\b/.test(command)) return "destructive";
  return "shell";
}

export function approvalMatcherFingerprint(input: { toolName: string; category: ApprovalRiskCategory; matchedRuleId?: string; summaryBasis: string }): string {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
  return `${input.category}:${input.toolName}:${input.matchedRuleId ?? "rule"}:${hash}`;
}

export function approvalActionData(decision: ApprovalDecisionKind, approvalId: string): string {
  return `${ACTION_PREFIX}:${decision}:${approvalId}`;
}

export function parseApprovalTextCommand(command: string, args: string): { decision: ApprovalDecisionKind; approvalId: string } | undefined {
  if (command !== "approval" && command !== "approve") return undefined;
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const verb = command === "approve" ? "approve" : parts.shift();
  const approvalId = parts.shift();
  if (!verb || !approvalId) return undefined;
  const decision = verb === "approve" ? "approve-once"
    : verb === "approve-session" || verb === "session" ? "approve-session"
    : verb === "approve-persistent" || verb === "persistent" ? "approve-persistent"
    : verb === "deny" ? "deny"
    : undefined;
  return decision ? { decision, approvalId } : undefined;
}

export function parseApprovalActionData(value: string): { decision: ApprovalDecisionKind; approvalId: string } | undefined {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "pirelay" || parts[1] !== "approval") return undefined;
  const decision = parts[2];
  if (decision !== "approve-once" && decision !== "approve-session" && decision !== "approve-persistent" && decision !== "deny") return undefined;
  const approvalId = parts[3]?.trim();
  return approvalId ? { decision, approvalId } : undefined;
}

export function approvalButtons(record: ApprovalRequestRecord, config: ResolvedApprovalGateConfig): ChannelButtonLayout {
  const buttons: ChannelButtonLayout[number] = [
    { label: "Approve once", actionData: approvalActionData("approve-once", record.approvalId), style: "primary" },
    { label: "Deny", actionData: approvalActionData("deny", record.approvalId), style: "danger" },
  ];
  if (config.sessionGrants) buttons.splice(1, 0, { label: "Approve for session", actionData: approvalActionData("approve-session", record.approvalId), style: "default" });
  if (config.allowRemotePersistentGrants) buttons.splice(buttons.length - 1, 0, { label: "Approve persistent", actionData: approvalActionData("approve-persistent", record.approvalId), style: "default" });
  return [buttons];
}

export function renderApprovalRequest(record: ApprovalRequestRecord, config: ResolvedApprovalGateConfig): string {
  const lines = [
    "Approval required",
    `Session: ${record.sessionLabel}`,
    `Operation: ${record.category} (${record.toolName})`,
    `Summary: ${record.safeSummary}`,
    `Expires: ${record.expiresAt}`,
    "Timeout denies automatically.",
    "",
    "Fallback actions:",
    `- Approve once: relay approval approve ${record.approvalId}`,
  ];
  if (config.sessionGrants) lines.push(`- Approve for session: relay approval approve-session ${record.approvalId}`);
  if (config.allowRemotePersistentGrants) lines.push(`- Approve persistent: relay approval approve-persistent ${record.approvalId}`);
  lines.push(`- Deny: relay approval deny ${record.approvalId}`);
  return lines.join("\n");
}

export function createApprovalRequest(input: { route: SessionRoute; requester: RelayFileDeliveryRequester; operation: ApprovalOperation; now?: number; timeoutMs: number }): ApprovalRequestRecord {
  const now = input.now ?? Date.now();
  return {
    approvalId: randomUUID(),
    sessionKey: input.route.sessionKey,
    sessionLabel: input.route.sessionLabel,
    operationId: input.operation.operationId,
    toolName: input.operation.toolName,
    category: input.operation.category,
    safeSummary: input.operation.summary,
    matcherFingerprint: input.operation.matcherFingerprint,
    matchedRuleId: input.operation.matchedRuleId,
    requester: input.requester,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.timeoutMs).toISOString(),
    status: "pending",
  };
}

export function requesterMatchesApproval(requester: RelayFileDeliveryRequester, decision: ApprovalDecisionRequest): boolean {
  return requester.channel === decision.channel
    && requester.instanceId === (decision.instanceId ?? "default")
    && requester.conversationId === decision.conversationId
    && requester.userId === decision.userId
    && (requester.threadId ?? "") === (decision.threadId ?? "");
}

export function grantMatchesOperation(grant: ApprovalGrantRecord, input: { route: SessionRoute; requester: RelayFileDeliveryRequester; operation: ApprovalOperation; now?: number }): boolean {
  const now = input.now ?? Date.now();
  if (grant.revokedAt) return false;
  if (Date.parse(grant.expiresAt) <= now) return false;
  if (grant.matcherFingerprint !== input.operation.matcherFingerprint) return false;
  if (grant.scope === "session" && grant.sessionKey !== input.route.sessionKey) return false;
  return requesterMatchesGrant(grant, input.requester);
}

export function requesterMatchesGrant(grant: ApprovalGrantRecord, requester: RelayFileDeliveryRequester): boolean {
  return grant.requester.channel === requester.channel
    && grant.requester.instanceId === requester.instanceId
    && grant.requester.conversationId === requester.conversationId
    && grant.requester.userId === requester.userId
    && (grant.requester.threadId ?? "") === (requester.threadId ?? "");
}

export function createApprovalGrant(input: { scope: ApprovalGrantScope; record: ApprovalRequestRecord; createdBy: string; now?: number; ttlMs: number }): ApprovalGrantRecord {
  const now = input.now ?? Date.now();
  return {
    grantId: randomUUID(),
    scope: input.scope,
    sessionKey: input.scope === "session" ? input.record.sessionKey : undefined,
    matcherFingerprint: input.record.matcherFingerprint,
    requester: input.record.requester,
    createdBy: input.createdBy,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.ttlMs).toISOString(),
  };
}

export function approvalAuditEvent(input: Omit<ApprovalAuditEvent, "eventId" | "at"> & { at?: string }): ApprovalAuditEvent {
  return {
    eventId: randomUUID(),
    at: input.at ?? new Date().toISOString(),
    ...input,
    summary: input.summary ? boundSummary(redactApprovalText(input.summary)) : undefined,
  };
}

function ruleMatches(rule: ApprovalGateRule, input: { toolName: string; category: ApprovalRiskCategory; searchable: string; pathText: string; commandText: string }): boolean {
  const tools = [...(rule.tools ?? []), ...(rule.toolNames ?? [])].map((tool) => tool.toLowerCase());
  if (tools.length > 0 && !tools.includes(input.toolName.toLowerCase())) return false;
  if (rule.categories && rule.categories.length > 0 && !rule.categories.includes(input.category)) return false;
  if (patternsMatch(rule.commandPatterns, input.commandText)) return true;
  if (patternsMatch(rule.pathPatterns, input.pathText)) return true;
  if (patternsMatch(rule.textPatterns, input.searchable)) return true;
  return tools.length > 0 || Boolean(rule.categories && rule.categories.length > 0);
}

function patternsMatch(patterns: string[] | undefined, text: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    const normalized = pattern.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith("/") && normalized.endsWith("/") && normalized.length > 2) {
      try {
        return new RegExp(normalized.slice(1, -1), "i").test(text);
      } catch (error) {
        throw new Error(`Invalid approval pattern ${pattern}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return text.includes(normalized);
  });
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function extractStringField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object" || !(field in input)) return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function extractCommandText(input: unknown): string {
  return extractStringField(input, "command") ?? extractStringField(input, "cmd") ?? "";
}

function extractPathText(input: unknown): string {
  return ["path", "filePath", "relativePath"].map((field) => extractStringField(input, field)).filter(Boolean).join("\n");
}

function rawSearchText(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input ?? {});
  } catch (error) {
    throw new Error(`Could not summarize approval input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fingerprintBasis(toolName: string, input: unknown, summary: string): string {
  if (toolName === "bash") return extractCommandText(input) || summary;
  return `${extractPathText(input)}\n${summary}`;
}

function boundSummary(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= MAX_APPROVAL_SUMMARY_CHARS ? normalized : `${normalized.slice(0, MAX_APPROVAL_SUMMARY_CHARS - 1)}…`;
}
