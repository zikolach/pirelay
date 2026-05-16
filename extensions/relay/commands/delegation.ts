import type { DelegationTaskRecord, DelegationTaskStatus, DelegationTaskTarget } from "../core/agent-delegation.js";
import { renderDelegationTaskSummary, safeDelegationText } from "../core/agent-delegation.js";
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
    case "blocked":
      return [action("cancel", "Cancel"), action("status", "Status")];
    default:
      return [action("status", "Status")];
  }
}

export function renderDelegationTaskCard(task: DelegationTaskRecord, options: { commandPrefix?: string; includeActions?: boolean; maxTextChars?: number } = {}): DelegationTaskCard {
  const includeActions = options.includeActions ?? true;
  const summary = renderDelegationTaskSummary(task);
  const actions = includeActions ? delegationTaskActionsForStatus(task, { commandPrefix: options.commandPrefix }) : [];
  const actionText = actions.length > 0 ? `\n\nActions: ${actions.map((action) => action.command).join(" | ")}` : "";
  const maxTextChars = options.maxTextChars ?? 3900;
  return {
    text: safeDelegationText(`${summary}${actionText}`, { maxLength: maxTextChars, fallback: summary.slice(0, maxTextChars) }),
    actions,
  };
}

export function platformDelegationActionSurface(platform: MessengerKind | (string & {}), task: DelegationTaskRecord): PlatformDelegationActionSurface {
  const prefix = platform === "slack" ? "/pirelay task" : platform === "discord" ? "/relay task" : "/task";
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
