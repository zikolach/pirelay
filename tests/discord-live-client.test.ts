import type { Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { DiscordLiveOperations, discordActionRows, discordJsChatInputInteractionToMessagePayload, discordJsInteractionToPayload, discordJsMessageToPayload } from "../extensions/relay/adapters/discord/live-client.js";

function mockDiscordClient(loginError?: Error): Client {
  return {
    on: vi.fn(),
    login: vi.fn(async () => {
      if (loginError) throw loginError;
      return "logged-in";
    }),
    destroy: vi.fn(),
    channels: { fetch: vi.fn() },
  } as unknown as Client;
}

describe("discord live client helpers", () => {
  it("maps Discord.js message-like objects to adapter payloads", () => {
    const payload = discordJsMessageToPayload({
      id: "m1",
      channelId: "c1",
      guildId: null,
      content: "hello <@bot1> <@u2>",
      webhookId: null,
      author: { id: "u1", username: "nik", globalName: "Nikolay", discriminator: "0", bot: false },
      mentions: { users: { values: () => [
        { id: "bot1", username: "relay", globalName: null, discriminator: "0", bot: true },
        { id: "u2", username: "alex", globalName: "Alex", discriminator: "0", bot: false },
      ] } },
      attachments: {
        values: () => [{
          id: "a1",
          name: "image.png",
          contentType: "image/png",
          size: 123,
          url: "https://cdn.example/image.png",
          width: 10,
          height: 20,
        }],
      },
    });

    expect(payload).toMatchObject({
      id: "m1",
      channel_id: "c1",
      content: "hello <@bot1> <@u2>",
      author: { id: "u1", username: "nik", global_name: "Nikolay", bot: false },
      mentions: [{ id: "bot1", bot: true }, { id: "u2", bot: false }],
      attachments: [{ id: "a1", filename: "image.png", content_type: "image/png", size: 123 }],
    });
    expect(payload.guild_id).toBeUndefined();
  });

  it("maps Discord.js button interaction-like objects to adapter payloads", () => {
    const payload = discordJsInteractionToPayload({
      id: "i1",
      token: "token-1",
      channelId: "c1",
      guildId: "g1",
      customId: "action:1",
      message: { id: "m1" },
      user: { id: "u1", username: "nik", globalName: null, discriminator: "0", bot: false },
    });

    expect(payload).toMatchObject({
      id: "i1",
      token: "token-1",
      channel_id: "c1",
      guild_id: "g1",
      data: { custom_id: "action:1" },
      message: { id: "m1" },
      user: { id: "u1", username: "nik", bot: false },
    });
  });

  it("maps Discord.js chat input interactions to command messages", () => {
    const payload = discordJsChatInputInteractionToMessagePayload({
      id: "i2",
      channelId: "c1",
      guildId: null,
      commandName: "status",
      user: { id: "u1", username: "nik", globalName: null, discriminator: "0", bot: false },
      options: { data: [] },
    });

    expect(payload).toMatchObject({
      id: "i2",
      channel_id: "c1",
      content: "/status",
      author: { id: "u1", username: "nik", bot: false },
      attachments: [],
    });
  });

  it("maps future namespaced /relay subcommands to command messages", () => {
    const payload = discordJsChatInputInteractionToMessagePayload({
      id: "i3",
      channelId: "c1",
      guildId: null,
      commandName: "relay",
      user: { id: "u1", username: "nik", globalName: null, discriminator: "0", bot: false },
      options: { data: [{ name: "status" }] },
    });

    expect(payload.content).toBe("/relay status");
  });

  it("disables mentions when sending Discord messages and files", async () => {
    const send = vi.fn(async (_options: unknown) => undefined);
    const client = mockDiscordClient();
    vi.mocked(client.channels.fetch).mockResolvedValue({ send, sendTyping: vi.fn(async () => undefined) } as never);
    const operations = new DiscordLiveOperations({ token: "discord-token", client });

    await operations.sendMessage({ channelId: "c1", content: "hello @everyone" });
    await operations.sendFile({ channelId: "c1", fileName: "out.txt", data: new Uint8Array([1]), caption: "caption @here", mimeType: "text/plain" });

    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({ content: "hello @everyone", allowedMentions: { parse: [] } }));
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: "caption @here", allowedMentions: { parse: [] } }));
  });

  it("converts button rows to Discord component builders", () => {
    const rows = discordActionRows([[{ label: "Open", customId: "open", style: "primary" }]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.components).toHaveLength(1);
  });

  it("redacts token-shaped Discord login failures", async () => {
    const client = mockDiscordClient(new Error("invalid token discord-token-supersecret"));
    const operations = new DiscordLiveOperations({ token: "discord-token-supersecret", client });

    await expect(operations.connect(async () => undefined)).rejects.toThrow("[redacted]");
    await expect(operations.connect(async () => undefined)).rejects.not.toThrow("discord-token-supersecret");
  });
});
