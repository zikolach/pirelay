import { describe, expect, it } from "vitest";
import {
  createDelegationTask,
  delegationEventKey,
  evaluateDelegationEligibility,
  expireDelegationTaskIfNeeded,
  generateDelegationTaskId,
  markDelegationTaskStaleAfterRestart,
  isDelegationDepthAllowed,
  isDelegationTaskExpired,
  isTrustedDelegationPeer,
  nextDelegationDepth,
  rememberDelegationEvent,
  renderDelegationTaskSummary,
  safeDelegationText,
  transitionDelegationTask,
  withRememberedDelegationEvent,
  type DelegationTaskRecord,
} from "../../extensions/relay/core/agent-delegation.js";

const now = "2026-05-15T12:00:00.000Z";
const later = "2026-05-15T12:00:05.000Z";
const room = { messenger: "discord" as const, instanceId: "default", conversationId: "guild:channel", threadId: "thread-1" };

function makeTask(overrides: Partial<Parameters<typeof createDelegationTask>[0]> = {}): DelegationTaskRecord {
  return createDelegationTask({
    sourceMachineId: "source",
    sourceMachineLabel: "Source machine",
    target: { kind: "machine", machineId: "target", displayName: "Target machine" },
    goal: "Run the focused test suite",
    room,
    expiryMs: 60_000,
    createdAt: now,
    ...overrides,
  });
}

describe("agent delegation domain helpers", () => {
  it("creates bounded safe task records", () => {
    const task = makeTask({
      id: "task-fixed",
      sourceMachineId: "source machine with spaces",
      goal: "Deploy with TOKEN=super-secret-value and then report\nback",
      constraints: "Keep it short",
      redactionPatterns: [String.raw`super-secret-value`],
    });

    expect(task).toMatchObject({
      id: "task-fixed",
      status: "proposed",
      sourceMachineId: "source-machine-with-spaces",
      target: { kind: "machine", machineId: "target" },
      constraints: "Keep it short",
      depth: 0,
      handledEventIds: [],
    });
    expect(task.goal).toContain("[redacted]");
    expect(task.goal).not.toContain("super-secret-value");
    expect(task.audit).toHaveLength(1);
    expect(task.audit[0]).toMatchObject({ kind: "created", taskId: "task-fixed" });
  });

  it("generates compact task ids", () => {
    const id = generateDelegationTaskId((size) => Buffer.alloc(size, 255));
    expect(id).toMatch(/^task-[a-z0-9_-]+$/);
  });

  it("transitions through approval, claim, start, and completion once", () => {
    const awaiting = makeTask({ status: "awaiting-approval" });
    const approved = transitionDelegationTask(awaiting, { kind: "approve", actor: { kind: "human", id: "u1" } }, later);
    expect(approved).toMatchObject({ ok: true, task: { status: "claimable" } });
    if (!approved.ok) throw new Error("approval failed");

    const claimed = transitionDelegationTask(approved.task, { kind: "claim", claimant: { machineId: "target", sessionKey: "s1", sessionLabel: "tests" } }, later);
    expect(claimed).toMatchObject({ ok: true, task: { status: "claimed", claimedBy: { machineId: "target", sessionKey: "s1" } } });
    if (!claimed.ok) throw new Error("claim failed");

    const duplicateClaim = transitionDelegationTask(claimed.task, { kind: "claim", claimant: { machineId: "other" } }, later);
    expect(duplicateClaim).toMatchObject({ ok: false, reason: "already-claimed" });

    const started = transitionDelegationTask(claimed.task, { kind: "start" }, later);
    expect(started).toMatchObject({ ok: true, task: { status: "running", startedAt: later } });
    if (!started.ok) throw new Error("start failed");

    const completed = transitionDelegationTask(started.task, { kind: "complete", summary: "All tests passed" }, later);
    expect(completed).toMatchObject({ ok: true, task: { status: "completed", completedAt: later, lastSafeSummary: "All tests passed" } });
    if (!completed.ok) throw new Error("completion failed");

    expect(transitionDelegationTask(completed.task, { kind: "cancel" })).toMatchObject({ ok: false, reason: "terminal" });
  });

  it("rejects invalid and expired transitions", () => {
    const task = makeTask({ expiryMs: 1 });
    expect(transitionDelegationTask(task, { kind: "start" }, now)).toMatchObject({ ok: false, reason: "invalid-transition" });
    expect(isDelegationTaskExpired(task, "2026-05-15T12:00:01.000Z")).toBe(true);
    expect(transitionDelegationTask(task, { kind: "claim", claimant: { machineId: "target" } }, "2026-05-15T12:00:01.000Z")).toMatchObject({ ok: false, reason: "expired" });
    expect(expireDelegationTaskIfNeeded(task, "2026-05-15T12:00:01.000Z")).toMatchObject({ status: "expired" });
  });

  it("marks in-flight tasks stale after broker restart without changing terminal tasks", () => {
    const task = makeTask();
    const claimed = transitionDelegationTask(task, { kind: "claim", claimant: { machineId: "target" } }, later);
    if (!claimed.ok) throw new Error("claim failed");
    expect(markDelegationTaskStaleAfterRestart(claimed.task, later)).toMatchObject({ status: "blocked" });
    const completed = transitionDelegationTask(claimed.task, { kind: "complete", summary: "done" }, later);
    if (!completed.ok) throw new Error("complete failed");
    expect(markDelegationTaskStaleAfterRestart(completed.task, later)).toBe(completed.task);
  });

  it("tracks delegation depth and duplicate events", () => {
    expect(nextDelegationDepth(undefined)).toBe(0);
    expect(nextDelegationDepth(0)).toBe(1);
    expect(isDelegationDepthAllowed(1, 1)).toBe(true);
    expect(isDelegationDepthAllowed(2, 1)).toBe(false);
    expect(delegationEventKey({ taskId: "task-1", action: "claim", eventId: "evt-1" })).toBe("task-1:claim:evt-1");

    const first = rememberDelegationEvent({ handledEventIds: [] }, "evt-1");
    expect(first).toEqual({ duplicate: false, handledEventIds: ["evt-1"] });
    expect(rememberDelegationEvent(first, "evt-1")).toEqual({ duplicate: true, handledEventIds: ["evt-1"] });

    const remembered = withRememberedDelegationEvent(makeTask(), "evt-2");
    expect(remembered.duplicate).toBe(false);
    expect(remembered.task.handledEventIds).toContain("evt-2");
  });

  it("formats safe summaries without leaking obvious secrets", () => {
    const text = safeDelegationText("Please use ghp_12345678901234567890 and password=hunter2 now", { maxLength: 40 });
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("hunter2");
    expect(text.length).toBeLessThanOrEqual(40);

    const summary = renderDelegationTaskSummary(makeTask({ constraints: "Do not push" }));
    expect(summary).toContain("Delegation");
    expect(summary).toContain("Status: proposed");
    expect(summary).toContain("Target machine (target)");
  });

  it("keeps peer trust separate from human allow-lists and checks room/target scope", () => {
    const trustedPeers = [{
      peerId: "bot-a",
      allowCreate: true,
      allowClaim: false,
      messenger: "discord" as const,
      instanceId: "default",
      conversationIds: ["guild:channel"],
      targetMachineIds: ["target"],
    }];

    expect(isTrustedDelegationPeer({ peerId: "bot-a", room, action: "create", target: { kind: "machine", machineId: "target" }, trustedPeers })).toMatchObject({ trusted: true });
    expect(isTrustedDelegationPeer({ peerId: "bot-a", room, action: "claim", target: { kind: "machine", machineId: "target" }, trustedPeers })).toEqual({ trusted: false, reason: "action-denied" });
    expect(isTrustedDelegationPeer({ peerId: "human-allow-listed", room, action: "create", trustedPeers })).toEqual({ trusted: false, reason: "missing-peer" });
    expect(isTrustedDelegationPeer({ peerId: "bot-a", room, action: "create", target: { kind: "machine", machineId: "other" }, trustedPeers })).toEqual({ trusted: false, reason: "target-denied" });
  });

  it("evaluates local target, capability, disabled, and loop-depth eligibility", () => {
    const targeted = makeTask();
    expect(evaluateDelegationEligibility({ task: targeted, localMachineId: "target", autonomy: "auto-claim-targeted" }, now)).toEqual({ eligible: true, reason: "targeted-machine", requiresHuman: false });
    expect(evaluateDelegationEligibility({ task: targeted, localMachineId: "other", autonomy: "auto-claim-targeted" }, now)).toEqual({ eligible: false, reason: "remote-target" });
    expect(evaluateDelegationEligibility({ task: targeted, localMachineId: "target", autonomy: "propose-only" }, now)).toEqual({ eligible: true, reason: "targeted-machine", requiresHuman: true });
    expect(evaluateDelegationEligibility({ task: targeted, localMachineId: "target", autonomy: "off" }, now)).toEqual({ eligible: false, reason: "disabled" });

    const capability = makeTask({ target: { kind: "capability", capability: "linux-tests" } });
    expect(evaluateDelegationEligibility({ task: capability, localMachineId: "target", localCapabilities: ["linux-tests"], autonomy: "auto-claim-safe-capability" }, now)).toEqual({ eligible: true, reason: "capability-match", requiresHuman: false });
    expect(evaluateDelegationEligibility({ task: capability, localMachineId: "target", localCapabilities: ["browser"], autonomy: "auto-claim-safe-capability" }, now)).toEqual({ eligible: false, reason: "capability-missing" });

    const child = makeTask({ parentDepth: 1 });
    expect(evaluateDelegationEligibility({ task: child, localMachineId: "target", autonomy: "auto-claim-targeted", maxDepth: 1 }, now)).toEqual({ eligible: false, reason: "depth-exceeded" });
  });
});
