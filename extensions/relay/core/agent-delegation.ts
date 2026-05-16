import { randomBytes } from "node:crypto";
import type { MessengerKind } from "./messenger-ref.js";
import { getDefaultRedactionPatterns, redactSecret } from "./utils.js";

export const DELEGATION_TASK_ID_PREFIX = "task";
export const DEFAULT_DELEGATION_VISIBLE_TEXT_LIMIT = 320;
export const DEFAULT_DELEGATION_EVENT_MEMORY_LIMIT = 128;
export const DEFAULT_DELEGATION_MAX_DEPTH = 1;

export const delegationTaskStatuses = [
  "proposed",
  "awaiting-approval",
  "claimable",
  "claimed",
  "running",
  "blocked",
  "completed",
  "failed",
  "declined",
  "cancelled",
  "expired",
  "rejected",
] as const;

export type DelegationTaskStatus = typeof delegationTaskStatuses[number];

export type DelegationTerminalStatus = Extract<DelegationTaskStatus, "completed" | "failed" | "declined" | "cancelled" | "expired" | "rejected">;

export type DelegationTaskTarget =
  | { kind: "machine"; machineId: string; displayName?: string }
  | { kind: "capability"; capability: string; displayName?: string };

export interface DelegationActorRef {
  kind: "human" | "peer-bot" | "local-bot" | "system";
  id: string;
  displayName?: string;
}

export interface DelegationTaskRoomRef {
  messenger: MessengerKind | (string & {});
  instanceId: string;
  conversationId: string;
  threadId?: string;
  messageId?: string;
}

export interface DelegationTaskClaimant {
  machineId: string;
  sessionKey?: string;
  sessionLabel?: string;
  botId?: string;
  claimedAt: string;
}

export interface DelegationTaskAuditEvent {
  eventId: string;
  taskId: string;
  kind: DelegationTaskStatus | "created" | "approved" | "started" | "updated";
  actor?: DelegationActorRef;
  at: string;
  summary?: string;
}

export interface DelegationTaskRecord {
  id: string;
  status: DelegationTaskStatus;
  sourceMachineId: string;
  sourceMachineLabel?: string;
  sourceSessionLabel?: string;
  target: DelegationTaskTarget;
  goal: string;
  constraints?: string;
  room: DelegationTaskRoomRef;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  startedAt?: string;
  completedAt?: string;
  parentTaskId?: string;
  depth: number;
  claimedBy?: DelegationTaskClaimant;
  lastSafeSummary?: string;
  handledEventIds: string[];
  audit: DelegationTaskAuditEvent[];
}

export interface CreateDelegationTaskInput {
  id?: string;
  sourceMachineId: string;
  sourceMachineLabel?: string;
  sourceSessionLabel?: string;
  target: DelegationTaskTarget;
  goal: string;
  constraints?: string;
  room: DelegationTaskRoomRef;
  parentTaskId?: string;
  parentDepth?: number;
  depth?: number;
  status?: Extract<DelegationTaskStatus, "proposed" | "awaiting-approval" | "claimable">;
  expiryMs: number;
  createdAt?: string;
  redactionPatterns?: readonly string[];
  visibleTextLimit?: number;
}

export type DelegationTransitionAction =
  | { kind: "approve"; actor?: DelegationActorRef; summary?: string }
  | { kind: "claim"; claimant: Omit<DelegationTaskClaimant, "claimedAt">; actor?: DelegationActorRef; summary?: string }
  | { kind: "start"; actor?: DelegationActorRef; summary?: string }
  | { kind: "block"; actor?: DelegationActorRef; reason: string }
  | { kind: "complete"; actor?: DelegationActorRef; summary: string }
  | { kind: "fail"; actor?: DelegationActorRef; reason: string }
  | { kind: "decline"; actor?: DelegationActorRef; reason?: string }
  | { kind: "cancel"; actor?: DelegationActorRef; reason?: string }
  | { kind: "expire"; actor?: DelegationActorRef; reason?: string }
  | { kind: "reject"; actor?: DelegationActorRef; reason?: string };

export type DelegationTransitionResult =
  | { ok: true; task: DelegationTaskRecord }
  | { ok: false; reason: "terminal" | "expired" | "invalid-transition" | "already-claimed"; message: string };

export interface DelegationEventMemory {
  handledEventIds: readonly string[];
}

export interface DelegationIdempotencyResult {
  duplicate: boolean;
  handledEventIds: string[];
}

export interface TrustedDelegationPeer {
  peerId: string;
  displayName?: string;
  allowCreate?: boolean;
  allowClaim?: boolean;
  messenger?: MessengerKind | (string & {});
  instanceId?: string;
  conversationIds?: readonly string[];
  targetMachineIds?: readonly string[];
  capabilities?: readonly string[];
  revoked?: boolean;
}

export interface DelegationPeerCheckInput {
  peerId: string;
  room: DelegationTaskRoomRef;
  action: "create" | "claim" | "control";
  target?: DelegationTaskTarget;
  trustedPeers?: readonly TrustedDelegationPeer[];
}

export type DelegationPeerTrustDecision =
  | { trusted: true; peer: TrustedDelegationPeer }
  | { trusted: false; reason: "missing-peer" | "revoked" | "action-denied" | "wrong-room" | "target-denied" };

export type DelegationAutonomyLevel = "off" | "propose-only" | "auto-claim-targeted" | "auto-claim-safe-capability";

export interface DelegationEligibilityInput {
  task: DelegationTaskRecord;
  localMachineId: string;
  localCapabilities?: readonly string[];
  eligibleSessionKeys?: readonly string[];
  maxDepth?: number;
  autonomy: DelegationAutonomyLevel;
}

export type DelegationEligibilityDecision =
  | { eligible: true; reason: "targeted-machine" | "capability-match"; requiresHuman: boolean }
  | { eligible: false; reason: "disabled" | "remote-target" | "capability-missing" | "ambiguous-session" | "depth-exceeded" | "terminal" | "expired" };

export function generateDelegationTaskId(randomBytesFactory: (size: number) => Buffer = randomBytes): string {
  return `${DELEGATION_TASK_ID_PREFIX}-${randomBytesFactory(5).toString("base64url").toLowerCase()}`;
}

export function createDelegationTask(input: CreateDelegationTaskInput): DelegationTaskRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const depth = input.depth ?? nextDelegationDepth(input.parentDepth);
  const redactionPatterns = input.redactionPatterns ?? getDefaultRedactionPatterns();
  const visibleTextLimit = input.visibleTextLimit ?? DEFAULT_DELEGATION_VISIBLE_TEXT_LIMIT;
  const goal = safeDelegationText(input.goal, { maxLength: visibleTextLimit, redactionPatterns, fallback: "Delegated task" });
  const constraints = input.constraints ? safeDelegationText(input.constraints, { maxLength: visibleTextLimit, redactionPatterns, fallback: "" }) : undefined;
  const task: DelegationTaskRecord = {
    id: input.id ?? generateDelegationTaskId(),
    status: input.status ?? "proposed",
    sourceMachineId: safeIdentityText(input.sourceMachineId, "unknown-source"),
    sourceMachineLabel: input.sourceMachineLabel ? safeDelegationText(input.sourceMachineLabel, { maxLength: 80, redactionPatterns, fallback: undefined }) : undefined,
    sourceSessionLabel: input.sourceSessionLabel ? safeDelegationText(input.sourceSessionLabel, { maxLength: 80, redactionPatterns, fallback: undefined }) : undefined,
    target: sanitizeDelegationTarget(input.target, redactionPatterns),
    goal,
    constraints,
    room: sanitizeDelegationRoom(input.room),
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.parse(createdAt) + Math.max(1, input.expiryMs)).toISOString(),
    parentTaskId: input.parentTaskId ? safeIdentityText(input.parentTaskId, undefined) : undefined,
    depth,
    handledEventIds: [],
    audit: [],
  };
  return appendDelegationAudit(task, { kind: "created", at: createdAt, summary: goal });
}

export function isDelegationTaskStatus(value: string): value is DelegationTaskStatus {
  return (delegationTaskStatuses as readonly string[]).includes(value);
}

export function isDelegationTaskTerminal(task: Pick<DelegationTaskRecord, "status">): task is DelegationTaskRecord & { status: DelegationTerminalStatus } {
  return task.status === "completed" || task.status === "failed" || task.status === "declined" || task.status === "cancelled" || task.status === "expired" || task.status === "rejected";
}

export function isDelegationTaskExpired(task: Pick<DelegationTaskRecord, "expiresAt" | "status">, now: Date | string | number = Date.now()): boolean {
  if (isDelegationTaskTerminal(task)) return task.status === "expired";
  const timestamp = typeof now === "number" ? now : Date.parse(now instanceof Date ? now.toISOString() : now);
  return Date.parse(task.expiresAt) <= timestamp;
}

export function transitionDelegationTask(task: DelegationTaskRecord, action: DelegationTransitionAction, now: Date | string | number = Date.now()): DelegationTransitionResult {
  const at = toIsoTime(now);
  if (isDelegationTaskTerminal(task)) {
    return { ok: false, reason: "terminal", message: `Task ${task.id} is already ${task.status}.` };
  }
  if (action.kind !== "expire" && action.kind !== "cancel" && action.kind !== "reject" && isDelegationTaskExpired(task, at)) {
    return { ok: false, reason: "expired", message: `Task ${task.id} expired at ${task.expiresAt}.` };
  }

  switch (action.kind) {
    case "approve":
      if (task.status !== "awaiting-approval" && task.status !== "proposed") return invalid(task, action.kind);
      return transitioned(task, { status: "claimable", at, actor: action.actor, summary: action.summary ?? "Approved for claim" });
    case "claim":
      if (task.claimedBy) return { ok: false, reason: "already-claimed", message: `Task ${task.id} is already claimed by ${task.claimedBy.machineId}.` };
      if (task.status !== "proposed" && task.status !== "claimable") return invalid(task, action.kind);
      return transitioned(task, {
        status: "claimed",
        at,
        actor: action.actor,
        summary: action.summary ?? `Claimed by ${action.claimant.machineId}`,
        patch: { claimedBy: { ...action.claimant, claimedAt: at } },
      });
    case "start":
      if (task.status !== "claimed") return invalid(task, action.kind);
      return transitioned(task, { status: "running", at, actor: action.actor, summary: action.summary ?? "Started", patch: { startedAt: at } });
    case "block":
      if (task.status !== "proposed" && task.status !== "claimable" && task.status !== "claimed" && task.status !== "running") return invalid(task, action.kind);
      return transitioned(task, { status: "blocked", at, actor: action.actor, summary: action.reason });
    case "complete":
      if (task.status !== "claimed" && task.status !== "running") return invalid(task, action.kind);
      return transitioned(task, { status: "completed", at, actor: action.actor, summary: action.summary, patch: { completedAt: at, lastSafeSummary: safeDelegationText(action.summary) } });
    case "fail":
      if (task.status !== "claimed" && task.status !== "running" && task.status !== "blocked") return invalid(task, action.kind);
      return transitioned(task, { status: "failed", at, actor: action.actor, summary: action.reason, patch: { completedAt: at, lastSafeSummary: safeDelegationText(action.reason) } });
    case "decline":
      if (task.status !== "proposed" && task.status !== "claimable" && task.status !== "awaiting-approval") return invalid(task, action.kind);
      return transitioned(task, { status: "declined", at, actor: action.actor, summary: action.reason ?? "Declined", patch: { completedAt: at } });
    case "cancel":
      return transitioned(task, { status: "cancelled", at, actor: action.actor, summary: action.reason ?? "Cancelled", patch: { completedAt: at } });
    case "expire":
      return transitioned(task, { status: "expired", at, actor: action.actor, summary: action.reason ?? "Expired", patch: { completedAt: at } });
    case "reject":
      return transitioned(task, { status: "rejected", at, actor: action.actor, summary: action.reason ?? "Rejected", patch: { completedAt: at } });
  }
}

export function expireDelegationTaskIfNeeded(task: DelegationTaskRecord, now: Date | string | number = Date.now()): DelegationTaskRecord {
  if (!isDelegationTaskExpired(task, now) || isDelegationTaskTerminal(task)) return task;
  const result = transitionDelegationTask(task, { kind: "expire", reason: "Task expired" }, now);
  return result.ok ? result.task : task;
}

export function markDelegationTaskStaleAfterRestart(task: DelegationTaskRecord, now: Date | string | number = Date.now()): DelegationTaskRecord {
  if (isDelegationTaskTerminal(task)) return task;
  if (task.status !== "claimed" && task.status !== "running" && task.status !== "blocked") return expireDelegationTaskIfNeeded(task, now);
  const result = transitionDelegationTask(task, { kind: "block", reason: "Local broker restarted before delegated work could be confirmed; reclaim or cancel the task." }, now);
  return result.ok ? result.task : task;
}

export function expireDelegationTaskIfRunningTimedOut(task: DelegationTaskRecord, runningTimeoutMs: number, now: Date | string | number = Date.now()): DelegationTaskRecord {
  if (isDelegationTaskTerminal(task)) return task;
  if (task.status !== "claimed" && task.status !== "running") return task;
  const nowMs = typeof now === "number" ? now : Date.parse(now instanceof Date ? now.toISOString() : now);
  const startedMs = Date.parse(task.startedAt ?? task.claimedBy?.claimedAt ?? task.updatedAt);
  if (!Number.isFinite(startedMs) || nowMs - startedMs < Math.max(1, runningTimeoutMs)) return task;
  const result = transitionDelegationTask(task, { kind: "expire", reason: "Delegated work exceeded the configured running timeout." }, now);
  return result.ok ? result.task : task;
}

export function nextDelegationDepth(parentDepth: number | undefined): number {
  return Math.max(0, Math.floor(parentDepth ?? -1) + 1);
}

export function isDelegationDepthAllowed(depth: number, maxDepth = DEFAULT_DELEGATION_MAX_DEPTH): boolean {
  return depth <= Math.max(0, Math.floor(maxDepth));
}

export function delegationEventKey(input: { taskId?: string; action?: string; eventId?: string }): string {
  return [input.taskId, input.action, input.eventId].filter(Boolean).join(":");
}

export function rememberDelegationEvent(memory: DelegationEventMemory, eventId: string, maxEntries = DEFAULT_DELEGATION_EVENT_MEMORY_LIMIT): DelegationIdempotencyResult {
  const normalized = safeIdentityText(eventId, "");
  if (!normalized) return { duplicate: false, handledEventIds: [...memory.handledEventIds] };
  if (memory.handledEventIds.includes(normalized)) return { duplicate: true, handledEventIds: [...memory.handledEventIds] };
  return { duplicate: false, handledEventIds: [...memory.handledEventIds, normalized].slice(-Math.max(1, maxEntries)) };
}

export function withRememberedDelegationEvent(task: DelegationTaskRecord, eventId: string, maxEntries = DEFAULT_DELEGATION_EVENT_MEMORY_LIMIT): { duplicate: boolean; task: DelegationTaskRecord } {
  const remembered = rememberDelegationEvent(task, eventId, maxEntries);
  return { duplicate: remembered.duplicate, task: remembered.duplicate ? task : { ...task, handledEventIds: remembered.handledEventIds } };
}

export function safeDelegationText(value: string | undefined, options: { maxLength?: number; redactionPatterns?: readonly string[]; fallback?: string } = {}): string {
  const maxLength = Math.max(1, options.maxLength ?? DEFAULT_DELEGATION_VISIBLE_TEXT_LIMIT);
  const redactionPatterns = [...getDefaultRedactionPatterns(), ...(options.redactionPatterns ?? [])];
  const normalized = redactSecret(String(value ?? ""), redactionPatterns)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
  return bounded || (options.fallback ?? "");
}

export function safeIdentityText(value: string | undefined, fallback = "unknown"): string {
  const safe = String(value ?? "")
    .replace(/[\r\n\t]+/g, "-")
    .replace(/[^a-zA-Z0-9_.:@/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return safe || fallback;
}

export function renderDelegationTarget(target: DelegationTaskTarget): string {
  if (target.kind === "machine") return target.displayName ? `${target.displayName} (${target.machineId})` : target.machineId;
  return target.displayName ? `${target.displayName} (#${target.capability})` : `#${target.capability}`;
}

export function renderDelegationTaskSummary(task: DelegationTaskRecord): string {
  const lines = [
    `🧩 Delegation ${task.id}`,
    `Status: ${task.status}`,
    `From: ${task.sourceMachineLabel ?? task.sourceMachineId}`,
    `Target: ${renderDelegationTarget(task.target)}`,
    `Goal: ${task.goal}`,
    task.constraints ? `Constraints: ${task.constraints}` : undefined,
    `Expires: ${task.expiresAt}`,
  ];
  if (task.claimedBy) lines.push(`Claimed by: ${task.claimedBy.sessionLabel ? `${task.claimedBy.machineId}/${task.claimedBy.sessionLabel}` : task.claimedBy.machineId}`);
  if (task.lastSafeSummary) lines.push(`Latest: ${task.lastSafeSummary}`);
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

export function isTrustedDelegationPeer(input: DelegationPeerCheckInput): DelegationPeerTrustDecision {
  const peer = (input.trustedPeers ?? []).find((candidate) => candidate.peerId === input.peerId);
  if (!peer) return { trusted: false, reason: "missing-peer" };
  if (peer.revoked) return { trusted: false, reason: "revoked" };
  if (input.action === "create" && peer.allowCreate !== true) return { trusted: false, reason: "action-denied" };
  if (input.action === "claim" && peer.allowClaim !== true) return { trusted: false, reason: "action-denied" };
  if (input.action === "control") return { trusted: false, reason: "action-denied" };
  if (peer.messenger && peer.messenger !== input.room.messenger) return { trusted: false, reason: "wrong-room" };
  if (peer.instanceId && peer.instanceId !== input.room.instanceId) return { trusted: false, reason: "wrong-room" };
  if (peer.conversationIds && !peer.conversationIds.includes(input.room.conversationId)) return { trusted: false, reason: "wrong-room" };
  if (input.target?.kind === "machine" && peer.targetMachineIds && !peer.targetMachineIds.includes(input.target.machineId)) return { trusted: false, reason: "target-denied" };
  if (input.target?.kind === "capability" && peer.capabilities && !peer.capabilities.includes(input.target.capability)) return { trusted: false, reason: "target-denied" };
  return { trusted: true, peer };
}

export function evaluateDelegationEligibility(input: DelegationEligibilityInput, now: Date | string | number = Date.now()): DelegationEligibilityDecision {
  if (input.autonomy === "off") return { eligible: false, reason: "disabled" };
  if (isDelegationTaskTerminal(input.task)) return { eligible: false, reason: "terminal" };
  if (isDelegationTaskExpired(input.task, now)) return { eligible: false, reason: "expired" };
  if (!isDelegationDepthAllowed(input.task.depth, input.maxDepth)) return { eligible: false, reason: "depth-exceeded" };
  if (input.eligibleSessionKeys !== undefined && input.eligibleSessionKeys.length !== 1) return { eligible: false, reason: "ambiguous-session" };
  if (input.task.target.kind === "machine") {
    if (input.task.target.machineId !== input.localMachineId) return { eligible: false, reason: "remote-target" };
    return { eligible: true, reason: "targeted-machine", requiresHuman: input.autonomy === "propose-only" };
  }
  if (!(input.localCapabilities ?? []).includes(input.task.target.capability)) return { eligible: false, reason: "capability-missing" };
  return { eligible: true, reason: "capability-match", requiresHuman: input.autonomy !== "auto-claim-safe-capability" };
}

export function appendDelegationAudit(task: DelegationTaskRecord, input: { kind: DelegationTaskAuditEvent["kind"]; at?: string; actor?: DelegationActorRef; summary?: string; maxEntries?: number }): DelegationTaskRecord {
  const at = input.at ?? new Date().toISOString();
  const summary = input.summary ? safeDelegationText(input.summary) : undefined;
  const event: DelegationTaskAuditEvent = {
    eventId: delegationEventKey({ taskId: task.id, action: input.kind, eventId: at }),
    taskId: task.id,
    kind: input.kind,
    actor: input.actor,
    at,
    summary,
  };
  return { ...task, audit: [...task.audit, event].slice(-Math.max(1, input.maxEntries ?? 100)) };
}

function sanitizeDelegationTarget(target: DelegationTaskTarget, redactionPatterns: readonly string[]): DelegationTaskTarget {
  if (target.kind === "machine") {
    return {
      kind: "machine",
      machineId: safeIdentityText(target.machineId, "unknown-machine"),
      displayName: target.displayName ? safeDelegationText(target.displayName, { maxLength: 80, redactionPatterns, fallback: undefined }) : undefined,
    };
  }
  return {
    kind: "capability",
    capability: safeIdentityText(target.capability, "unknown-capability"),
    displayName: target.displayName ? safeDelegationText(target.displayName, { maxLength: 80, redactionPatterns, fallback: undefined }) : undefined,
  };
}

function sanitizeDelegationRoom(room: DelegationTaskRoomRef): DelegationTaskRoomRef {
  return {
    messenger: safeIdentityText(room.messenger, "unknown") as DelegationTaskRoomRef["messenger"],
    instanceId: safeIdentityText(room.instanceId, "default"),
    conversationId: safeIdentityText(room.conversationId, "unknown-conversation"),
    threadId: room.threadId ? safeIdentityText(room.threadId, undefined) : undefined,
    messageId: room.messageId ? safeIdentityText(room.messageId, undefined) : undefined,
  };
}

function transitioned(
  task: DelegationTaskRecord,
  input: { status: DelegationTaskStatus; at: string; actor?: DelegationActorRef; summary?: string; patch?: Partial<DelegationTaskRecord> },
): DelegationTransitionResult {
  const next: DelegationTaskRecord = {
    ...task,
    ...input.patch,
    status: input.status,
    updatedAt: input.at,
  };
  return { ok: true, task: appendDelegationAudit(next, { kind: input.status, at: input.at, actor: input.actor, summary: input.summary }) };
}

function invalid(task: DelegationTaskRecord, action: DelegationTransitionAction["kind"]): DelegationTransitionResult {
  return { ok: false, reason: "invalid-transition", message: `Cannot ${action} task ${task.id} while it is ${task.status}.` };
}

function toIsoTime(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return new Date(value).toISOString();
}
