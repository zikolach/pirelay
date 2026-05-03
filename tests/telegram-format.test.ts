import { describe, expect, it } from "vitest";
import { formatTelegramChatText } from "../extensions/relay/adapters/telegram/formatting.js";

describe("Telegram chat formatter", () => {
  it("converts Markdown tables to aligned code-style blocks", () => {
    const formatted = formatTelegramChatText([
      "Results:",
      "",
      "| Name | Status |",
      "| --- | --- |",
      "| API | OK |",
      "| Worker | Needs restart |",
    ].join("\n"));

    expect(formatted).toBe([
      "Results:",
      "",
      "```",
      "Name   | Status",
      "-------+--------------",
      "API    | OK",
      "Worker | Needs restart",
      "```",
    ].join("\n"));
  });

  it("preserves table cell values for wide tables", () => {
    const formatted = formatTelegramChatText([
      "| Package | Notes |",
      "| --- | --- |",
      "| telegram-tunnel | Keep this exact long note with punctuation, 12345, and symbols !? |",
    ].join("\n"));

    expect(formatted).toContain("telegram-tunnel");
    expect(formatted).toContain("Keep this exact long note with punctuation, 12345, and symbols !?");
    expect(formatted).not.toContain("| --- | --- |");
  });

  it("does not reflow fenced code blocks that look like tables", () => {
    const source = [
      "Before",
      "```",
      "| not | a parsed table |",
      "| --- | --- |",
      "| keep | raw |",
      "```",
      "After",
    ].join("\n");

    expect(formatTelegramChatText(source)).toBe(source);
  });

  it("leaves non-table prose unchanged", () => {
    const source = "A | B without separator\nStill just prose.";
    expect(formatTelegramChatText(source)).toBe(source);
  });
});
