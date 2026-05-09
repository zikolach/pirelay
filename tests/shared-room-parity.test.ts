import { describe, expect, it } from "vitest";
import { telegramCapabilities, telegramMessageSharedRoomAddressing, telegramUpdateToChannelEvent } from "../extensions/relay/adapters/telegram/adapter.js";
import { discordCapabilities } from "../extensions/relay/adapters/discord/adapter.js";
import { slackCapabilities, slackMessageSharedRoomAddressing } from "../extensions/relay/adapters/slack/adapter.js";
import type { TelegramTunnelConfig } from "../extensions/relay/core/types.js";

function telegramConfig(): TelegramTunnelConfig {
  return {
    botToken: "token",
    stateDir: "/tmp/pi-telegram-test",
    pairingExpiryMs: 300_000,
    busyDeliveryMode: "followUp",
    allowUserIds: [],
    summaryMode: "deterministic",
    maxTelegramMessageChars: 3900,
    sendRetryCount: 1,
    sendRetryBaseMs: 1,
    pollingTimeoutSeconds: 1,
    redactionPatterns: [],
    maxInboundImageBytes: 100,
    maxOutboundImageBytes: 200,
    maxLatestImages: 2,
    allowedImageMimeTypes: ["image/png"],
  };
}

describe("shared-room platform parity declarations", () => {
  it("classifies Telegram and Slack local, remote, ambiguous, and no-target mentions", () => {
    expect(telegramMessageSharedRoomAddressing("/status@PiLaptopBot", "PiLaptopBot")).toEqual({ kind: "local" });
    expect(telegramMessageSharedRoomAddressing("/status@PiDesktopBot", "PiLaptopBot")).toEqual({ kind: "remote", selector: "PiDesktopBot" });
    expect(telegramMessageSharedRoomAddressing("hi @PiLaptopBot @PiDesktopBot", "PiLaptopBot")).toEqual({ kind: "ambiguous", reason: "multiple bot mentions" });
    expect(telegramMessageSharedRoomAddressing("hi", "PiLaptopBot")).toEqual({ kind: "none" });

    expect(slackMessageSharedRoomAddressing("hi <@U123>", "U123")).toEqual({ kind: "local" });
    expect(slackMessageSharedRoomAddressing("hi <@U456>", "U123")).toEqual({ kind: "remote", selector: "U456" });
    expect(slackMessageSharedRoomAddressing("hi <@U123> <@U456>", "U123")).toEqual({ kind: "ambiguous", reason: "multiple bot mentions" });
    expect(slackMessageSharedRoomAddressing("hi", "U123")).toEqual({ kind: "none" });
  });

  it("preserves Telegram bot-authored sender metadata for loop prevention", () => {
    const event = telegramUpdateToChannelEvent({
      kind: "message",
      updateId: 1,
      messageId: 2,
      text: "/sessions@PiLaptopBot",
      chat: { id: -1001, type: "supergroup" },
      user: { id: 777, username: "PeerBot", firstName: "Peer", isBot: true },
    });

    expect(event.sender.metadata).toMatchObject({ isBot: true });
    expect(event.metadata).toMatchObject({ botMentions: ["PiLaptopBot"] });
  });

  it("keeps Slack shared-room runtime capabilities explicit when channel messages are enabled", () => {
    expect(telegramCapabilities(telegramConfig()).sharedRooms).toMatchObject({
      ordinaryText: false,
      mentions: true,
      platformCommands: true,
      mediaAttachments: true,
    });
    expect(discordCapabilities({ allowGuildChannels: true }).sharedRooms).toMatchObject({
      ordinaryText: true,
      mentions: true,
      platformCommands: true,
    });
    expect(slackCapabilities({ allowChannelMessages: true }).sharedRooms).toMatchObject({
      ordinaryText: false,
      mentions: true,
      platformCommands: false,
      mediaAttachments: false,
    });
  });
});
