import { describe, expect, it } from "vitest";
import { completeDiscordPairing, completeSlackPairing, discordPairingInstruction, slackPairingInstruction } from "../extensions/telegram-tunnel/channel-pairing.js";
import type { ChannelInboundMessage } from "../extensions/telegram-tunnel/channel-adapter.js";
import type { PendingPairingRecord } from "../extensions/telegram-tunnel/types.js";

const pairing: PendingPairingRecord = {
  nonceHash: "hash",
  sessionKey: "session:/tmp/session.jsonl",
  sessionId: "session",
  sessionFile: "/tmp/session.jsonl",
  sessionLabel: "docs",
  createdAt: "2026-05-01T00:00:00.000Z",
  expiresAt: "2026-05-01T00:10:00.000Z",
};

function message(channel: "discord" | "slack", text: string, overrides: Partial<ChannelInboundMessage> = {}): ChannelInboundMessage {
  return {
    kind: "message",
    channel,
    updateId: "u1",
    messageId: "m1",
    text,
    attachments: [],
    conversation: { channel, id: channel === "discord" ? "D1" : "S1", kind: "private" },
    sender: { channel, userId: channel === "discord" ? "du1" : "su1", username: "user", metadata: channel === "slack" ? { teamId: "T1" } : undefined },
    ...overrides,
  };
}

describe("channel pairing", () => {
  it("creates Discord bindings from authorized DM pairing commands", () => {
    const result = completeDiscordPairing(message("discord", "/start abc"), pairing, "abc", { allowUserIds: ["du1"] }, Date.parse("2026-05-01T00:01:00.000Z"));

    expect(result).toMatchObject({ ok: true, binding: { channel: "discord", conversationId: "D1", userId: "du1", sessionKey: pairing.sessionKey, sessionLabel: "docs" } });
    expect(discordPairingInstruction("abc")).toContain("/start abc");
  });

  it("rejects Discord guild pairing by default", () => {
    const result = completeDiscordPairing(message("discord", "/start abc", { conversation: { channel: "discord", id: "C1", kind: "group" } }), pairing, "abc", { allowUserIds: ["du1"], allowGuildChannels: false });

    expect(result).toEqual({ ok: false, reason: "unsupported-conversation" });
  });

  it("creates Slack bindings from authorized workspace DM pairing commands", () => {
    const result = completeSlackPairing(message("slack", "/pirelay abc"), pairing, "abc", { allowUserIds: ["su1"], workspaceId: "T1" }, Date.parse("2026-05-01T00:01:00.000Z"));

    expect(result).toMatchObject({ ok: true, binding: { channel: "slack", conversationId: "S1", userId: "su1", sessionKey: pairing.sessionKey } });
    expect(slackPairingInstruction("abc")).toContain("/pirelay abc");
  });

  it("rejects expired or mismatched pairing commands", () => {
    expect(completeSlackPairing(message("slack", "/pirelay wrong"), pairing, "abc", {}, Date.parse("2026-05-01T00:01:00.000Z"))).toEqual({ ok: false, reason: "command-mismatch" });
    expect(completeSlackPairing(message("slack", "/pirelay abc"), pairing, "abc", {}, Date.parse("2026-05-01T00:11:00.000Z"))).toEqual({ ok: false, reason: "expired" });
  });
});
