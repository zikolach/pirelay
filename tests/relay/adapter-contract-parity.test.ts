import { describe, expect, it } from "vitest";
import { channelAdapterToMessengerAdapter, createDiscordMessengerAdapter, createSlackMessengerAdapter, createTelegramMessengerAdapter } from "../../extensions/relay/adapters/index.js";
import type { ChannelAdapter, ChannelInboundHandler, ChannelOutboundFile, ChannelOutboundPayload, ChannelRouteAddress } from "../../extensions/relay/core/channel-adapter.js";

describe("messenger adapter contract parity", () => {
  it("wraps legacy channel adapters in the messenger adapter lifecycle", async () => {
    const events: string[] = [];
    const channelAdapter: ChannelAdapter = {
      id: "telegram",
      displayName: "Telegram",
      capabilities: {
        inlineButtons: true,
        textMessages: true,
        documents: true,
        images: true,
        activityIndicators: true,
        callbacks: true,
        privateChats: true,
        groupChats: false,
        maxTextChars: 3900,
        supportedImageMimeTypes: ["image/png"],
      },
      async startPolling(handler: ChannelInboundHandler) {
        events.push("start");
        await handler({
          kind: "message",
          channel: "telegram",
          updateId: "u1",
          messageId: "m1",
          text: "hello",
          attachments: [],
          conversation: { channel: "telegram", id: "chat", kind: "private" },
          sender: { channel: "telegram", userId: "user" },
        });
      },
      async stopPolling() { events.push("stop"); },
      async send(_payload: ChannelOutboundPayload) { events.push("send"); },
      async sendText(_address: ChannelRouteAddress, _text: string) { events.push("text"); },
      async sendDocument(_address: ChannelRouteAddress, _file: ChannelOutboundFile) { events.push("doc"); },
      async sendImage(_address: ChannelRouteAddress, _file: ChannelOutboundFile) { events.push("image"); },
      async sendActivity() { events.push("activity"); },
      async answerAction() { events.push("answer"); },
    };

    const adapter = channelAdapterToMessengerAdapter({ kind: "telegram", instanceId: "personal" }, channelAdapter);
    const inbound: string[] = [];
    await adapter.startIngress?.(async (event) => { inbound.push(`${event.messenger.kind}:${event.messenger.instanceId}:${event.kind}`); });
    await adapter.sendText({ messenger: { kind: "telegram", instanceId: "personal" }, conversationId: "chat", userId: "user" }, "ok");
    await adapter.stopIngress?.();

    expect(adapter.ref).toEqual({ kind: "telegram", instanceId: "personal" });
    expect(inbound).toEqual(["telegram:personal:message"]);
    expect(events).toEqual(["start", "text", "stop"]);
  });

  it("creates Telegram, Discord, and Slack messenger adapters with per-instance refs", () => {
    const telegram = createTelegramMessengerAdapter({
      botToken: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      stateDir: "/tmp",
      pairingExpiryMs: 300000,
      busyDeliveryMode: "followUp",
      allowUserIds: [],
      summaryMode: "deterministic",
      maxTelegramMessageChars: 3900,
      sendRetryCount: 1,
      sendRetryBaseMs: 1,
      pollingTimeoutSeconds: 1,
      redactionPatterns: [],
      maxInboundImageBytes: 1,
      maxOutboundImageBytes: 1,
      maxLatestImages: 1,
      allowedImageMimeTypes: ["image/png"],
    }, "personal");
    const discord = createDiscordMessengerAdapter({ enabled: true, botToken: "discord-token" }, {
      async sendMessage() {},
      async sendFile() {},
      async sendTyping() {},
      async answerInteraction() {},
    }, "work");
    const slack = createSlackMessengerAdapter({ enabled: true, botToken: "xoxb-token", signingSecret: "secret" }, {
      async postMessage() {},
      async uploadFile() {},
      async postEphemeral() {},
    }, "team");

    expect([telegram.ref, discord.ref, slack.ref]).toEqual([
      { kind: "telegram", instanceId: "personal" },
      { kind: "discord", instanceId: "work" },
      { kind: "slack", instanceId: "team" },
    ]);
    expect(telegram.capabilities.maxTextChars).toBe(3900);
    expect(discord.capabilities.maxTextChars).toBe(2000);
    expect(slack.capabilities.maxTextChars).toBe(3000);
  });
});
