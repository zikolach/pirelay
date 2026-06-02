import { describe, expect, it, vi } from "vitest";
import {
  buildSkillInvocationPrompt,
  filterRemoteSkills,
  formatSkillList,
  invokeRemoteSkill,
  listRemoteSkills,
  pendingSkillInputKey,
  resolveRemoteSkill,
  resolveRemoteSkillConfig,
  type SkillCommandMetadata,
} from "../../extensions/relay/core/skill-invocation.js";
import type { SessionRoute } from "../../extensions/relay/core/types.js";

const commands: SkillCommandMetadata[] = [
  { name: "github", description: "Use GitHub safely", sourceInfo: { scope: "user" } },
  { name: "summarize", description: "Summarize long documents ".repeat(20), sourceInfo: { scope: "project" } },
  { name: "apple-mail", description: "Read mail", sourceInfo: { scope: "user" } },
  { name: "bad name", description: "invalid", sourceInfo: { scope: "project" } },
];

function route(overrides: Partial<SessionRoute> = {}): SessionRoute {
  const sendUserMessage = vi.fn();
  return {
    sessionKey: "session:/tmp/session.jsonl",
    sessionId: "session",
    sessionLabel: "session",
    notification: {},
    actions: {
      context: {} as never,
      isIdle: () => true,
      getModel: () => undefined,
      sendUserMessage,
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "missing" }),
      appendAudit: () => undefined,
      persistBinding: () => undefined,
      promptLocalConfirmation: async () => true,
      abort: () => undefined,
      compact: async () => undefined,
    },
    ...overrides,
  } as SessionRoute;
}

describe("remote skill invocation helpers", () => {
  it("is disabled by default and bounds configured values", () => {
    expect(resolveRemoteSkillConfig(undefined)).toMatchObject({ enabled: false, maxList: 20, pendingInputExpiryMs: 120_000 });
    expect(resolveRemoteSkillConfig({ enabled: true, maxList: 999, pendingInputExpiryMs: 1 })).toMatchObject({ enabled: true, maxList: 50, pendingInputExpiryMs: 10_000 });
  });

  it("filters skills by allowlist, denylist, source, and safe names", () => {
    const config = resolveRemoteSkillConfig({ enabled: true, allow: ["github", "summarize", "bad name"], deny: ["apple-mail"], sources: ["project", "user"] });
    expect(filterRemoteSkills(commands, config).map((skill) => skill.name)).toEqual(["github", "summarize"]);
  });

  it("formats disabled, empty, and bounded skill list responses", () => {
    expect(listRemoteSkills(commands, resolveRemoteSkillConfig(undefined))).toMatchObject({ kind: "disabled" });
    expect(listRemoteSkills(commands, resolveRemoteSkillConfig({ enabled: true, allow: ["missing"] }))).toMatchObject({ kind: "empty" });
    const result = listRemoteSkills(commands, resolveRemoteSkillConfig({ enabled: true, allow: ["summarize"] }));
    expect(result.kind).toBe("ok");
    expect(result.message).toContain("Available remote skills");
    expect(result.message.length).toBeLessThan(360);
  });

  it("resolves exact, ambiguous, filtered, and confirmation-required skills", () => {
    const config = resolveRemoteSkillConfig({ enabled: true, allow: ["github", "summarize"], requireConfirmation: ["github"] });
    expect(resolveRemoteSkill("git", commands, config)).toMatchObject({ kind: "confirmation-required" });
    expect(resolveRemoteSkill("sum", commands, config)).toMatchObject({ kind: "ok", skill: { name: "summarize" } });
    expect(resolveRemoteSkill("apple-mail", commands, config)).toMatchObject({ kind: "not-found" });
    expect(resolveRemoteSkill("", commands, config)).toMatchObject({ kind: "not-found" });
  });

  it("builds safe skill invocation prompt and uses route delivery", async () => {
    const session = route();
    const outcome = await invokeRemoteSkill(session, commands, resolveRemoteSkillConfig({ enabled: true, allow: ["summarize"] }), { name: "summarize", input: "https://example.com" });
    expect(outcome).toMatchObject({ kind: "success", result: { skill: { name: "summarize" } } });
    expect(session.actions.sendUserMessage).toHaveBeenCalledWith("Use the local Pi skill /skill:summarize with this input:\n\nhttps://example.com", undefined);
    expect(buildSkillInvocationPrompt("github", "")).toBe("Use the local Pi skill /skill:github.");
  });

  it("does not deliver when route is paused or unavailable", async () => {
    const paused = route({ binding: { paused: true } as never });
    const pausedOutcome = await invokeRemoteSkill(paused, commands, resolveRemoteSkillConfig({ enabled: true, allow: ["summarize"] }), { name: "summarize", input: "input" });
    expect(pausedOutcome.kind).toBe("unavailable");
    expect(paused.actions.sendUserMessage).not.toHaveBeenCalled();
  });

  it("scopes pending skill input keys", () => {
    expect(pendingSkillInputKey({ channel: "telegram", conversationId: "c1", userId: "u1", sessionKey: "s1" }))
      .toBe("telegram:default:c1:u1:s1");
    expect(pendingSkillInputKey({ channel: "discord", instanceId: "bot-a", conversationId: "c1", userId: "u1", sessionKey: "s1" }))
      .toBe("discord:bot-a:c1:u1:s1");
  });
});
