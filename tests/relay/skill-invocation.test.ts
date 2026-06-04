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

  it("keeps Telegram and broker skill list guidance on slash skill commands by default", () => {
    const skills = filterRemoteSkills(commands, resolveRemoteSkillConfig({ enabled: true, allow: ["github"] }));
    const message = formatSkillList(skills);
    expect(message).toContain("Use /skill <name> <input>, or /skill <name> to send input as your next message.");
    expect(message).not.toContain("relay skill <name>");
    expect(message).not.toContain("relay skills");
  });

  it("formats Discord and Slack skill list guidance with relay-prefixed commands", () => {
    const skills = filterRemoteSkills(commands, resolveRemoteSkillConfig({ enabled: true, allow: ["github"] }));
    const message = formatSkillList(skills, { commandStyle: "relay-prefix" });
    expect(message).toContain("Use relay skill <name> <input>, or relay skill <name> to send input as your next message.");
    expect(message).toContain("Use relay skills to list available skills.");
    expect(message).not.toContain("/skill");
  });


  it("bounds only skill listing, not skill invocation resolution", () => {
    const manyCommands = Array.from({ length: 55 }, (_, index) => ({
      name: `skill-${String(index).padStart(2, "0")}`,
      sourceInfo: { scope: "project" },
    } satisfies SkillCommandMetadata));
    const config = resolveRemoteSkillConfig({ enabled: true, maxList: 10 });
    expect(filterRemoteSkills(manyCommands, config)).toHaveLength(10);
    expect(resolveRemoteSkill("skill-54", manyCommands, config)).toMatchObject({ kind: "ok", skill: { name: "skill-54" } });
  });

  it("resolves exact, ambiguous, filtered, and confirmation-required skills", () => {
    const config = resolveRemoteSkillConfig({ enabled: true, allow: ["github", "summarize"], requireConfirmation: ["github"] });
    expect(resolveRemoteSkill("git", commands, config)).toMatchObject({ kind: "confirmation-required" });
    expect(resolveRemoteSkill("sum", commands, config)).toMatchObject({ kind: "ok", skill: { name: "summarize" } });
    expect(resolveRemoteSkill("apple-mail", commands, config)).toMatchObject({ kind: "not-found" });
    expect(resolveRemoteSkill("", commands, config)).toMatchObject({ kind: "not-found" });
  });

  it("does not echo invalid raw skill names in chat-formatted errors", () => {
    const config = resolveRemoteSkillConfig({ enabled: true, allow: ["github", "summarize"] });
    for (const rawName of ["", "`github`", "git\nhub"]) {
      const result = resolveRemoteSkill(rawName, commands, config);
      expect(result.kind).toBe("not-found");
      if (result.kind !== "not-found") throw new Error(`Expected not-found for ${rawName}`);
      expect(result.message).toBe("Skill name is invalid or unavailable for remote invocation.");
      if (rawName) expect(result.message).not.toContain(rawName);
      expect(result.message).not.toContain("`");
      expect(result.message).not.toContain("\n");
    }
  });

  it("quotes only normalized validated skill names in not-found messages", () => {
    const config = resolveRemoteSkillConfig({ enabled: true, allow: ["summarize"] });
    expect(resolveRemoteSkill(" GitHub ", commands, config)).toMatchObject({
      kind: "not-found",
      message: "Skill `github` is not available for remote invocation.",
    });
  });

  it("builds safe skill invocation prompt, preserves requester context, and uses route delivery", async () => {
    const session = route();
    const requester = {
      channel: "telegram" as const,
      instanceId: "default",
      conversationId: "123",
      userId: "456",
      sessionKey: session.sessionKey,
      safeLabel: "Telegram tester",
      createdAt: Date.now(),
    };
    const outcome = await invokeRemoteSkill(session, commands, resolveRemoteSkillConfig({ enabled: true, allow: ["summarize"] }), { name: "summarize", input: "https://example.com", requester });
    expect(outcome).toMatchObject({ kind: "success", result: { skill: { name: "summarize" } } });
    expect(session.remoteRequester).toEqual(requester);
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
