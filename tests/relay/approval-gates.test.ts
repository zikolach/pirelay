import { describe, expect, it } from "vitest";
import {
  approvalActionData,
  approvalButtons,
  classifyApprovalOperation,
  createApprovalGrant,
  createApprovalRequest,
  grantMatchesOperation,
  parseApprovalActionData,
  redactApprovalText,
  renderApprovalRequest,
  resolveApprovalGateConfig,
  summarizeToolCall,
} from "../../extensions/relay/core/approval-gates.js";
import type { RelayFileDeliveryRequester } from "../../extensions/relay/core/requester-file-delivery.js";
import type { SessionRoute } from "../../extensions/relay/core/types.js";

const requester: RelayFileDeliveryRequester = {
  channel: "slack",
  instanceId: "default",
  conversationId: "C1",
  userId: "U1",
  sessionKey: "s1:file",
  safeLabel: "Slack U1",
  createdAt: 1,
};

const route: SessionRoute = {
  sessionKey: "s1:file",
  sessionId: "s1",
  sessionFile: "file",
  sessionLabel: "Docs",
  notification: {},
  actions: {} as never,
};

describe("approval gates", () => {
  it("preserves existing behavior when disabled", () => {
    const config = resolveApprovalGateConfig(undefined);
    expect(config.enabled).toBe(false);
    expect(classifyApprovalOperation({ toolName: "bash", input: { command: "git push" } }, config)).toBeUndefined();
  });

  it("classifies sensitive tool calls by category and rule", () => {
    const config = resolveApprovalGateConfig({ enabled: true, rules: [{ id: "git", categories: ["git-remote"] }] });
    const operation = classifyApprovalOperation({ toolName: "bash", toolCallId: "tc1", input: { command: "git push origin main" } }, config);
    expect(operation).toMatchObject({ operationId: "tc1", toolName: "bash", category: "git-remote", matchedRuleId: "git" });
    expect(operation?.summary).toContain("Run shell command");
    expect(operation?.matcherFingerprint).toContain("git-remote:bash:git");
  });

  it("matches write/edit path patterns and custom text patterns only when constraints match", () => {
    const config = resolveApprovalGateConfig({ enabled: true, rules: [{ id: "protected", tools: ["write", "edit"], pathPatterns: ["package.json"] }, { id: "custom", tools: ["deploy"], textPatterns: ["prod"] }] });
    expect(classifyApprovalOperation({ toolName: "write", input: { path: "package.json", content: "{}" } }, config)?.category).toBe("file-write");
    expect(classifyApprovalOperation({ toolName: "write", input: { path: "README.md", content: "{}" } }, config)).toBeUndefined();
    expect(classifyApprovalOperation({ toolName: "deploy", input: { target: "prod" } }, config)?.category).toBe("custom");
    expect(classifyApprovalOperation({ toolName: "deploy", input: { target: "dev" } }, config)).toBeUndefined();
  });

  it("redacts and bounds approval summaries", () => {
    expect(redactApprovalText("TOKEN=abc123 Authorization: Bearer secret-value")).toContain("[redacted]");
    const summary = summarizeToolCall("bash", { command: `npm publish --token ${"x".repeat(900)}` });
    expect(summary.length).toBeLessThanOrEqual(700);
    expect(summary).not.toContain("--token x");
  });

  it("renders safe request text and buttons with grant options", () => {
    const config = resolveApprovalGateConfig({ enabled: true, rules: [{ categories: ["publish"] }], allowRemotePersistentGrants: true });
    const operation = classifyApprovalOperation({ toolName: "bash", input: { command: "npm publish" } }, config)!;
    const request = createApprovalRequest({ route, requester, operation, now: 0, timeoutMs: config.timeoutMs });
    expect(renderApprovalRequest(request, config)).toContain("Approval required");
    expect(renderApprovalRequest(request, config)).not.toContain("npm-token");
    expect(approvalButtons(request, config).flat().map((button) => button.label)).toEqual(["Approve once", "Approve for session", "Approve persistent", "Deny"]);
    const actionData = approvalActionData("approve-persistent", request.approvalId);
    expect(actionData.length).toBeLessThanOrEqual(64);
    expect(parseApprovalActionData(actionData)).toEqual({ decision: "approve-persistent", approvalId: request.approvalId });
    expect(parseApprovalActionData(`pirelay:approval:approve-once:${request.approvalId}`)).toEqual({ decision: "approve-once", approvalId: request.approvalId });
  });

  it("matches session grants only for same requester, session, fingerprint, and expiry", () => {
    const config = resolveApprovalGateConfig({ enabled: true, rules: [{ categories: ["destructive"] }] });
    const operation = classifyApprovalOperation({ toolName: "bash", input: { command: "rm -rf dist" } }, config)!;
    const request = createApprovalRequest({ route, requester, operation, now: 0, timeoutMs: config.timeoutMs });
    const grant = createApprovalGrant({ scope: "session", record: request, createdBy: "U1", now: 0, ttlMs: 60_000 });
    expect(grantMatchesOperation(grant, { route, requester, operation, now: 1 })).toBe(true);
    expect(grantMatchesOperation(grant, { route: { ...route, sessionKey: "other" }, requester, operation, now: 1 })).toBe(false);
    expect(grantMatchesOperation(grant, { route, requester, operation, now: 60_001 })).toBe(false);
    expect(grantMatchesOperation({ ...grant, revokedAt: "1970-01-01T00:00:01.000Z" }, { route, requester, operation, now: 1 })).toBe(false);
  });
});
