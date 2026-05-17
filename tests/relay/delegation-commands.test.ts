import { describe, expect, it } from "vitest";
import { createDelegationTask, type DelegationTaskRecord, type DelegationTaskStatus } from "../../extensions/relay/core/agent-delegation.js";
import {
  delegationActionId,
  delegationTaskActionButtons,
  delegationTaskActionsForStatus,
  parseDelegationActionId,
  parseDelegationCommand,
  parseDelegationInvocation,
  platformDelegationActionSurface,
  renderDelegationTaskCard,
  renderDelegationTaskPresentation,
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

  it("renders task cards with structured presentation and bounded text fallbacks", () => {
    const card = renderDelegationTaskCard(task, { commandPrefix: "/relay task" });
    expect(card.text).toContain("Delegation task-abc");
    expect(card.text).toContain("Status: Proposed");
    expect(card.text).toContain("Fallback commands:");
    expect(card.text).toContain("/relay task claim task-abc");
    expect(card.presentation.fields).toContainEqual({ label: "Target", value: "Target" });
    expect(card.fallbackText).toContain("/relay task claim task-abc");
    expect(card.accessibilityText).toBe(card.text);
    expect(card.actions.map((action) => action.kind)).toEqual(["claim", "decline", "cancel", "status"]);

    const terminal = { ...task, status: "completed" as const };
    expect(delegationTaskActionsForStatus(terminal).map((action) => action.kind)).toEqual(["status"]);
  });

  it("maps delegation status presentation across task lifecycle states", () => {
    const cases: Array<[DelegationTaskStatus, string, string]> = [
      ["claimable", "Claimable", "claim"],
      ["awaiting-approval", "Awaiting approval", "approve"],
      ["running", "Running", "cancel"],
      ["completed", "Completed", "status"],
      ["blocked", "Blocked", "status"],
      ["failed", "Failed", "status"],
      ["cancelled", "Cancelled", "status"],
      ["declined", "Declined", "status"],
      ["expired", "Expired", "status"],
    ];

    for (const [status, label, firstAction] of cases) {
      const current: DelegationTaskRecord = {
        ...task,
        status,
        claimedBy: status === "running" ? { machineId: "target", sessionLabel: "Docs", claimedAt: "2026-05-15T00:00:01.000Z" } : undefined,
        lastSafeSummary: status === "completed" ? "All done." : undefined,
      };
      const presentation = renderDelegationTaskPresentation(current, { commandPrefix: "relay task" });
      expect(presentation.status.label).toBe(label);
      expect(presentation.actions.at(0)?.kind).toBe(firstAction);
      if (status === "completed") expect(presentation.latest).toEqual({ label: "Result", value: "All done." });
      if (status === "running") expect(presentation.fields).toContainEqual({ label: "Claimed by", value: "target/Docs" });
    }
  });

  it("maps delegation task actions to channel buttons", () => {
    expect(delegationTaskActionButtons(delegationTaskActionsForStatus(task))).toEqual([[{
      label: "Claim",
      actionData: "pirelay:delegation:claim:task-abc",
      style: "primary",
    }, {
      label: "Decline",
      actionData: "pirelay:delegation:decline:task-abc",
      style: "danger",
    }, {
      label: "Cancel",
      actionData: "pirelay:delegation:cancel:task-abc",
      style: "danger",
    }, {
      label: "Status",
      actionData: "pirelay:delegation:status:task-abc",
      style: "default",
    }]]);
  });

  it("maps platform action fallbacks without changing task semantics", () => {
    expect(platformDelegationActionSurface("slack", task).textFallback).toContain("relay task claim task-abc");
    expect(platformDelegationActionSurface("discord", task).textFallback).toContain("relay task claim task-abc");
    expect(platformDelegationActionSurface("telegram", task).textFallback).toContain("/task claim task-abc");
  });
});
