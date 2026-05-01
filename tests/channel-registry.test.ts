import { describe, expect, it } from "vitest";
import { channelBindingStorageKey, createEnabledChannelAdapters, enabledChannelKinds } from "../extensions/telegram-tunnel/channel-registry.js";
import type { TelegramTunnelConfig } from "../extensions/telegram-tunnel/types.js";

const config: TelegramTunnelConfig = {
  botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  stateDir: "/tmp/pirelay",
  pairingExpiryMs: 300_000,
  busyDeliveryMode: "followUp",
  allowUserIds: [],
  summaryMode: "deterministic",
  maxTelegramMessageChars: 3900,
  sendRetryCount: 1,
  sendRetryBaseMs: 1,
  pollingTimeoutSeconds: 1,
  redactionPatterns: [],
  maxInboundImageBytes: 1024,
  maxOutboundImageBytes: 1024,
  maxLatestImages: 4,
  allowedImageMimeTypes: ["image/png"],
  discord: { enabled: true, botToken: "discord", allowUserIds: ["u1"] },
  slack: { enabled: true, botToken: "xoxb", signingSecret: "secret", workspaceId: "T1", allowUserIds: ["U1"] },
};

describe("channel registry", () => {
  it("creates enabled adapters without cross-channel state keys colliding", () => {
    const adapters = createEnabledChannelAdapters(config, {
      discord: { sendMessage: async () => undefined, sendFile: async () => undefined, sendTyping: async () => undefined, answerInteraction: async () => undefined },
      slack: { postMessage: async () => undefined, uploadFile: async () => undefined, postEphemeral: async () => undefined },
    });

    expect(adapters.map((adapter) => adapter.id)).toEqual(["telegram", "discord", "slack"]);
    expect(enabledChannelKinds(config)).toEqual(["telegram", "discord", "slack"]);
    expect(channelBindingStorageKey("telegram", "session-1")).toBe("telegram:session-1");
    expect(channelBindingStorageKey("discord", "session-1")).toBe("discord:session-1");
    expect(channelBindingStorageKey("slack", "session-1")).toBe("slack:session-1");
  });
});
