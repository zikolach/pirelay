import { describe, expect, it } from "vitest";
import { extractStructuredAnswerMetadata } from "../extensions/telegram-tunnel/answer-workflow.js";
import {
  buildAnswerActionKeyboard,
  buildAnswerCustomCallbackData,
  buildAnswerOptionCallbackData,
  buildFullChatCallbackData,
  buildFullMarkdownCallbackData,
  buildFullOutputKeyboard,
  parseTelegramActionCallbackData,
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
    expect(parseTelegramActionCallbackData(buildFullChatCallbackData("turn-1"))).toEqual({
      kind: "full-chat",
      turnId: "turn-1",
    });
    expect(parseTelegramActionCallbackData(buildFullMarkdownCallbackData("turn-1"))).toEqual({
      kind: "full-markdown",
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
  });
});
