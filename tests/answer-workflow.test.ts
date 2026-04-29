import { describe, expect, it } from "vitest";
import {
  advanceGuidedAnswerFlow,
  extractStructuredAnswerMetadata,
  renderGuidedAnswerPrompt,
  startGuidedAnswerFlow,
  summarizeTailForTelegram,
} from "../extensions/telegram-tunnel/answer-workflow.js";

describe("answer workflow", () => {
  it("extracts structured choice metadata from numbered decision blocks", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Artifacts/tasks are complete.",
      "",
      "Choose:",
      "1. sync — sync specs now, then archive (recommended)",
      "2. skip — archive without syncing",
    ].join("\n"));

    expect(metadata).toEqual({
      kind: "choice",
      prompt: "Choose:",
      options: [
        {
          id: "1",
          label: "sync — sync specs now, then archive (recommended)",
          answer: "1. sync — sync specs now, then archive (recommended)",
        },
        {
          id: "2",
          label: "skip — archive without syncing",
          answer: "2. skip — archive without syncing",
        },
      ],
      tailExcerpt: [
        "Choose:",
        "1. sync — sync specs now, then archive (recommended)",
        "2. skip — archive without syncing",
      ].join("\n"),
    });
  });

  it("extracts question blocks and advances guided answers", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Please answer the following questions.",
      "What environment should we target?",
      "Do we archive immediately?",
    ].join("\n"));

    expect(metadata?.kind).toBe("questions");
    const initial = startGuidedAnswerFlow();
    expect(renderGuidedAnswerPrompt(metadata!, initial)).toContain("Question 1/2");

    const step2 = advanceGuidedAnswerFlow(metadata!, initial, "staging");
    expect(step2.nextState?.step).toBe(1);
    expect(step2.responseText).toContain("Question 2/2");

    const done = advanceGuidedAnswerFlow(metadata!, step2.nextState!, "yes");
    expect(done.done).toBe(true);
    expect(done.injectionText).toContain("A1: staging");
    expect(done.injectionText).toContain("A2: yes");
  });

  it("builds Telegram continuation text for decision tails", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Choose:",
      "1. sync — sync specs now, then archive",
      "2. skip — archive without syncing",
    ].join("\n"));

    expect(summarizeTailForTelegram(metadata!)).toContain("Reply with a number to answer immediately");
    expect(summarizeTailForTelegram(metadata!)).toContain("Use /full");
  });
});
