import { describe, expect, it } from "vitest";
import { createDelegationTask } from "../../extensions/relay/core/agent-delegation.js";
import {
  delegationActionId,
  delegationTaskActionsForStatus,
  parseDelegationActionId,
  parseDelegationCommand,
  parseDelegationInvocation,
  platformDelegationActionSurface,
  renderDelegationTaskCard,
} from "../../extensions/relay/commands/delegation.js";

const task = createDelegationTask({
  id: "task-abc",
  sourceMachineId: "source",
  sourceMachineLabel: "Source",
  target: { kind: "machine", machineId: "target", displayName: "Target" },
  goal: "Run tests",
  constraints: "No deploys",
  room: { messenger: "discord", instanceId: "default", conversationId: "C1" },
  expiryMs: 60000,
  createdAt: "2026-05-15T00:00:00.000Z",
});

describe("delegation command parsing and rendering", () => {
  it("parses create commands for machine and capability targets", () => {
    expect(parseDelegationInvocation("/delegate @target Run tests now")).toEqual({
      kind: "create",
      target: { kind: "machine", machineId: "target" },
      goal: "Run tests now",
      rawGoal: "Run tests now",
      awaitApproval: false,
    });
    expect(parseDelegationInvocation("relay propose #linux-tests npm test")).toMatchObject({
      kind: "create",
      target: { kind: "capability", capability: "linux-tests" },
      awaitApproval: true,
    });
    expect(parseDelegationInvocation("/delegate #" )).toBeUndefined();
  });

  it("parses task lifecycle controls and history", () => {
    expect(parseDelegationCommand("task", "claim task-1")).toEqual({ kind: "claim", taskId: "task-1" });
    expect(parseDelegationCommand("task", "approve task-1")).toEqual({ kind: "approve", taskId: "task-1" });
    expect(parseDelegationCommand("task", "cancel task-1 no longer needed")).toEqual({ kind: "cancel", taskId: "task-1", reason: "no longer needed" });
    expect(parseDelegationCommand("decline", "task-1 busy")).toEqual({ kind: "decline", taskId: "task-1", reason: "busy" });
    expect(parseDelegationCommand("task", "task-1")).toEqual({ kind: "status", taskId: "task-1" });
    expect(parseDelegationCommand("tasks", "")).toEqual({ kind: "history" });
    expect(parseDelegationCommand("unknown", "task-1")).toBeUndefined();
  });

  it("creates stable action ids and parses them", () => {
    expect(delegationActionId("claim", "task-abc")).toBe("pirelay:delegation:claim:task-abc");
    expect(parseDelegationActionId("pirelay:delegation:cancel:task-abc")).toEqual({ kind: "cancel", taskId: "task-abc" });
    expect(parseDelegationActionId("pirelay:delegation:bogus:task-abc")).toBeUndefined();
  });

  it("renders task cards with bounded text fallbacks", () => {
    const card = renderDelegationTaskCard(task, { commandPrefix: "/relay task" });
    expect(card.text).toContain("Delegation task-abc");
    expect(card.text).toContain("Status: proposed");
    expect(card.text).toContain("/relay task claim task-abc");
    expect(card.actions.map((action) => action.kind)).toEqual(["claim", "decline", "cancel", "status"]);

    const terminal = { ...task, status: "completed" as const };
    expect(delegationTaskActionsForStatus(terminal).map((action) => action.kind)).toEqual(["status"]);
  });

  it("maps platform action fallbacks without changing task semantics", () => {
    expect(platformDelegationActionSurface("slack", task).textFallback).toContain("relay task claim task-abc");
    expect(platformDelegationActionSurface("discord", task).textFallback).toContain("relay task claim task-abc");
    expect(platformDelegationActionSurface("telegram", task).textFallback).toContain("/task claim task-abc");
  });
});
