import { describe, expect, it, vi } from "vitest";
import { ChannelRelayBroker } from "../extensions/telegram-tunnel/channel-broker.js";
import type { ChannelAdapter, ChannelInboundHandler } from "../extensions/telegram-tunnel/channel-adapter.js";

function adapter(id: "telegram" | "discord" | "slack"): ChannelAdapter {
  return {
    id,
    displayName: id,
    capabilities: {
      inlineButtons: true,
      textMessages: true,
      documents: true,
      images: true,
      activityIndicators: true,
      callbacks: true,
      privateChats: true,
      groupChats: false,
      maxTextChars: 100,
      supportedImageMimeTypes: [],
    },
    startPolling: vi.fn(async (handler: ChannelInboundHandler) => {
      await handler({
        kind: "message",
        channel: id,
        updateId: `${id}-u`,
        messageId: `${id}-m`,
        text: id,
        attachments: [],
        conversation: { channel: id, id: `${id}-c`, kind: "private" },
        sender: { channel: id, userId: `${id}-u` },
      });
    }),
    stopPolling: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    sendText: vi.fn(async () => undefined),
    sendDocument: vi.fn(async () => undefined),
    sendImage: vi.fn(async () => undefined),
    sendActivity: vi.fn(async () => undefined),
    answerAction: vi.fn(async () => undefined),
  };
}

describe("ChannelRelayBroker", () => {
  it("starts multiple adapters and keeps channel identities isolated", async () => {
    const broker = new ChannelRelayBroker([adapter("telegram"), adapter("discord"), adapter("slack")]);
    const seen: string[] = [];

    await broker.start(async (event) => {
      seen.push(`${event.channel}:${event.updateId}`);
    });

    expect(seen).toEqual(["telegram:telegram-u", "discord:discord-u", "slack:slack-u"]);
    expect(broker.bindingKey("telegram", "s1")).toBe("telegram:s1");
    expect(broker.bindingKey("discord", "s1")).toBe("discord:s1");
    expect(broker.bindingKey("slack", "s1")).toBe("slack:s1");
    await broker.stop();
  });

  it("rejects duplicate adapters", () => {
    const broker = new ChannelRelayBroker([adapter("discord")]);
    expect(() => broker.registerAdapter(adapter("discord"))).toThrow("already registered");
  });

  it("rejects events emitted under the wrong channel", async () => {
    const bad = adapter("discord");
    bad.startPolling = vi.fn(async (handler) => {
      await handler({
        kind: "message",
        channel: "slack",
        updateId: "bad",
        messageId: "bad",
        text: "bad",
        attachments: [],
        conversation: { channel: "slack", id: "c", kind: "private" },
        sender: { channel: "slack", userId: "u" },
      });
    });
    const broker = new ChannelRelayBroker([bad]);

    await expect(broker.start(async () => undefined)).rejects.toThrow("emitted slack event");
  });
});
