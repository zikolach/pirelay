import { describe, expect, it } from "vitest";
import { containsMarkdownTable, formatTelegramChatMessageText, formatTelegramChatText } from "../extensions/relay/adapters/telegram/formatting.js";

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

  it("renders supported Markdown as Telegram HTML", () => {
    expect(formatTelegramChatMessageText([
      "## Summary",
      "- **Done**: `typecheck`",
      "- Link: [OpenSpec](https://example.com/spec)",
    ].join("\n"))).toEqual({
      parseMode: "HTML",
      text: [
        "<b>Summary</b>",
        "- <b>Done</b>: <code>typecheck</code>",
        "- Link: <a href=\"https://example.com/spec\">OpenSpec</a>",
      ].join("\n"),
    });
  });

  it("renders tables as Telegram preformatted blocks without exposing fences", () => {
    const formatted = formatTelegramChatMessageText([
      "| Name | Status |",
      "| --- | --- |",
      "| API | OK |",
    ].join("\n"));

    expect(formatted.parseMode).toBe("HTML");
    expect(formatted.text).toContain("<pre><code>Name | Status");
    expect(formatted.text).not.toContain("```");
  });

  it("keeps plain text as plain text", () => {
    expect(formatTelegramChatMessageText("No markdown here.")).toEqual({ text: "No markdown here." });
  });

  it("detects source Markdown tables outside fenced code", () => {
    expect(containsMarkdownTable([
      "| Name | Status |",
      "| --- | --- |",
      "| API | OK |",
    ].join("\n"))).toBe(true);
    expect(containsMarkdownTable([
      "```",
      "| Name | Status |",
      "| --- | --- |",
      "| API | OK |",
      "```",
    ].join("\n"))).toBe(false);
  });
});
