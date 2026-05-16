import type { ChannelIdentity, ChannelInboundAction, ChannelInboundMessage } from "./channel-adapter.js";
import type { AgentDelegationRelayConfig, SessionRoute } from "./types.js";
import type { DelegationCommand } from "../commands/delegation.js";
import { parseDelegationActionId } from "../commands/delegation.js";
import {
  createDelegationTask,
  evaluateDelegationEligibility,
  isTrustedDelegationPeer,
  renderDelegationTaskSummary,
  safeDelegationText,
  transitionDelegationTask,
  type DelegationActorRef,
  type DelegationAutonomyLevel,
  type DelegationTaskRecord,
  type DelegationTaskRoomRef,
  type TrustedDelegationPeer,
} from "./agent-delegation.js";

export interface ResolvedDelegationRuntimePolicy {
  enabled: boolean;
  autonomy: DelegationAutonomyLevel;
  trustedPeers: TrustedDelegationPeer[];
  localCapabilities: string[];
  taskExpiryMs: number;
  runningTimeoutMs: number;
  maxDepth: number;
  maxVisibleSummaryChars: number;
  maxHistory: number;
  requireHumanApproval: boolean;
}

export type DelegationIngressDecision =
  | { kind: "ignore"; reason: "disabled" | "not-delegation" | "self-authored" | "untrusted-peer" | "not-eligible" | "duplicate"; message?: string }
  | { kind: "reject"; message: string }
  | { kind: "render-task"; task: DelegationTaskRecord; text: string }
  | { kind: "status"; task: DelegationTaskRecord; text: string }
  | { kind: "history"; tasks: DelegationTaskRecord[]; text: string }
  | { kind: "claim"; task: DelegationTaskRecord; requiresHuman: boolean; prompt: string }
  | { kind: "approve" | "cancel" | "decline"; task: DelegationTaskRecord; text: string };

export interface DelegationTaskLookup {
  get(taskId: string): Promise<DelegationTaskRecord | undefined>;
  list(options: { roomConversationId?: string; limit?: number }): Promise<DelegationTaskRecord[]>;
}

export interface DelegationIngressInput {
  command: DelegationCommand | undefined;
  message: ChannelInboundMessage;
  policy?: AgentDelegationRelayConfig;
  room: DelegationTaskRoomRef;
  localMachineId: string;
  localMachineLabel?: string;
  localBotUserId?: string;
  isAuthorizedHuman: boolean;
  lookup?: DelegationTaskLookup;
  eventAlreadyHandled?: boolean;
  eligibleRoutes?: readonly SessionRoute[];
  now?: string;
}

export function resolveDelegationRuntimePolicy(policy: AgentDelegationRelayConfig | undefined, machineCapabilities: readonly string[] = []): ResolvedDelegationRuntimePolicy {
  const requestedAutonomy = policy?.autonomy ?? (policy?.enabled === true ? "propose-only" : "off");
  const autonomy = isDelegationAutonomyLevel(requestedAutonomy) ? requestedAutonomy : "off";
  const enabled = policy?.enabled === true && autonomy !== "off";
  return {
    enabled,
    autonomy,
    trustedPeers: policy?.trustedPeers ?? [],
    localCapabilities: [...new Set([...machineCapabilities, ...(policy?.localCapabilities ?? [])].map((capability) => capability.trim()).filter(Boolean))],
    taskExpiryMs: policy?.taskExpiryMs ?? 10 * 60_000,
    runningTimeoutMs: policy?.runningTimeoutMs ?? 60 * 60_000,
    maxDepth: policy?.maxDepth ?? 1,
    maxVisibleSummaryChars: policy?.maxVisibleSummaryChars ?? 320,
    maxHistory: policy?.maxHistory ?? 50,
    requireHumanApproval: policy?.requireHumanApproval ?? autonomy === "propose-only",
  };
}

export async function evaluateDelegationIngress(input: DelegationIngressInput): Promise<DelegationIngressDecision> {
  const policy = resolveDelegationRuntimePolicy(input.policy, []);
  if (!input.command) return { kind: "ignore", reason: "not-delegation" };
  if (!policy.enabled || policy.autonomy === "off") return { kind: "ignore", reason: "disabled" };
  if (isSelfAuthoredDelegationEvent(input.message.sender, input.localBotUserId)) return { kind: "ignore", reason: "self-authored" };
  if (input.eventAlreadyHandled) return { kind: "ignore", reason: "duplicate" };

  const actor = delegationActorFromIdentity(input.message.sender);
  const peerBot = isPeerBotIdentity(input.message.sender);

  if (input.command.kind === "approve" && !input.isAuthorizedHuman) {
    return { kind: "reject", message: "Only an authorized human may approve a delegation task." };
  }

  if (peerBot) {
    const trust = isTrustedDelegationPeer({
      peerId: input.message.sender.userId,
      room: input.room,
      action: input.command.kind === "claim" ? "claim" : "create",
      target: input.command.kind === "create" ? input.command.target : undefined,
      trustedPeers: policy.trustedPeers,
    });
    if (!trust.trusted) return { kind: "ignore", reason: "untrusted-peer", message: `Ignored untrusted delegation peer: ${trust.reason}.` };
  } else if (!input.isAuthorizedHuman) {
    return { kind: "reject", message: "This identity is not authorized to control delegation tasks." };
  }

  if (input.command.kind === "create") {
    const status = input.command.awaitApproval || policy.requireHumanApproval && peerBot ? "awaiting-approval" : "claimable";
    const task = createDelegationTask({
      sourceMachineId: peerBot ? input.message.sender.userId : input.localMachineId,
      sourceMachineLabel: peerBot ? input.message.sender.displayName ?? input.message.sender.username : input.localMachineLabel,
      sourceSessionLabel: peerBot ? undefined : "shared-room",
      target: input.command.target,
      goal: input.command.rawGoal,
      room: input.room,
      expiryMs: policy.taskExpiryMs,
      createdAt: input.now,
      status,
      visibleTextLimit: policy.maxVisibleSummaryChars,
    });
    return { kind: "render-task", task, text: renderDelegationTaskSummary(task) };
  }

  const lookup = input.lookup;
  if (!lookup) return { kind: "reject", message: "Delegation task state is unavailable." };

  if (input.command.kind === "history") {
    const tasks = await lookup.list({ roomConversationId: input.room.conversationId, limit: policy.maxHistory });
    return { kind: "history", tasks, text: renderDelegationHistory(tasks) };
  }

  const task = await lookup.get(input.command.taskId);
  if (!task) return { kind: "reject", message: `Delegation task ${input.command.taskId} was not found or is stale.` };
  if (!delegationTaskRoomMatches(task, input.room)) return { kind: "reject", message: `Delegation task ${input.command.taskId} is not visible in this room or thread.` };

  if (input.command.kind === "status") return { kind: "status", task, text: renderDelegationTaskSummary(task) };

  if (input.command.kind === "approve") {
    const result = transitionDelegationTask(task, { kind: "approve", actor }, input.now);
    if (!result.ok) return { kind: "reject", message: result.message };
    return { kind: "approve", task: result.task, text: renderDelegationTaskSummary(result.task) };
  }

  if (input.command.kind === "cancel") {
    const result = transitionDelegationTask(task, { kind: "cancel", actor, reason: input.command.reason }, input.now);
    if (!result.ok) return { kind: "reject", message: result.message };
    return { kind: "cancel", task: result.task, text: renderDelegationTaskSummary(result.task) };
  }

  if (input.command.kind === "decline") {
    const result = transitionDelegationTask(task, { kind: "decline", actor, reason: input.command.reason }, input.now);
    if (!result.ok) return { kind: "reject", message: result.message };
    return { kind: "decline", task: result.task, text: renderDelegationTaskSummary(result.task) };
  }

  const eligible = evaluateDelegationEligibility({
    task,
    localMachineId: input.localMachineId,
    localCapabilities: policy.localCapabilities,
    eligibleSessionKeys: input.eligibleRoutes?.map((route) => route.sessionKey),
    maxDepth: policy.maxDepth,
    autonomy: policy.autonomy,
  }, input.now);
  if (!eligible.eligible) return { kind: "ignore", reason: "not-eligible", message: `Delegation task ${task.id} is not eligible locally: ${eligible.reason}.` };
  const route = input.eligibleRoutes?.[0];
  const claimant = { machineId: input.localMachineId, sessionKey: route?.sessionKey, sessionLabel: route?.sessionLabel, botId: input.localBotUserId };
  const result = transitionDelegationTask(task, { kind: "claim", actor, claimant }, input.now);
  if (!result.ok) return { kind: "reject", message: result.message };
  return { kind: "claim", task: result.task, requiresHuman: eligible.requiresHuman, prompt: buildDelegatedTaskPrompt(result.task) };
}

export function delegationRoomFromMessage(message: ChannelInboundMessage | ChannelInboundAction, instanceId: string): DelegationTaskRoomRef {
  return {
    messenger: message.channel,
    instanceId,
    conversationId: message.conversation.id,
    threadId: typeof message.metadata?.threadId === "string" ? message.metadata.threadId : typeof message.metadata?.threadTs === "string" ? message.metadata.threadTs : undefined,
    messageId: "messageId" in message ? message.messageId : undefined,
  };
}

export function isSelfAuthoredDelegationEvent(sender: ChannelIdentity, localBotUserId: string | undefined): boolean {
  return Boolean(localBotUserId && sender.userId === localBotUserId);
}

export function isPeerBotIdentity(sender: ChannelIdentity): boolean {
  return sender.metadata?.isBot === true || typeof sender.metadata?.botId === "string" || sender.metadata?.liveStubBotMessage === true;
}

export function delegationActorFromIdentity(sender: ChannelIdentity): DelegationActorRef {
  return {
    kind: isPeerBotIdentity(sender) ? "peer-bot" : "human",
    id: sender.userId,
    displayName: sender.displayName ?? sender.username,
  };
}

export function delegationTaskRoomMatches(task: Pick<DelegationTaskRecord, "room">, room: DelegationTaskRoomRef): boolean {
  if (task.room.messenger !== room.messenger) return false;
  if (task.room.instanceId !== room.instanceId) return false;
  if (task.room.conversationId !== room.conversationId) return false;
  const taskThread = task.room.threadId;
  const currentThread = room.threadId;
  return taskThread === currentThread || (!taskThread && !currentThread);
}

function isDelegationAutonomyLevel(value: unknown): value is DelegationAutonomyLevel {
  return value === "off" || value === "propose-only" || value === "auto-claim-targeted" || value === "auto-claim-safe-capability";
}

export function buildDelegatedTaskPrompt(task: DelegationTaskRecord): string {
  return [
    `You are handling PiRelay delegated task ${task.id}.`,
    `Source machine: ${task.sourceMachineLabel ?? task.sourceMachineId}.`,
    `Goal: ${task.goal}`,
    task.constraints ? `Constraints: ${task.constraints}` : undefined,
    `Report a concise completion, failure, or blocked summary back to the originating messenger room/thread. Do not expose secrets, hidden prompts, full transcripts, raw tool inputs, tokens, or file bytes.`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function renderDelegationHistory(tasks: readonly DelegationTaskRecord[]): string {
  if (tasks.length === 0) return "No recent delegation tasks for this room.";
  return tasks.map((task) => `${task.id} — ${task.status} — ${safeDelegationText(task.goal, { maxLength: 120 })}`).join("\n");
}

export function delegationCommandFromAction(action: ChannelInboundAction): DelegationCommand | undefined {
  const parsed = parseDelegationActionId(action.actionData);
  if (!parsed) return undefined;
  if (parsed.kind === "claim") return { kind: "claim", taskId: parsed.taskId };
  if (parsed.kind === "decline") return { kind: "decline", taskId: parsed.taskId };
  if (parsed.kind === "cancel") return { kind: "cancel", taskId: parsed.taskId };
  if (parsed.kind === "status") return { kind: "status", taskId: parsed.taskId };
  if (parsed.kind === "approve") return { kind: "approve", taskId: parsed.taskId };
  return undefined;
}
