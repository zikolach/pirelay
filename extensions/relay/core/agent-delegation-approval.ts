import { safeDelegationText, safeIdentityText } from "./agent-delegation.js";

export type DelegationApprovalGrantScope = "once" | "task" | "session" | "persistent";

export interface DelegationApprovalContext {
  taskId?: string;
  sessionKey: string;
  requesterKey?: string;
  bindingKey?: string;
  matcherFingerprint: string;
  toolName?: string;
  category?: string;
  expiresAt?: string;
}

export interface DelegationApprovalGrant {
  id: string;
  scope: Exclude<DelegationApprovalGrantScope, "once">;
  taskId?: string;
  sessionKey: string;
  requesterKey?: string;
  bindingKey?: string;
  matcherFingerprint: string;
  toolName?: string;
  category?: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface DelegationApprovalDecisionOption {
  id: "approve-once" | "approve-for-task" | "approve-for-session" | "deny";
  label: string;
  grantScope?: DelegationApprovalGrantScope;
  dangerous?: boolean;
}

export function delegationApprovalContext(input: DelegationApprovalContext): DelegationApprovalContext {
  return {
    taskId: input.taskId ? safeIdentityText(input.taskId, undefined) : undefined,
    sessionKey: safeIdentityText(input.sessionKey),
    requesterKey: input.requesterKey ? safeIdentityText(input.requesterKey, undefined) : undefined,
    bindingKey: input.bindingKey ? safeIdentityText(input.bindingKey, undefined) : undefined,
    matcherFingerprint: safeIdentityText(input.matcherFingerprint),
    toolName: input.toolName ? safeDelegationText(input.toolName, { maxLength: 80 }) : undefined,
    category: input.category ? safeDelegationText(input.category, { maxLength: 80 }) : undefined,
    expiresAt: input.expiresAt,
  };
}

export function createDelegationApprovalGrant(input: DelegationApprovalContext & { scope: Exclude<DelegationApprovalGrantScope, "once">; now?: string }): DelegationApprovalGrant {
  const context = delegationApprovalContext(input);
  const createdAt = input.now ?? new Date().toISOString();
  if (input.scope === "task" && !context.taskId) throw new Error("Task-scoped approval grants require a task id.");
  return {
    id: approvalGrantId(input.scope, context, createdAt),
    scope: input.scope,
    taskId: input.scope === "task" ? context.taskId : undefined,
    sessionKey: context.sessionKey,
    requesterKey: context.requesterKey,
    bindingKey: context.bindingKey,
    matcherFingerprint: context.matcherFingerprint,
    toolName: context.toolName,
    category: context.category,
    createdAt,
    expiresAt: context.expiresAt,
  };
}

export function delegationApprovalGrantMatches(grant: DelegationApprovalGrant, operation: DelegationApprovalContext, now: Date | string | number = Date.now()): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= toMillis(now)) return false;
  const context = delegationApprovalContext(operation);
  if (grant.matcherFingerprint !== context.matcherFingerprint) return false;
  if (grant.sessionKey !== context.sessionKey) return false;
  if (grant.requesterKey && grant.requesterKey !== context.requesterKey) return false;
  if (grant.bindingKey && grant.bindingKey !== context.bindingKey) return false;
  if (grant.scope === "task" && (!grant.taskId || grant.taskId !== context.taskId)) return false;
  if (grant.scope === "session") return true;
  if (grant.scope === "persistent") return true;
  return grant.scope === "task";
}

export function delegationApprovalOptions(input: { taskId?: string; allowSessionGrant?: boolean; allowPersistentGrant?: boolean } = {}): DelegationApprovalDecisionOption[] {
  const options: DelegationApprovalDecisionOption[] = [
    { id: "approve-once", label: "Approve once", grantScope: "once" },
  ];
  if (input.taskId) options.push({ id: "approve-for-task", label: "Approve for this delegated task", grantScope: "task" });
  if (input.allowSessionGrant) options.push({ id: "approve-for-session", label: "Approve matching operations for this session", grantScope: "session" });
  options.push({ id: "deny", label: "Deny", dangerous: true });
  return options;
}

export function formatDelegationApprovalSummary(input: DelegationApprovalContext): string {
  const context = delegationApprovalContext(input);
  return [
    context.taskId ? `Delegated task: ${context.taskId}` : undefined,
    `Session: ${context.sessionKey}`,
    context.toolName ? `Tool: ${context.toolName}` : undefined,
    context.category ? `Category: ${context.category}` : undefined,
    `Matcher: ${context.matcherFingerprint}`,
    context.expiresAt ? `Expires: ${context.expiresAt}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function approvalGrantId(scope: DelegationApprovalGrant["scope"], context: DelegationApprovalContext, createdAt: string): string {
  return ["grant", scope, context.taskId, context.sessionKey, context.requesterKey, context.bindingKey, context.matcherFingerprint, Date.parse(createdAt).toString(36)]
    .filter((value): value is string => Boolean(value))
    .map((value) => safeIdentityText(value, "x"))
    .join(":");
}

function toMillis(value: Date | string | number): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}
