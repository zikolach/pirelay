import { describe, expect, it } from "vitest";
import { createDelegationTask } from "../../extensions/relay/core/agent-delegation.js";
import {
  buildDelegatedTaskPrompt,
  delegationCommandFromAction,
  delegationRoomFromMessage,
  evaluateDelegationIngress,
  isPeerBotIdentity,
  isSelfAuthoredDelegationEvent,
  resolveDelegationRuntimePolicy,
} from "../../extensions/relay/core/agent-delegation-runtime.js";
import type { ChannelInboundAction, ChannelInboundMessage } from "../../extensions/relay/core/channel-adapter.js";
import type { SessionRoute } from "../../extensions/relay/core/types.js";

const message: ChannelInboundMessage = {
  kind: "message",
  channel: "discord",
  updateId: "evt-1",
  messageId: "m1",
  text: "/delegate target run tests",
  attachments: [],
  conversation: { channel: "discord", id: "C1", kind: "group" },
  sender: { channel: "discord", userId: "U1", displayName: "Owner" },
};

const botMessage: ChannelInboundMessage = {
  ...message,
  sender: { channel: "discord", userId: "bot-a", displayName: "Bot A", metadata: { isBot: true } },
};

const room = delegationRoomFromMessage(message, "default");

function route(overrides: Partial<SessionRoute> = {}): SessionRoute {
  return {
    sessionKey: "s1",
    sessionId: "s1",
    sessionLabel: "Tests",
    notification: {},
    actions: {} as never,
    ...overrides,
  };
}

describe("agent delegation runtime helpers", () => {
  it("resolves disabled-by-default policy and fails closed for invalid autonomy", () => {
    expect(resolveDelegationRuntimePolicy(undefined)).toMatchObject({ enabled: false, autonomy: "off", trustedPeers: [] });
    expect(resolveDelegationRuntimePolicy({ enabled: true, localCapabilities: ["tests"] }, ["docs"])).toMatchObject({ enabled: true, autonomy: "propose-only", localCapabilities: ["docs", "tests"] });
    expect(resolveDelegationRuntimePolicy({ enabled: true, autonomy: "free-for-all" as never })).toMatchObject({ enabled: false, autonomy: "off" });
  });

  it("ignores self-authored and ordinary non-delegation events", async () => {
    expect(isSelfAuthoredDelegationEvent({ channel: "slack", userId: "B1" }, "B1")).toBe(true);
    expect(await evaluateDelegationIngress({
      command: undefined,
      message,
      policy: { enabled: true },
      room,
      localMachineId: "target",
      isAuthorizedHuman: true,
    })).toEqual({ kind: "ignore", reason: "not-delegation" });
    expect(await evaluateDelegationIngress({
      command: { kind: "history" },
      message: { ...message, sender: { channel: "discord", userId: "local-bot" } },
      policy: { enabled: true },
      room,
      localMachineId: "target",
      localBotUserId: "local-bot",
      isAuthorizedHuman: true,
    })).toEqual({ kind: "ignore", reason: "self-authored" });
  });

  it("creates task cards for authorized humans", async () => {
    const decision = await evaluateDelegationIngress({
      command: { kind: "create", target: { kind: "machine", machineId: "target" }, goal: "run tests", rawGoal: "run tests", awaitApproval: false },
      message,
      policy: { enabled: true, requireHumanApproval: false, taskExpiryMs: 60000 },
      room,
      localMachineId: "source",
      localMachineLabel: "Source",
      isAuthorizedHuman: true,
      now: "2026-05-15T00:00:00.000Z",
    });
    expect(decision).toMatchObject({ kind: "render-task", task: { status: "claimable", goal: "run tests" } });
  });

  it("keeps peer bot trust action-scoped and rejects untrusted bot-authored tasks", async () => {
    expect(isPeerBotIdentity(botMessage.sender)).toBe(true);
    expect(await evaluateDelegationIngress({
      command: { kind: "create", target: { kind: "machine", machineId: "target" }, goal: "run tests", rawGoal: "run tests", awaitApproval: false },
      message: botMessage,
      policy: { enabled: true, trustedPeers: [] },
      room,
      localMachineId: "target",
      isAuthorizedHuman: false,
    })).toMatchObject({ kind: "ignore", reason: "untrusted-peer" });

    const trusted = await evaluateDelegationIngress({
      command: { kind: "create", target: { kind: "machine", machineId: "target" }, goal: "run tests", rawGoal: "run tests", awaitApproval: false },
      message: botMessage,
      policy: { enabled: true, trustedPeers: [{ peerId: "bot-a", allowCreate: true, targetMachineIds: ["target"] }] },
      room,
      localMachineId: "target",
      isAuthorizedHuman: false,
    });
    expect(trusted).toMatchObject({ kind: "render-task", task: { status: "awaiting-approval", sourceMachineId: "bot-a" } });

    const task = createDelegationTask({ id: "task-peer-control", sourceMachineId: "bot-a", target: { kind: "machine", machineId: "target" }, goal: "run tests", room, expiryMs: 60000, status: "claimable" });
    expect(await evaluateDelegationIngress({
      command: { kind: "cancel", taskId: task.id },
      message: botMessage,
      policy: { enabled: true, trustedPeers: [{ peerId: "bot-a", allowCreate: true, targetMachineIds: ["target"] }] },
      room,
      localMachineId: "target",
      isAuthorizedHuman: false,
      lookup: { get: async () => task, list: async () => [task] },
    })).toMatchObject({ kind: "ignore", reason: "untrusted-peer" });
  });

  it("approves awaiting-approval tasks without leaking across rooms", async () => {
    const task = createDelegationTask({
      id: "task-approve",
      sourceMachineId: "bot-a",
      target: { kind: "machine", machineId: "target" },
      goal: "run tests",
      room,
      expiryMs: 60000,
      status: "awaiting-approval",
      createdAt: "2026-05-15T00:00:00.000Z",
    });
    const lookup = { get: async () => task, list: async () => [task] };
    expect(await evaluateDelegationIngress({ command: { kind: "approve", taskId: "task-approve" }, message, policy: { enabled: true }, room, localMachineId: "target", isAuthorizedHuman: true, lookup, now: "2026-05-15T00:00:01.000Z" }))
      .toMatchObject({ kind: "approve", task: { status: "claimable" } });
    expect(await evaluateDelegationIngress({ command: { kind: "status", taskId: "task-approve" }, message, policy: { enabled: true }, room: { ...room, conversationId: "C2" }, localMachineId: "target", isAuthorizedHuman: true, lookup }))
      .toMatchObject({ kind: "reject", message: expect.stringContaining("not visible") });
  });

  it("claims eligible local tasks and builds bounded task prompts", async () => {
    const task = createDelegationTask({
      id: "task-1",
      sourceMachineId: "bot-a",
      target: { kind: "machine", machineId: "target" },
      goal: "run tests",
      room,
      expiryMs: 60000,
      status: "claimable",
      createdAt: "2026-05-15T00:00:00.000Z",
    });
    const decision = await evaluateDelegationIngress({
      command: { kind: "claim", taskId: "task-1" },
      message,
      policy: { enabled: true, autonomy: "auto-claim-targeted", requireHumanApproval: false },
      room,
      localMachineId: "target",
      localBotUserId: "local-bot",
      isAuthorizedHuman: true,
      eligibleRoutes: [route()],
      lookup: { get: async () => task, list: async () => [task] },
      now: "2026-05-15T00:00:01.000Z",
    });
    expect(decision).toMatchObject({ kind: "claim", requiresHuman: false, task: { status: "claimed", claimedBy: { sessionKey: "s1" } } });
    if (decision.kind !== "claim") throw new Error("not claimed");
    expect(decision.prompt).toContain("delegated task task-1");
    expect(buildDelegatedTaskPrompt(task)).not.toContain("TOKEN=");

    const noRouteDecision = await evaluateDelegationIngress({
      command: { kind: "claim", taskId: "task-1" },
      message,
      policy: { enabled: true, autonomy: "auto-claim-targeted", requireHumanApproval: false },
      room,
      localMachineId: "target",
      isAuthorizedHuman: true,
      eligibleRoutes: [],
      lookup: { get: async () => task, list: async () => [task] },
      now: "2026-05-15T00:00:01.000Z",
    });
    expect(noRouteDecision).toMatchObject({ kind: "ignore", reason: "not-eligible", message: expect.stringContaining("ambiguous-session") });

    const peerDecision = await evaluateDelegationIngress({
      command: { kind: "claim", taskId: "task-1" },
      message: botMessage,
      policy: { enabled: true, autonomy: "propose-only", trustedPeers: [{ peerId: "bot-a", allowClaim: true, targetMachineIds: ["target"] }] },
      room,
      localMachineId: "target",
      isAuthorizedHuman: false,
      eligibleRoutes: [route()],
      lookup: { get: async () => task, list: async () => [task] },
      now: "2026-05-15T00:00:01.000Z",
    });
    expect(peerDecision).toMatchObject({ kind: "claim", requiresHuman: true, task: { status: "claimable" } });
    if (peerDecision.kind !== "claim") throw new Error("not claim");
    expect(peerDecision.task).not.toHaveProperty("claimedBy");
  });

  it("renders status/history and parses platform action ids", async () => {
    const task = createDelegationTask({ id: "task-1", sourceMachineId: "bot-a", target: { kind: "machine", machineId: "target" }, goal: "run tests", room, expiryMs: 60000 });
    const lookup = { get: async () => task, list: async () => [task] };
    expect(await evaluateDelegationIngress({ command: { kind: "status", taskId: "task-1" }, message, policy: { enabled: true }, room, localMachineId: "target", isAuthorizedHuman: true, lookup })).toMatchObject({ kind: "status" });
    expect(await evaluateDelegationIngress({ command: { kind: "history" }, message, policy: { enabled: true }, room, localMachineId: "target", isAuthorizedHuman: true, lookup })).toMatchObject({ kind: "history", text: expect.stringContaining("task-1") });

    const action: ChannelInboundAction = { kind: "action", channel: "discord", updateId: "a1", actionId: "a1", actionData: "pirelay:delegation:claim:task-1", conversation: message.conversation, sender: message.sender };
    expect(delegationCommandFromAction(action)).toEqual({ kind: "claim", taskId: "task-1" });
    expect(delegationCommandFromAction({ ...action, actionData: "pirelay:delegation:approve:task-1" })).toEqual({ kind: "approve", taskId: "task-1" });
  });

  it("preserves Slack thread ids in room refs", () => {
    expect(delegationRoomFromMessage({ ...message, metadata: { threadTs: "1700.1" } }, "default")).toMatchObject({ threadId: "1700.1" });
  });
});
