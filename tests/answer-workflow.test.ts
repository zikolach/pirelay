import { describe, expect, it } from "vitest";
import {
  advanceGuidedAnswerFlow,
  extractStructuredAnswerMetadata,
  isGuidedAnswerCancel,
  isGuidedAnswerStart,
  matchChoiceOption,
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

    expect(metadata).toMatchObject({
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
    expect(metadata?.turnId).toMatch(/^[a-f0-9]+$/);
    expect(metadata?.confidence).toBeGreaterThanOrEqual(65);
    expect(metadata?.diagnostics).toContain("stable-continuous-ids");
  });

  it("extracts inline lettered options from a single response paragraph", () => {
    const metadata = extractStructuredAnswerMetadata(
      "What should we do next? A) Clean up the OpenSpec/git working tree B) Run a real Telegram smoke test for typing C) Add the missing integration-style tests D) Commit the current completed changes E) Inspect/fix anything suspicious before committing",
    );

    expect(metadata).toMatchObject({
      kind: "choice",
      prompt: "What should we do next?",
      options: [
        {
          id: "A",
          label: "Clean up the OpenSpec/git working tree",
          answer: "A) Clean up the OpenSpec/git working tree",
        },
        {
          id: "B",
          label: "Run a real Telegram smoke test for typing",
          answer: "B) Run a real Telegram smoke test for typing",
        },
        {
          id: "C",
          label: "Add the missing integration-style tests",
          answer: "C) Add the missing integration-style tests",
        },
        {
          id: "D",
          label: "Commit the current completed changes",
          answer: "D) Commit the current completed changes",
        },
        {
          id: "E",
          label: "Inspect/fix anything suspicious before committing",
          answer: "E) Inspect/fix anything suspicious before committing",
        },
      ],
      tailExcerpt:
        "A) Clean up the OpenSpec/git working tree B) Run a real Telegram smoke test for typing C) Add the missing integration-style tests D) Commit the current completed changes E) Inspect/fix anything suspicious before committing",
    });
    expect(metadata?.diagnostics).toContain("inline-options");
  });

  it("matches lettered options case-insensitively and by ordinal number", () => {
    const metadata = extractStructuredAnswerMetadata("What next? A) test B) commit C) ship");
    expect(matchChoiceOption(metadata!, "a")?.label).toBe("test");
    expect(matchChoiceOption(metadata!, "2")?.label).toBe("commit");
  });

  it("extracts question blocks and advances guided answers", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Please answer the following questions.",
      "What environment should we target?",
      "Do we archive immediately?",
    ].join("\n"));

    expect(metadata?.kind).toBe("questions");
    const initial = startGuidedAnswerFlow();
    expect(renderGuidedAnswerPrompt(metadata!, initial)).toContain("Q1: What environment should we target?");
    expect(renderGuidedAnswerPrompt(metadata!, initial)).toContain("A1:");

    const drafted = advanceGuidedAnswerFlow(metadata!, initial, [
      "A1: staging",
      "A2: yes",
    ].join("\n"));
    expect(drafted.done).toBe(true);
    expect(drafted.injectionText).toContain("A1: staging");
    expect(drafted.injectionText).toContain("A2: yes");

    const step2 = advanceGuidedAnswerFlow(metadata!, initial, "staging");
    expect(step2.nextState?.step).toBe(1);
    expect(step2.responseText).toContain("Next question: Q2");

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

    expect(summarizeTailForTelegram(metadata!)).toContain("reply with an option directly");
    expect(summarizeTailForTelegram(metadata!)).toContain("Use /full");
  });

  it("numbers bullet options in forward order", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Pick one:",
      "- first option",
      "- second option",
      "- third option",
      "- fourth option",
    ].join("\n"));

    expect(metadata?.kind).toBe("choice");
    expect(metadata?.options?.map((option) => option.id)).toEqual(["1", "2", "3", "4"]);
    expect(metadata?.options?.map((option) => option.label)).toEqual([
      "first option",
      "second option",
      "third option",
      "fourth option",
    ]);
  });

  it("detects lettered, parenthesized, and option-label choices", () => {
    expect(extractStructuredAnswerMetadata([
      "Next options:",
      "A. Sync specs now",
      "B. Archive without syncing",
    ].join("\n"))?.options?.map((option) => option.id)).toEqual(["A", "B"]);

    expect(extractStructuredAnswerMetadata([
      "Choose one:",
      "(A) Show in chat",
      "(B) Download Markdown",
    ].join("\n"))?.options?.map((option) => option.id)).toEqual(["A", "B"]);

    expect(extractStructuredAnswerMetadata([
      "Select output format:",
      "Option A: Chat chunks",
      "Option B: Markdown document",
    ].join("\n"))?.options?.map((option) => option.label)).toEqual(["Chat chunks", "Markdown document"]);
  });

  it("returns undefined for malformed or ambiguous partial choice blocks", () => {
    expect(extractStructuredAnswerMetadata(["Choose:", "1.", "2."].join("\n"))).toBeUndefined();
    expect(extractStructuredAnswerMetadata(["Options:", "maybe", "perhaps"].join("\n"))).toBeUndefined();
  });

  it("rejects ordinary numbered task lists despite structural formatting", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Tasks completed:",
      "1. Added tests",
      "2. Updated docs",
      "3. Ran typecheck",
    ].join("\n"));

    expect(metadata).toBeUndefined();
  });

  it("does not enable guided answers for ordinary trailing bullet lists", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Implemented:",
      "- added tests",
      "- updated docs",
      "- fixed parser",
    ].join("\n"));

    expect(metadata).toBeUndefined();
  });

  it("does not enable guided answers for plain trailing questions without answer cue", () => {
    const metadata = extractStructuredAnswerMetadata([
      "I investigated two things.",
      "What changed?",
      "Why did it break?",
    ].join("\n"));

    expect(metadata).toBeUndefined();
  });

  it("does not enable guided answers for a generic single friendly question", () => {
    const metadata = extractStructuredAnswerMetadata("Hello! 👋 How can I help?");
    expect(metadata).toBeUndefined();
  });

  it("supports cancel and restart semantics for guided answers", () => {
    const metadata = extractStructuredAnswerMetadata([
      "Please answer the following questions.",
      "What environment should we target?",
      "Do we archive immediately?",
    ].join("\n"));

    expect(isGuidedAnswerStart("answer")).toBe(true);
    expect(isGuidedAnswerCancel("cancel")).toBe(true);

    const initial = startGuidedAnswerFlow();
    const cancelled = advanceGuidedAnswerFlow(metadata!, initial, "cancel");
    expect(cancelled.cancelled).toBe(true);

    const restarted = startGuidedAnswerFlow();
    expect(renderGuidedAnswerPrompt(metadata!, restarted)).toContain("Q1: What environment should we target?");
  });
});
