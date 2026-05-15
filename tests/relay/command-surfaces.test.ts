import { describe, expect, it } from "vitest";
import { CANONICAL_REMOTE_COMMANDS, canonicalRemoteCommandName, parseRemoteCommandInvocation } from "../../extensions/relay/commands/remote.js";
import { discordRelayCommandSurface, platformSafeDescription, slackRelayCommandSurface, telegramBotCommands, telegramCommandSurface, telegramMenuCommandToCanonical } from "../../extensions/relay/commands/surfaces.js";
import { DiscordLiveOperations, discordJsChatInputInteractionToMessagePayload, discordRelayApplicationCommandData, DISCORD_NATIVE_COMMAND_NAME } from "../../extensions/relay/adapters/discord/live-client.js";
import { parseSlackWebhookBody, slackEnvelopeToChannelEvent, slackSlashCommandMetadata } from "../../extensions/relay/adapters/slack/adapter.js";
import type { SlackRelayConfig } from "../../extensions/relay/core/types.js";

const canonicalVisibleCommands = CANONICAL_REMOTE_COMMANDS.filter((definition) => !("aliasOf" in definition)).map((definition) => definition.command);

describe("messenger command surfaces", () => {
  it("derives Telegram, Discord, and Slack metadata from canonical commands without alias duplicates", () => {
    const telegram = telegramCommandSurface();
    const discord = discordRelayCommandSurface();
    const slack = slackRelayCommandSurface();

    expect(telegram.map((entry) => entry.canonicalCommand).sort()).toEqual([...canonicalVisibleCommands].sort());
    expect(discord.subcommands.map((entry) => entry.canonicalCommand).sort()).toEqual([...canonicalVisibleCommands].sort());
    expect(slack.subcommands.map((entry) => entry.canonicalCommand).sort()).toEqual([...canonicalVisibleCommands].sort());
    expect(telegram.map((entry) => entry.command)).not.toContain("send-file");
    expect(telegram.find((entry) => entry.canonicalCommand === "send-file")?.command).toBe("sendfile");
    expect(telegram.find((entry) => entry.canonicalCommand === "send-image")?.command).toBe("sendimage");
  });

  it("bounds and redacts command descriptions", () => {
    const safe = platformSafeDescription("token bot123:SECRET and xoxb-secret should not leak", 32);
    expect(safe.length).toBeLessThanOrEqual(32);
    expect(safe).not.toContain("SECRET");
    expect(safe).not.toContain("xoxb-secret");
  });

  it("maps platform-safe command names back to canonical command handlers", () => {
    expect(telegramMenuCommandToCanonical("sendfile")).toBe("send-file");
    expect(telegramMenuCommandToCanonical("sendimage")).toBe("send-image");
    expect(telegramMenuCommandToCanonical("send_image")).toBe("send-image");
    expect(canonicalRemoteCommandName("sendfile")).toBe("send-file");
    expect(parseRemoteCommandInvocation("/sendimage out.png")).toEqual({ command: "send-image", args: "out.png" });
    expect(parseRemoteCommandInvocation("/send_image out.png")).toEqual({ command: "send-image", args: "out.png" });
  });

  it("builds Discord native /relay metadata and normalizes interactions", () => {
    const data = discordRelayApplicationCommandData();
    expect(DISCORD_NATIVE_COMMAND_NAME).toBe("relay");
    expect(data).toMatchObject({ name: "relay" });
    const options = data.options as Array<{ name: string; options: unknown[] }>;
    expect(options.map((option) => option.name)).toEqual(expect.arrayContaining(["status", "send-file", "send-image"]));
    expect(options.find((option) => option.name === "status")?.options).toEqual([]);
    expect(options.find((option) => option.name === "send-file")?.options).toHaveLength(1);

    expect(discordJsChatInputInteractionToMessagePayload({
      id: "i1",
      channelId: "c1",
      guildId: null,
      commandName: "relay",
      user: { id: "u1", username: "owner", globalName: null, discriminator: "0", bot: false },
      options: { data: [{ name: "status" }] },
    }).content).toBe("/relay status");
    expect(discordJsChatInputInteractionToMessagePayload({
      id: "i2",
      channelId: "c1",
      guildId: null,
      commandName: "relay",
      user: { id: "u1", username: "owner", globalName: null, discriminator: "0", bot: false },
      options: { data: [{ name: "send-file", options: [{ name: "args", value: "README.md hello" }] }] },
    }).content).toBe("/relay send-file README.md hello");
  });

  it("declares and normalizes Slack /relay slash command payloads", () => {
    expect(slackSlashCommandMetadata()).toMatchObject({ command: "/relay" });
    const raw = new URLSearchParams({
      command: "/relay",
      text: "status\nrelay disconnect",
      channel_id: "D123",
      user_id: "U123",
      user_name: "owner",
      team_id: "T123",
      response_url: "https://hooks.slack.test/response",
      trigger_id: "trig",
    }).toString();
    const envelope = parseSlackWebhookBody(raw);
    expect(envelope).toMatchObject({ type: "slash_command", command: "/relay", text: "status\nrelay disconnect" });
    const event = slackEnvelopeToChannelEvent(envelope, {} as SlackRelayConfig);
    expect(event).toMatchObject({
      kind: "message",
      text: "relay status relay disconnect",
      conversation: { id: "D123", kind: "private" },
      sender: { userId: "U123" },
      metadata: { responseUrl: "https://hooks.slack.test/response", slashCommand: "/relay" },
    });
  });

  it("does not fail Discord startup when native command sync fails", async () => {
    const client = {
      application: { commands: { create: async () => { throw new Error("rate_limited token-secret"); } } },
      on: () => client,
      login: async () => "ok",
      destroy: () => undefined,
    };
    const operations = new DiscordLiveOperations({ token: "discord-token", client: client as never });

    await expect(operations.connect(async () => undefined)).resolves.toBeUndefined();
  });

  it("does not route unrelated or incomplete Slack slash commands", () => {
    const envelope = parseSlackWebhookBody(new URLSearchParams({ command: "/status", text: "", channel_id: "D123", user_id: "U123", trigger_id: "trig" }).toString());
    expect(slackEnvelopeToChannelEvent(envelope, {} as SlackRelayConfig)).toBeUndefined();
    const missingTrigger = parseSlackWebhookBody(new URLSearchParams({ command: "/relay", text: "status", channel_id: "D123", user_id: "U123" }).toString());
    expect(slackEnvelopeToChannelEvent(missingTrigger, {} as SlackRelayConfig)).toBeUndefined();
  });
});
