import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPendingSessionHandoff,
  matchPendingSessionHandoffs,
  registerPendingSessionHandoff,
  removePendingSessionHandoff,
  takePendingSessionHandoff,
  type PendingSessionHandoff,
} from "../../extensions/relay/core/session-handoff.js";

function handoff(overrides: Partial<PendingSessionHandoff> = {}): PendingSessionHandoff {
  return createPendingSessionHandoff({
    oldSessionKey: "old",
    oldSessionId: "old-id",
    oldSessionLabel: "old",
    runtimeInstanceId: "runtime-1",
    machineId: "machine-1",
    workspaceRoot: "/workspace",
    reason: "local-new",
    bindings: [{ channel: "telegram", instanceId: "default", conversationId: "1", userId: "2", paused: false }],
    activeSelections: [],
    now: 1_000,
    ttlMs: 5_000,
    ...overrides,
  });
}

const replacement = { sessionKey: "new", runtimeInstanceId: "runtime-1", machineId: "machine-1", workspaceRoot: "/workspace" };

afterEach(() => {
  vi.useRealTimers();
});

describe("session handoff matching", () => {
  it("matches only the same runtime, machine, workspace, and live TTL", () => {
    expect(matchPendingSessionHandoffs([handoff()], replacement, 2_000)).toMatchObject({ kind: "matched", handoff: { oldSessionKey: "old" } });
    expect(matchPendingSessionHandoffs([handoff({ machineId: "other" })], replacement, 2_000)).toEqual({ kind: "none" });
    expect(matchPendingSessionHandoffs([handoff({ workspaceRoot: "/other" })], replacement, 2_000)).toEqual({ kind: "none" });
    expect(matchPendingSessionHandoffs([handoff({ explicitDisconnect: true })], replacement, 2_000)).toEqual({ kind: "none" });
    expect(matchPendingSessionHandoffs([handoff()], replacement, 6_000)).toEqual({ kind: "none" });
  });

  it("fails closed when multiple pending handoffs match", () => {
    expect(matchPendingSessionHandoffs([handoff(), handoff({ oldSessionKey: "old-2", oldSessionId: "old-2" })], replacement, 2_000)).toMatchObject({ kind: "ambiguous", candidates: [{ oldSessionKey: "old" }, { oldSessionKey: "old-2" }] });
  });

  it("runs expiry behavior when synchronous pruning wins the timer race", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const pending = handoff();
    const expired = vi.fn();
    registerPendingSessionHandoff(pending, expired);

    vi.setSystemTime(6_000);
    expect(takePendingSessionHandoff(replacement)).toEqual({ kind: "none" });
    await vi.runAllTicks();
    expect(expired).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledWith(pending);
    await vi.runAllTimersAsync();
    expect(expired).toHaveBeenCalledOnce();
  });

  it("takes a matched handoff once and expires bounded records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const pending = handoff();
    const expired = vi.fn();
    registerPendingSessionHandoff(pending, expired);
    expect(takePendingSessionHandoff(replacement, 2_000)).toMatchObject({ kind: "matched" });
    expect(takePendingSessionHandoff(replacement, 2_000)).toEqual({ kind: "none" });
    expect(expired).not.toHaveBeenCalled();

    const expiring = handoff({ oldSessionKey: "old-expiring", oldSessionId: "old-expiring" });
    registerPendingSessionHandoff(expiring, expired);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(expired).toHaveBeenCalledWith(expiring);
    removePendingSessionHandoff(expiring.id);
  });
});
