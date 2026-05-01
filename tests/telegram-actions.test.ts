import { describe, expect, it } from "vitest";
import { extractStructuredAnswerMetadata } from "../extensions/telegram-tunnel/answer-workflow.js";
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
  parseTelegramActionCallbackData,
  shouldOfferFullOutputActions,
} from "../extensions/telegram-tunnel/telegram-actions.js";

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

  it("only offers full-output actions when the inline summary is truncated", () => {
    expect(shouldOfferFullOutputActions("Hey! Morning — ready when you are.")).toBe(false);
    expect(shouldOfferFullOutputActions(`${"x".repeat(320)}`)).toBe(false);
    expect(shouldOfferFullOutputActions(`${"x".repeat(321)}`)).toBe(true);
  });
});
