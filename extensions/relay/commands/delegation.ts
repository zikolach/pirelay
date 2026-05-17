import type { DelegationTaskRecord, DelegationTaskStatus, DelegationTaskTarget } from "../core/agent-delegation.js";
import { safeDelegationText } from "../core/agent-delegation.js";
import type { ChannelButtonLayout } from "../core/channel-adapter.js";
import type { MessengerKind } from "../core/messenger-ref.js";
import { parseRemoteCommandInvocation } from "./remote.js";

export type DelegationCommand =
  | { kind: "create"; target: DelegationTaskTarget; goal: string; rawGoal: string; awaitApproval: boolean }
  | { kind: "claim"; taskId: string }
  | { kind: "approve"; taskId: string }
  | { kind: "decline"; taskId: string; reason?: string }
  | { kind: "cancel"; taskId: string; reason?: string }
  | { kind: "status"; taskId: string }
  | { kind: "history"; taskId?: string };

export type DelegationActionKind = "claim" | "decline" | "cancel" | "status" | "approve";

export interface DelegationTaskAction {
  kind: DelegationActionKind;
  label: string;
  command: string;
  actionId: string;
}

export interface DelegationTaskCard {
  text: string;
  actions: DelegationTaskAction[];
  fallbackText: string;
  accessibilityText: string;
  presentation: DelegationTaskPresentation;
}

export interface DelegationTaskPresentationField {
  label: string;
  value: string;
}

export interface DelegationTaskPresentation {
  title: string;
  status: { value: DelegationTaskStatus; label: string; icon: string };
  fields: DelegationTaskPresentationField[];
  latest?: DelegationTaskPresentationField;
  actions: DelegationTaskAction[];
  fallbackText: string;
  accessibilityText: string;
}

export interface PlatformDelegationActionSurface {
  platform: MessengerKind | (string & {});
  textFallback: string;
  actions: DelegationTaskAction[];
}

export function parseDelegationInvocation(text: string, options: { prefixes?: string[] } = {}): DelegationCommand | undefined {
  const invocation = parseRemoteCommandInvocation(text, { prefixes: options.prefixes ?? ["relay", "pirelay"] });
  if (!invocation) return undefined;
  return parseDelegationCommand(invocation.command, invocation.args);
}

export function parseDelegationCommand(command: string, args: string): DelegationCommand | undefined {
  const normalized = command.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "delegate" || normalized === "propose") return parseCreateCommand(args, normalized === "propose");
  if (normalized === "claim") return parseTaskIdCommand("claim", args);
  if (normalized === "approve") return parseTaskIdCommand("approve", args);
  if (normalized === "decline") return parseTaskIdWithReasonCommand("decline", args);
  if (normalized === "cancel") return parseTaskIdWithReasonCommand("cancel", args);
  if (normalized === "task") return parseTaskCommand(args);
  if (normalized === "tasks" || normalized === "history") return parseHistoryCommand(args);
  return undefined;
}

export function delegationActionId(kind: DelegationActionKind, taskId: string): string {
  return `pirelay:delegation:${kind}:${taskId}`;
}

export function parseDelegationActionId(value: string): { kind: DelegationActionKind; taskId: string } | undefined {
  const [namespace, feature, kind, ...taskIdParts] = value.split(":");
  if (namespace !== "pirelay" || feature !== "delegation" || !isDelegationActionKind(kind)) return undefined;
  const taskId = taskIdParts.join(":").trim();
  if (!taskId) return undefined;
  return { kind, taskId };
}

export function delegationTaskActionsForStatus(task: Pick<DelegationTaskRecord, "id" | "status">, options: { commandPrefix?: string } = {}): DelegationTaskAction[] {
  const prefix = options.commandPrefix ?? "/task";
  const action = (kind: DelegationActionKind, label: string): DelegationTaskAction => ({
    kind,
    label,
    command: `${prefix} ${kind} ${task.id}`,
    actionId: delegationActionId(kind, task.id),
  });
  switch (task.status) {
    case "proposed":
    case "claimable":
      return [action("claim", "Claim"), action("decline", "Decline"), action("cancel", "Cancel"), action("status", "Status")];
    case "awaiting-approval":
      return [action("approve", "Approve"), action("cancel", "Cancel"), action("status", "Status")];
    case "claimed":
    case "running":
      return [action("cancel", "Cancel"), action("status", "Status")];
    default:
      return [action("status", "Status")];
  }
}

export function renderDelegationTaskPresentation(task: DelegationTaskRecord, options: { commandPrefix?: string; includeActions?: boolean; maxTextChars?: number } = {}): DelegationTaskPresentation {
  const includeActions = options.includeActions ?? true;
  const actions = includeActions ? delegationTaskActionsForStatus(task, { commandPrefix: options.commandPrefix }) : [];
  const status = delegationPresentationStatus(task.status);
  const source = task.sourceSessionLabel ? `${task.sourceMachineLabel ?? task.sourceMachineId}/${task.sourceSessionLabel}` : task.sourceMachineLabel ?? task.sourceMachineId;
  const fields: DelegationTaskPresentationField[] = [
    { label: "Status", value: status.label },
    { label: "From", value: source },
    { label: "Target", value: renderDelegationTargetLabel(task.target) },
    { label: "Goal", value: task.goal },
    task.constraints ? { label: "Constraints", value: task.constraints } : undefined,
    { label: "Expires", value: task.expiresAt },
    task.claimedBy ? { label: "Claimed by", value: renderDelegationClaimant(task.claimedBy) } : undefined,
  ].filter((field): field is DelegationTaskPresentationField => Boolean(field));
  const latestText = task.lastSafeSummary ?? [...task.audit].reverse().find((event) => event.summary && isVisibleDelegationAuditSummary(event.kind))?.summary;
  const latest = latestText ? { label: terminalDelegationStatus(task.status) ? "Result" : "Latest", value: latestText } : undefined;
  const fallbackText = actions.length > 0 ? actions.map((action) => action.command).join("\n") : `${options.commandPrefix ?? "/task"} status ${task.id}`;
  const title = `${status.icon} Delegation ${task.id}`;
  const fieldText = fields.map((field) => `${field.label}: ${field.value}`).join("\n");
  const latestLine = latest ? `\n${latest.label}: ${latest.value}` : "";
  const fallbackBlock = actions.length > 0 ? `\n\nFallback commands:\n${fallbackText}` : "";
  const accessibilityText = `${title}\n${fieldText}${latestLine}${fallbackBlock}`;
  const maxTextChars = options.maxTextChars ?? 3900;
  const boundedAccessibility = safeDelegationText(accessibilityText, { maxLength: maxTextChars, fallback: `${title}\n${fieldText}`.slice(0, maxTextChars) });
  return {
    title,
    status,
    fields,
    latest,
    actions,
    fallbackText: safeDelegationText(fallbackText, { maxLength: maxTextChars, fallback: fallbackText.slice(0, maxTextChars) }),
    accessibilityText: boundedAccessibility,
  };
}

export function renderDelegationTaskCard(task: DelegationTaskRecord, options: { commandPrefix?: string; includeActions?: boolean; maxTextChars?: number } = {}): DelegationTaskCard {
  const presentation = renderDelegationTaskPresentation(task, options);
  return {
    text: presentation.accessibilityText,
    actions: presentation.actions,
    fallbackText: presentation.fallbackText,
    accessibilityText: presentation.accessibilityText,
    presentation,
  };
}

export function delegationTaskActionButtons(actions: readonly DelegationTaskAction[]): ChannelButtonLayout | undefined {
  if (actions.length === 0) return undefined;
  return [actions.map((action) => ({
    label: action.label,
    actionData: action.actionId,
    style: action.kind === "claim" || action.kind === "approve" ? "primary" : action.kind === "cancel" || action.kind === "decline" ? "danger" : "default",
  }))];
}

function delegationPresentationStatus(status: DelegationTaskStatus): DelegationTaskPresentation["status"] {
  switch (status) {
    case "proposed":
      return { value: status, label: "Proposed", icon: "🧩" };
    case "awaiting-approval":
      return { value: status, label: "Awaiting approval", icon: "⏳" };
    case "claimable":
      return { value: status, label: "Claimable", icon: "🧩" };
    case "claimed":
      return { value: status, label: "Claimed", icon: "📌" };
    case "running":
      return { value: status, label: "Running", icon: "🏃" };
    case "completed":
      return { value: status, label: "Completed", icon: "✅" };
    case "blocked":
      return { value: status, label: "Blocked", icon: "🚧" };
    case "failed":
      return { value: status, label: "Failed", icon: "❌" };
    case "declined":
      return { value: status, label: "Declined", icon: "↩️" };
    case "cancelled":
      return { value: status, label: "Cancelled", icon: "🛑" };
    case "expired":
      return { value: status, label: "Expired", icon: "⌛" };
    case "rejected":
      return { value: status, label: "Rejected", icon: "⛔" };
  }
}

function renderDelegationTargetLabel(target: DelegationTaskTarget): string {
  return target.displayName ?? (target.kind === "machine" ? target.machineId : `#${target.capability}`);
}

function renderDelegationClaimant(claimant: DelegationTaskRecord["claimedBy"]): string {
  if (!claimant) return "unknown";
  return claimant.sessionLabel ? `${claimant.machineId}/${claimant.sessionLabel}` : claimant.machineId;
}

function terminalDelegationStatus(status: DelegationTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "declined" || status === "cancelled" || status === "expired" || status === "rejected";
}

function isVisibleDelegationAuditSummary(kind: string): boolean {
  return kind === "blocked" || kind === "completed" || kind === "failed" || kind === "declined" || kind === "cancelled" || kind === "expired" || kind === "rejected" || kind === "running" || kind === "claimed";
}

export function platformDelegationActionSurface(platform: MessengerKind | (string & {}), task: DelegationTaskRecord): PlatformDelegationActionSurface {
  const prefix = platform === "telegram" ? "/task" : "relay task";
  const actions = delegationTaskActionsForStatus(task, { commandPrefix: prefix });
  const textFallback = actions.length > 0 ? actions.map((action) => action.command).join(" | ") : `${prefix} status ${task.id}`;
  return { platform, textFallback, actions };
}

function parseCreateCommand(args: string, awaitApproval: boolean): DelegationCommand | undefined {
  const parsed = splitFirstToken(args);
  if (!parsed || !parsed.rest) return undefined;
  const target = parseDelegationTarget(parsed.first);
  if (!target) return undefined;
  return { kind: "create", target, goal: safeDelegationText(parsed.rest), rawGoal: parsed.rest, awaitApproval };
}

function parseTaskCommand(args: string): DelegationCommand | undefined {
  const parsed = splitFirstToken(args);
  if (!parsed) return { kind: "history" };
  const subcommand = parsed.first.toLowerCase().replace(/_/g, "-");
  if (subcommand === "claim") return parseTaskIdCommand("claim", parsed.rest);
  if (subcommand === "approve") return parseTaskIdCommand("approve", parsed.rest);
  if (subcommand === "decline") return parseTaskIdWithReasonCommand("decline", parsed.rest);
  if (subcommand === "cancel") return parseTaskIdWithReasonCommand("cancel", parsed.rest);
  if (subcommand === "status") return parseTaskIdCommand("status", parsed.rest);
  if (subcommand === "history" || subcommand === "list") return parseHistoryCommand(parsed.rest);
  return parseTaskIdCommand("status", args);
}

function parseHistoryCommand(args: string): DelegationCommand {
  const taskId = args.trim().split(/\s+/)[0]?.trim();
  return taskId ? { kind: "history", taskId } : { kind: "history" };
}

function parseTaskIdCommand(kind: "claim" | "approve" | "status", args: string): DelegationCommand | undefined {
  const taskId = args.trim().split(/\s+/)[0]?.trim();
  if (!taskId) return undefined;
  return { kind, taskId };
}

function parseTaskIdWithReasonCommand(kind: "decline" | "cancel", args: string): DelegationCommand | undefined {
  const parsed = splitFirstToken(args);
  if (!parsed) return undefined;
  const reason = parsed.rest ? safeDelegationText(parsed.rest) : undefined;
  return { kind, taskId: parsed.first, reason };
}

function parseDelegationTarget(value: string): DelegationTaskTarget | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("#")) {
    const capability = normalizeTargetValue(trimmed.slice(1));
    return capability ? { kind: "capability", capability } : undefined;
  }
  const [prefix, ...rest] = trimmed.split(":");
  if (prefix === "capability" || prefix === "cap") {
    const capability = normalizeTargetValue(rest.join(":"));
    return capability ? { kind: "capability", capability } : undefined;
  }
  if (prefix === "machine" || prefix === "bot") {
    const machineId = normalizeTargetValue(rest.join(":"));
    return machineId ? { kind: "machine", machineId } : undefined;
  }
  const machineId = normalizeTargetValue(trimmed);
  return machineId ? { kind: "machine", machineId } : undefined;
}

function normalizeTargetValue(value: string): string {
  return value.trim().replace(/^@+/, "").replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128);
}

function splitFirstToken(args: string): { first: string; rest: string } | undefined {
  const trimmed = args.trim();
  if (!trimmed) return undefined;
  const [first = "", ...rest] = trimmed.split(/\s+/);
  if (!first) return undefined;
  return { first, rest: rest.join(" ").trim() };
}

function isDelegationActionKind(value: string | undefined): value is DelegationActionKind {
  return value === "claim" || value === "decline" || value === "cancel" || value === "status" || value === "approve";
}

export function isDelegationTaskControlStatus(status: DelegationTaskStatus): boolean {
  return status === "proposed" || status === "awaiting-approval" || status === "claimable" || status === "claimed" || status === "running" || status === "blocked";
}
