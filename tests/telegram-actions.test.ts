import { describe, expect, it } from "vitest";
import { extractStructuredAnswerMetadata } from "../extensions/relay/core/guided-answer.js";
import {
  buildAnswerActionKeyboard,
  buildAnswerAmbiguityCallbackData,
  buildAnswerAmbiguityKeyboard,
  buildAnswerCustomCallbackData,
  buildAnswerOptionCallbackData,
  buildFullChatCallbackData,
  buildFullMarkdownCallbackData,
  buildFullOutputKeyboard,
  buildLatestImagesCallbackData,
  buildLatestImagesKeyboard,
  buildSkillListKeyboard,
  buildSkillSelectCallbackData,
  buildSessionDashboardKeyboard,
  buildSessionListDashboardKeyboard,
  parseTelegramActionCallbackData,
  sessionDashboardRef,
  shouldOfferFullOutputActions,
} from "../extensions/relay/adapters/telegram/actions.js";

describe("telegram action callbacks", () => {
  it("round-trips compact callback data", () => {
    expect(parseTelegramActionCallbackData(buildAnswerOptionCallbackData("turn-1", "A"))).toEqual({
      kind: "answer-option",
      turnId: "turn-1",
      optionId: "A",
    });
    expect(parseTelegramActionCallbackData(buildAnswerCustomCallbackData("turn-1"))).toEqual({
      kind: "answer-custom",
      turnId: "turn-1",
    });
    expect(parseTelegramActionCallbackData(buildAnswerAmbiguityCallbackData("turn-1", "tok", "prompt"))).toEqual({
      kind: "answer-ambiguity",
      turnId: "turn-1",
      token: "tok",
      resolution: "prompt",
    });
    expect(parseTelegramActionCallbackData(buildFullChatCallbackData("turn-1"))).toEqual({
      kind: "full-chat",
      turnId: "turn-1",
    });
    expect(parseTelegramActionCallbackData(buildFullMarkdownCallbackData("turn-1"))).toEqual({
      kind: "full-markdown",
      turnId: "turn-1",
    });
    expect(parseTelegramActionCallbackData(buildLatestImagesCallbackData("turn-1"))).toEqual({
      kind: "latest-images",
      turnId: "turn-1",
    });
    expect(parseTelegramActionCallbackData(buildSkillSelectCallbackData("github"))).toEqual({
      kind: "skill-select",
      skillName: "github",
    });
    expect(parseTelegramActionCallbackData("ans:turn-1:wat")).toBeUndefined();
  });

  it("builds answer and full-output inline keyboards", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Next options:",
      "A. Sync specs now",
      "B. Archive without syncing",
    ].join("\n"), { turnId: "abc123" });

    expect(metadata).toBeDefined();
    expect(buildAnswerActionKeyboard(metadata!)).toEqual([
      [{ text: "A. Sync specs now", callbackData: "ans:abc123:opt:A" }],
      [{ text: "B. Archive without syncing", callbackData: "ans:abc123:opt:B" }],
      [{ text: "✍️ Custom answer", callbackData: "ans:abc123:custom" }],
      [
        { text: "📄 Show in chat", callbackData: "full:abc123:chat" },
        { text: "⬇️ Download .md", callbackData: "full:abc123:md" },
      ],
    ]);
    expect(buildFullOutputKeyboard("abc123")).toEqual([[{"callbackData":"full:abc123:chat","text":"📄 Show in chat"},{"callbackData":"full:abc123:md","text":"⬇️ Download .md"}]]);
    expect(buildLatestImagesKeyboard("abc123", 2)).toEqual([[{ text: "🖼 Download 2 images", callbackData: "imgs:abc123" }]]);
    expect(buildSkillListKeyboard([{ name: "github" }, { name: "summarize" }])).toEqual([
      [{ text: "github", callbackData: "skill:github" }],
      [{ text: "summarize", callbackData: "skill:summarize" }],
    ]);
    const buttonSafeName = "a".repeat(58);
    const tooLongName = "b".repeat(59);
    expect(buildSkillSelectCallbackData(buttonSafeName).length).toBe(64);
    expect(buildSkillListKeyboard([{ name: tooLongName }, { name: buttonSafeName }])).toEqual([
      [{ text: buttonSafeName, callbackData: `skill:${buttonSafeName}` }],
    ]);
    expect(buildAnswerAmbiguityKeyboard("abc123", "tok")).toEqual([
      [
        { text: "➡️ Send as prompt", callbackData: "ans:abc123:amb:tok:prompt" },
        { text: "✅ Answer previous", callbackData: "ans:abc123:amb:tok:answer" },
      ],
      [{ text: "Cancel", callbackData: "ans:abc123:amb:tok:cancel" }],
    ]);
    expect(buildAnswerActionKeyboard(metadata!, { includeFullOutputActions: false })).toEqual([
      [{ text: "A. Sync specs now", callbackData: "ans:abc123:opt:A" }],
      [{ text: "B. Archive without syncing", callbackData: "ans:abc123:opt:B" }],
      [{ text: "✍️ Custom answer", callbackData: "ans:abc123:custom" }],
    ]);
  });

  it("builds dashboard callback keyboards", () => {
    const keyboard = buildSessionDashboardKeyboard("current", { busy: true, paused: false, hasOutput: true, hasImages: true });
    expect(parseTelegramActionCallbackData(keyboard[0]![0]!.callbackData)).toEqual({ kind: "dashboard", sessionRef: "current", action: "status" });
    expect(keyboard.flat()).toContainEqual({ text: "⏹ Abort", callbackData: "dash:current:abort" });

    const listKeyboard = buildSessionListDashboardKeyboard([
      { online: true, sessionKey: "one" },
      { online: false, sessionKey: "two" },
    ]);
    expect(listKeyboard[0]).toEqual([{ text: "Use 1", callbackData: `dash:${sessionDashboardRef("one")}:use` }]);
    expect(listKeyboard[1]).toEqual([{ text: "Forget 2", callbackData: `dash:${sessionDashboardRef("two")}:forget` }]);
    expect(parseTelegramActionCallbackData(listKeyboard[1]![0]!.callbackData)).toEqual({ kind: "dashboard", sessionRef: sessionDashboardRef("two"), action: "forget" });
    expect(sessionDashboardRef("two")).toBe(sessionDashboardRef("two"));
    expect(sessionDashboardRef("two")).not.toBe("i2");
    expect(`dash:${sessionDashboardRef("two")}:forget`.length).toBeLessThanOrEqual(64);
    expect(parseTelegramActionCallbackData("dash:current:unknown")).toBeUndefined();
  });

  it("only offers full-output actions when the inline summary is truncated", () => {
    expect(shouldOfferFullOutputActions("Hey! Morning — ready when you are.")).toBe(false);
    expect(shouldOfferFullOutputActions(`${"x".repeat(2_000)}`)).toBe(false);
    expect(shouldOfferFullOutputActions(`${"x".repeat(2_001)}`)).toBe(true);
  });
});
