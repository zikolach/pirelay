import { describe, expect, it, vi } from "vitest";
import { DiscordChannelAdapter, discordCapabilities, discordMentionedUserIds, discordMentionPayloadsSharedRoomAddressing, discordMessageSharedRoomAddressing, discordMessageToChannelEvent, discordPairingCommand, escapeDiscordPlainText, isDiscordGuildMessage, isDiscordIdentityAllowed } from "../extensions/relay/adapters/discord/adapter.js";

const config = {
  enabled: true,
  botToken: "discord-token",
  allowUserIds: ["u1"],
  allowGuildChannels: false,
  maxTextChars: 50,
  maxFileBytes: 1000,
  allowedImageMimeTypes: ["image/png"],
};

describe("DiscordChannelAdapter", () => {
  it("normalizes DM messages and image attachments", () => {
    const event = discordMessageToChannelEvent({
      id: "m1",
      channel_id: "dm1",
      author: { id: "u1", username: "dev", global_name: "Dev User" },
      content: "hello pi",
      attachments: [{ id: "a1", filename: "screen.png", content_type: "image/png", size: 123, url: "https://cdn.test/screen.png", width: 10, height: 20 }],
    }, config);

    expect(event).toBeDefined();
    expect(event!).toMatchObject({
      kind: "message",
      channel: "discord",
      messageId: "m1",
      text: "hello pi",
      conversation: { id: "dm1", kind: "private" },
      sender: { channel: "discord", userId: "u1", username: "dev", displayName: "Dev User" },
    });
    expect(event!.attachments[0]).toMatchObject({ kind: "image", fileName: "screen.png", mimeType: "image/png", supported: true });
  });

  it("marks guild messages so relay code can reject them by default", () => {
    const event = discordMessageToChannelEvent({
      id: "m2",
      channel_id: "c1",
      guild_id: "g1",
      author: { id: "u1", username: "dev" },
      content: "/status",
      attachments: [],
    }, config);

    expect(event).toBeDefined();
    expect(isDiscordGuildMessage(event!)).toBe(true);
    expect(event!.conversation.kind).toBe("group");
  });

  it("chunks text, maps buttons, and sends files through injected operations", async () => {
    const sendMessage = vi.fn(async (_payload: unknown) => undefined);
    const sendFile = vi.fn(async (_payload: unknown) => undefined);
    const sendTyping = vi.fn(async (_channelId: string) => undefined);
    const answerInteraction = vi.fn(async (_interactionId: string, _interactionToken: string | undefined, _options?: unknown) => undefined);
    const downloadFile = vi.fn(async (_url: string) => new Uint8Array([9]));
    const adapter = new DiscordChannelAdapter(config, { sendMessage, sendFile, sendTyping, answerInteraction, downloadFile });
    const address = { channel: "discord", conversationId: "dm1", userId: "u1" } as const;

    await adapter.sendText(address, "x".repeat(120), { buttons: [[{ label: "Full", actionData: "full:t:chat", style: "primary" }]] });
    await adapter.sendImage(address, { fileName: "screen.png", mimeType: "image/png", data: new Uint8Array([1]), byteSize: 1 });
    await adapter.sendActivity(address, "typing");
    await adapter.answerAction("interaction-1", { text: "Done" });
    await expect(adapter.downloadAttachment({ id: "a1", kind: "image", metadata: { url: "https://cdn.test/file" } })).resolves.toEqual(new Uint8Array([9]));

    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({ channelId: "dm1", content: "x".repeat(50) });
    expect((sendMessage.mock.calls.at(-1)?.[0] as { components: Array<Array<unknown>> }).components[0]![0]).toMatchObject({ label: "Full", customId: "full:t:chat" });
    expect(sendFile).toHaveBeenCalledWith(expect.objectContaining({ channelId: "dm1", fileName: "screen.png" }));
    expect(sendTyping).toHaveBeenCalledWith("dm1");
    expect(answerInteraction).toHaveBeenCalledWith("interaction-1", undefined, { text: "Done", alert: undefined });
    expect(downloadFile).toHaveBeenCalledWith("https://cdn.test/file");
  });

  it("escapes Discord markdown in outbound plain text", async () => {
    expect(escapeDiscordPlainText("## **Status** `code` @everyone openai_codex"))
      .toBe("\\#\\# \\*\\*Status\\*\\* \\`code\\` @\u200beveryone openai\\_codex");

    const sendMessage = vi.fn(async (_payload: unknown) => undefined);
    const sendFile = vi.fn(async (_payload: unknown) => undefined);
    const answerInteraction = vi.fn(async (_interactionId: string, _interactionToken: string | undefined, _options?: unknown) => undefined);
    const adapter = new DiscordChannelAdapter(config, { sendMessage, sendFile, sendTyping: async () => undefined, answerInteraction });
    const address = { channel: "discord", conversationId: "dm1", userId: "u1" } as const;

    await adapter.sendText(address, "### H\nUse **bold**");
    await adapter.sendDocument(address, { fileName: "out.txt", mimeType: "text/plain", data: new Uint8Array([1]), byteSize: 1 }, { caption: "**caption**" });
    await adapter.answerAction("interaction-1", { text: "**Done**" });

    expect(sendMessage).toHaveBeenCalledWith({ channelId: "dm1", content: "\\#\\#\\# H\nUse \\*\\*bold\\*\\*" });
    expect(sendFile).toHaveBeenCalledWith(expect.objectContaining({ caption: "\\*\\*caption\\*\\*" }));
    expect(answerInteraction).toHaveBeenCalledWith("interaction-1", undefined, { text: "\\*\\*Done\\*\\*", alert: undefined });
  });

  it("rejects bot messages unless delegation is enabled and only applies image MIME allow-list to images", () => {
    expect(discordMessageToChannelEvent({
      id: "bot-message",
      channel_id: "dm1",
      author: { id: "bot", username: "bot", bot: true },
      content: "loop",
      attachments: [],
    }, config)).toBeUndefined();
    const delegatedBotEvent = discordMessageToChannelEvent({
      id: "bot-delegation-message",
      channel_id: "c1",
      guild_id: "g1",
      author: { id: "bot", username: "bot", bot: true },
      content: "relay delegate target run tests",
      attachments: [],
    }, { ...config, delegation: { enabled: true } });
    expect(delegatedBotEvent?.sender.metadata).toMatchObject({ isBot: true });
    const docEvent = discordMessageToChannelEvent({
      id: "doc-message",
      channel_id: "dm1",
      author: { id: "u1", username: "dev" },
      content: "doc",
      attachments: [{ id: "doc", filename: "notes.txt", content_type: "text/plain", size: 10 }],
    }, config);
    expect(docEvent?.attachments[0]).toMatchObject({ kind: "document", supported: true });
  });

  it("passes Discord interaction tokens to acknowledgement operations", async () => {
    const answerInteraction = vi.fn(async (_interactionId: string, _interactionToken: string | undefined, _options?: unknown) => undefined);
    const adapter = new DiscordChannelAdapter(config, { sendMessage: async () => undefined, sendFile: async () => undefined, sendTyping: async () => undefined, answerInteraction });
    await adapter.answerAction("interaction-1:token-1", { text: "Done" });
    expect(answerInteraction).toHaveBeenCalledWith("interaction-1", "token-1", { text: "Done", alert: undefined });
  });

  it("sends a single Discord button prompt after file uploads", async () => {
    const sendMessage = vi.fn(async (_payload: unknown) => undefined);
    const adapter = new DiscordChannelAdapter(config, { sendMessage, sendFile: async () => undefined, sendTyping: async () => undefined, answerInteraction: async () => undefined });
    const address = { channel: "discord", conversationId: "dm1", userId: "u1" } as const;

    await adapter.sendDocument(address, { fileName: "out.txt", mimeType: "text/plain", data: new Uint8Array([1]), byteSize: 1 }, { buttons: [[{ label: "Full", actionData: "full:t:chat" }]] });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({ channelId: "dm1", content: "Actions:" });
  });

  it("rejects outbound files deterministically when limits or base64 encoding are invalid", async () => {
    const adapter = new DiscordChannelAdapter(config, { sendMessage: async () => undefined, sendFile: async () => undefined, sendTyping: async () => undefined, answerInteraction: async () => undefined });
    const address = { channel: "discord", conversationId: "dm1", userId: "u1" } as const;

    await expect(adapter.sendImage(address, { fileName: "bad.gif", mimeType: "image/gif", data: new Uint8Array([1]), byteSize: 1 })).rejects.toThrow("MIME type");
    await expect(adapter.sendDocument(address, { fileName: "huge.txt", mimeType: "text/plain", data: new Uint8Array([1]), byteSize: 1001 })).rejects.toThrow("too large");
    await expect(adapter.sendDocument(address, { fileName: "bad.txt", mimeType: "text/plain", data: "plain text", byteSize: 10 })).rejects.toThrow("base64");
  });

  it("checks allow-list and guild authorization plus pairing command text", () => {
    expect(isDiscordIdentityAllowed({ channel: "discord", userId: "u1" }, config)).toBe(true);
    expect(isDiscordIdentityAllowed({ channel: "discord", userId: "u2" }, config)).toBe(false);
    expect(isDiscordIdentityAllowed({ channel: "discord", userId: "u1", metadata: { guildId: "g1" } }, { ...config, allowGuildChannels: true })).toBe(false);
    expect(isDiscordIdentityAllowed({ channel: "discord", userId: "u1", metadata: { guildId: "g1" } }, { ...config, allowGuildChannels: true, allowGuildIds: ["g1"] })).toBe(true);
    expect(discordPairingCommand("abc")).toBe("/start abc");
  });

  it("normalizes Discord shared-room mentions", () => {
    expect(discordMentionedUserIds("hi <@123> and <@!456>")).toEqual(["123", "456"]);
    expect(discordMessageSharedRoomAddressing({ content: "hi <@123>" }, "123")).toEqual({ kind: "local" });
    expect(discordMessageSharedRoomAddressing({ content: "hi <@456>" }, "123")).toEqual({ kind: "none" });
    expect(discordMessageSharedRoomAddressing({ content: "hi <@123> and <@456>" }, "123")).toEqual({ kind: "local" });
    expect(discordMessageSharedRoomAddressing({ content: "hi" }, "123")).toEqual({ kind: "none" });
    expect(discordMentionPayloadsSharedRoomAddressing([{ id: "123", bot: true }, { id: "u1", bot: false }], "123")).toEqual({ kind: "local" });
    expect(discordMentionPayloadsSharedRoomAddressing([{ id: "123", bot: true }, { id: "456", bot: true }], "123")).toEqual({ kind: "ambiguous", reason: "multiple bot mentions" });
    expect(discordMentionPayloadsSharedRoomAddressing([{ id: "456", bot: true }], "123")).toEqual({ kind: "remote", machineId: "456" });
  });

  it("attaches shared-room addressing metadata from configured bot id", () => {
    const local = discordMessageToChannelEvent({
      id: "m-local",
      channel_id: "c1",
      guild_id: "g1",
      author: { id: "u1", username: "dev" },
      content: "<@123> status",
      attachments: [],
    }, { ...config, applicationId: "123" });
    const remote = discordMessageToChannelEvent({
      id: "m-remote",
      channel_id: "c1",
      guild_id: "g1",
      author: { id: "u1", username: "dev" },
      content: "<@456> status",
      mentions: [{ id: "456", bot: true }],
      attachments: [],
    }, { ...config, applicationId: "123" });

    expect(local?.metadata?.sharedRoomAddressing).toEqual({ kind: "local" });
    expect(remote?.metadata?.sharedRoomAddressing).toEqual({ kind: "remote", machineId: "456" });
  });

  it("declares conservative Discord DM capabilities", () => {
    expect(discordCapabilities(config)).toMatchObject({ inlineButtons: true, privateChats: true, groupChats: false, maxTextChars: 50, maxImageBytes: 1000 });
  });
});
