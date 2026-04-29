import { describe, expect, it } from "vitest";
import { chunkTelegramText, parseTelegramCommand, resolveBusyDeliveryMode } from "../extensions/telegram-tunnel/utils.js";

describe("telegram utils", () => {
  it("parses slash commands and strips bot usernames", () => {
    expect(parseTelegramCommand("/status")).toEqual({ command: "status", args: "" });
    expect(parseTelegramCommand("/followup@mybot fix the failing test")).toEqual({
      command: "followup",
      args: "fix the failing test",
    });
    expect(parseTelegramCommand("hello")).toBeUndefined();
  });

  it("selects busy delivery mode only while busy", () => {
    expect(resolveBusyDeliveryMode("followUp", false)).toBeUndefined();
    expect(resolveBusyDeliveryMode("steer", true)).toBe("steer");
  });

  it("chunks oversized Telegram output", () => {
    const chunks = chunkTelegramText("line1\nline2\nline3\nline4", 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.text.startsWith("[1/")).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 16)).toBe(true);
  });
});
