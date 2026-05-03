import { describe, expect, it } from "vitest";
import { BROKER_HELP_TEXT, CANONICAL_REMOTE_COMMAND_NAMES, HELP_TEXT, commandAllowsWhilePaused, normalizeAliasArg, parseRemoteCommandInvocation } from "../extensions/relay/commands/remote.js";

describe("remote relay command metadata", () => {
  it("keeps help text and paused-command policy in one registry", () => {
    expect(HELP_TEXT).toContain("PiRelay commands:");
    expect(HELP_TEXT).toContain("/progress <quiet|normal|verbose|completion-only>");
    expect(HELP_TEXT).toContain("/to <session> <prompt>");
    expect(BROKER_HELP_TEXT).toContain("/to <session> <prompt>");
    expect(CANONICAL_REMOTE_COMMAND_NAMES).toEqual(expect.arrayContaining(["sessions", "full", "images", "send-image"]));
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

  it("parses slash and relay-prefixed command invocations through one helper", () => {
    expect(parseRemoteCommandInvocation("/progress quiet")).toEqual({ command: "progress", args: "quiet" });
    expect(parseRemoteCommandInvocation("relay progress quiet", { prefixes: ["relay", "pirelay"] })).toEqual({ command: "progress", args: "quiet" });
    expect(parseRemoteCommandInvocation("pirelay status", { prefixes: ["relay", "pirelay"] })).toEqual({ command: "status", args: "" });
    expect(parseRemoteCommandInvocation("relay progress quiet", { allowPrefix: false })).toBeUndefined();
  });
});
