import { describe, expect, it } from "vitest";
import {
  createDelegationApprovalGrant,
  delegationApprovalGrantMatches,
  delegationApprovalOptions,
  formatDelegationApprovalSummary,
} from "../../extensions/relay/core/agent-delegation-approval.js";

const operation = {
  taskId: "task-1",
  sessionKey: "session-1:memory",
  requesterKey: "discord:default:C1:U1",
  bindingKey: "discord:default:session-1",
  matcherFingerprint: "tool:read-file",
  toolName: "read",
  category: "filesystem",
  expiresAt: "2026-05-15T00:10:00.000Z",
};

describe("delegation approval helpers", () => {
  it("creates task-scoped grants that do not escape the task", () => {
    const grant = createDelegationApprovalGrant({ ...operation, scope: "task", now: "2026-05-15T00:00:00.000Z" });
    expect(grant).toMatchObject({ scope: "task", taskId: "task-1", sessionKey: "session-1:memory" });
    expect(delegationApprovalGrantMatches(grant, operation, "2026-05-15T00:01:00.000Z")).toBe(true);
    expect(delegationApprovalGrantMatches(grant, { ...operation, taskId: "task-2" }, "2026-05-15T00:01:00.000Z")).toBe(false);
    expect(delegationApprovalGrantMatches(grant, { ...operation, sessionKey: "other" }, "2026-05-15T00:01:00.000Z")).toBe(false);
    expect(delegationApprovalGrantMatches(grant, { ...operation, bindingKey: "discord:default:other" }, "2026-05-15T00:01:00.000Z")).toBe(false);
    expect(delegationApprovalGrantMatches({ ...grant, revokedAt: "2026-05-15T00:02:00.000Z" }, operation, "2026-05-15T00:03:00.000Z")).toBe(false);
    expect(delegationApprovalGrantMatches(grant, operation, "2026-05-15T00:11:00.000Z")).toBe(false);
  });

  it("keeps session grants narrower than persistent grants and requires task ids for task scope", () => {
    expect(() => createDelegationApprovalGrant({ ...operation, taskId: undefined, scope: "task" })).toThrow(/task id/);
    const sessionGrant = createDelegationApprovalGrant({ ...operation, scope: "session" });
    expect(sessionGrant.taskId).toBeUndefined();
    expect(delegationApprovalGrantMatches(sessionGrant, { ...operation, taskId: "task-2" }, "2026-05-15T00:01:00.000Z")).toBe(true);
    expect(delegationApprovalGrantMatches(sessionGrant, { ...operation, matcherFingerprint: "tool:write" }, "2026-05-15T00:01:00.000Z")).toBe(false);
  });

  it("renders approval options and safe summaries", () => {
    expect(delegationApprovalOptions({ taskId: "task-1", allowSessionGrant: true }).map((option) => option.id)).toEqual(["approve-once", "approve-for-task", "approve-for-session", "deny"]);
    expect(delegationApprovalOptions().map((option) => option.id)).toEqual(["approve-once", "deny"]);
    const summary = formatDelegationApprovalSummary({ ...operation, toolName: "TOKEN=secret-value" });
    expect(summary).toContain("Delegated task: task-1");
    expect(summary).toContain("[redacted]");
    expect(summary).not.toContain("secret-value");
  });
});
