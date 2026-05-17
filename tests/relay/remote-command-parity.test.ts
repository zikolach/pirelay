import { describe, expect, it } from "vitest";
import { CANONICAL_REMOTE_COMMAND_NAMES, buildHelpText, parsePrefixedRemoteCommand } from "../../extensions/relay/commands/remote.js";
import { DISCORD_NATIVE_COMMAND_NAME, DISCORD_NATIVE_SUBCOMMAND_NAMES } from "../../extensions/relay/adapters/discord/live-client.js";
import { DISCORD_SUPPORTED_COMMANDS, parseDiscordCommand } from "../../extensions/relay/adapters/discord/runtime.js";

const requiredCanonicalCommands = [
  "help",
  "status",
  "sessions",
  "use",
  "to",
  "alias",
  "forget",
  "progress",
  "recent",
  "summary",
  "full",
  "images",
  "send-image",
  "steer",
  "followup",
  "abort",
  "compact",
  "pause",
  "resume",
  "disconnect",
] as const;

describe("remote command parity metadata", () => {
  it("keeps the canonical command matrix explicit", () => {
    expect(CANONICAL_REMOTE_COMMAND_NAMES).toEqual(expect.arrayContaining([...requiredCanonicalCommands, "notify", "activity"]));
  });

  it("maps every canonical command through the Discord runtime parser", () => {
    for (const command of requiredCanonicalCommands) {
      expect(DISCORD_SUPPORTED_COMMANDS).toContain(command);
      expect(parseDiscordCommand(`/${command} args`)).toMatchObject({ name: command, args: "args" });
      expect(parseDiscordCommand(`relay ${command} args`)).toMatchObject({ name: command, args: "args" });
      expect(parseDiscordCommand(`/relay ${command} args`)).toMatchObject({ name: command, args: "args" });
    }
  });

  it("parses Discord relay-prefix commands without slash-command routing", () => {
    expect(parsePrefixedRemoteCommand("relay status")).toEqual({ command: "status", args: "" });
    expect(parsePrefixedRemoteCommand("relay /full now")).toEqual({ command: "full", args: "now" });
    expect(parseDiscordCommand("relay")).toEqual({ name: "help", args: "" });
    expect(parseDiscordCommand("relay sessions")).toEqual({ name: "sessions", args: "" });
    expect(parseDiscordCommand("hello relay status")).toBeUndefined();
  });

  it("formats Discord help with reliable relay-prefix invocations", () => {
    const help = buildHelpText({ title: "PiRelay Discord commands:", commandPrefix: "relay" });
    expect(help).toContain("relay status - session and relay dashboard");
    expect(help).toContain("relay full - latest full assistant output");
    expect(help).not.toContain("/status - session and relay dashboard");
  });

  it("uses Telegram bot username placeholders in shared-room help", () => {
    const help = buildHelpText();
    expect(help).toContain("/sessions@<bot_username>");
    expect(help).toContain("/use@<bot_username> <session>");
    expect(help).toContain("/to@<bot_username> <session> <prompt>");
    expect(help).toContain("/task@<bot_username>");
    expect(help).not.toContain("/sessions@bot");
    expect(help).not.toContain("/task@bot");
  });

  it("keeps Discord native command metadata namespaced around /relay subcommands", () => {
    expect(DISCORD_NATIVE_COMMAND_NAME).toBe("relay");
    for (const command of requiredCanonicalCommands) {
      expect(DISCORD_NATIVE_SUBCOMMAND_NAMES).toContain(command);
    }
  });
});
