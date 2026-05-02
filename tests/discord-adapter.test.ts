import { describe, expect, it, vi } from "vitest";
import { DiscordChannelAdapter, discordCapabilities, discordMessageToChannelEvent, discordPairingCommand, isDiscordGuildMessage, isDiscordIdentityAllowed } from "../extensions/telegram-tunnel/discord-adapter.js";

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

    expect(event).toMatchObject({
      kind: "message",
      channel: "discord",
      messageId: "m1",
      text: "hello pi",
      conversation: { id: "dm1", kind: "private" },
      sender: { channel: "discord", userId: "u1", username: "dev", displayName: "Dev User" },
    });
    expect(event.attachments[0]).toMatchObject({ kind: "image", fileName: "screen.png", mimeType: "image/png", supported: true });
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

    expect(isDiscordGuildMessage(event)).toBe(true);
    expect(event.conversation.kind).toBe("group");
  });

  it("chunks text, maps buttons, and sends files through injected operations", async () => {
    const sendMessage = vi.fn(async (_payload: unknown) => undefined);
    const sendFile = vi.fn(async (_payload: unknown) => undefined);
    const sendTyping = vi.fn(async (_channelId: string) => undefined);
    const answerInteraction = vi.fn(async (_interactionId: string, _options?: unknown) => undefined);
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
    expect(answerInteraction).toHaveBeenCalledWith("interaction-1", { text: "Done", alert: undefined });
    expect(downloadFile).toHaveBeenCalledWith("https://cdn.test/file");
  });

  it("checks allow-list authorization and pairing command text", () => {
    expect(isDiscordIdentityAllowed({ channel: "discord", userId: "u1" }, config)).toBe(true);
    expect(isDiscordIdentityAllowed({ channel: "discord", userId: "u2" }, config)).toBe(false);
    expect(discordPairingCommand("abc")).toBe("/start abc");
  });

  it("declares conservative Discord DM capabilities", () => {
    expect(discordCapabilities(config)).toMatchObject({ inlineButtons: true, privateChats: true, groupChats: false, maxTextChars: 50, maxImageBytes: 1000 });
  });
});
