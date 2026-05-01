import { describe, expect, it } from "vitest";
import { BROKER_HELP_TEXT, HELP_TEXT, commandAllowsWhilePaused, normalizeAliasArg } from "../extensions/telegram-tunnel/commands.js";

describe("telegram tunnel command metadata", () => {
  it("keeps help text and paused-command policy in one registry", () => {
    expect(HELP_TEXT).toContain("/progress <quiet|normal|verbose|completion-only>");
    expect(HELP_TEXT).not.toContain("/to <session> <prompt>");
    expect(BROKER_HELP_TEXT).toContain("/to <session> <prompt>");
    expect(commandAllowsWhilePaused("progress")).toBe(true);
    expect(commandAllowsWhilePaused("recent")).toBe(true);
    expect(commandAllowsWhilePaused("steer")).toBe(false);
  });

  it("normalizes aliases consistently", () => {
    expect(normalizeAliasArg("  phone  ")).toBe("phone");
    expect(normalizeAliasArg("clear")).toBeUndefined();
    expect(normalizeAliasArg("reset")).toBeUndefined();
    expect(normalizeAliasArg("x".repeat(80))).toHaveLength(64);
  });
});
