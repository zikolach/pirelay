import type { ChannelBinding, ChannelInboundMessage } from "./channel-adapter.js";
import { discordPairingCommand, isDiscordIdentityAllowed } from "./discord-adapter.js";
import { isSlackIdentityAllowed, slackPairingCommand } from "./slack-adapter.js";
import type { DiscordRelayConfig, PendingPairingRecord, SlackRelayConfig } from "./types.js";

export type ChannelPairingResult =
  | { ok: true; binding: ChannelBinding }
  | { ok: false; reason: "wrong-channel" | "unsupported-conversation" | "unauthorized" | "command-mismatch" | "expired" };

export function discordPairingInstruction(code: string): string {
  return `Send ${discordPairingCommand(code)} to the Discord bot in a DM before the pairing expires.`;
}

export function slackPairingInstruction(code: string): string {
  return `Send ${slackPairingCommand(code)} to the Slack app in a DM before the pairing expires.`;
}

export function completeDiscordPairing(
  event: ChannelInboundMessage,
  pairing: PendingPairingRecord,
  code: string,
  config: Pick<DiscordRelayConfig, "allowUserIds" | "allowGuildChannels" | "allowGuildIds">,
  now = Date.now(),
): ChannelPairingResult {
  if (event.channel !== "discord") return { ok: false, reason: "wrong-channel" };
  if (event.conversation.kind !== "private" && !config.allowGuildChannels) return { ok: false, reason: "unsupported-conversation" };
  if (!isDiscordIdentityAllowed(event.sender, config)) return { ok: false, reason: "unauthorized" };
  return completeChannelPairing(event, pairing, discordPairingCommand(code), now);
}

export function completeSlackPairing(
  event: ChannelInboundMessage,
  pairing: PendingPairingRecord,
  code: string,
  config: Pick<SlackRelayConfig, "allowUserIds" | "allowChannelMessages" | "workspaceId">,
  now = Date.now(),
): ChannelPairingResult {
  if (event.channel !== "slack") return { ok: false, reason: "wrong-channel" };
  if (event.conversation.kind !== "private" && !config.allowChannelMessages) return { ok: false, reason: "unsupported-conversation" };
  if (!isSlackIdentityAllowed(event.sender, config)) return { ok: false, reason: "unauthorized" };
  return completeChannelPairing(event, pairing, slackPairingCommand(code), now);
}

function completeChannelPairing(
  event: ChannelInboundMessage,
  pairing: PendingPairingRecord,
  expectedCommand: string,
  now: number,
): ChannelPairingResult {
  if (Date.parse(pairing.expiresAt) <= now || pairing.consumedAt) return { ok: false, reason: "expired" };
  if (event.text.trim() !== expectedCommand) return { ok: false, reason: "command-mismatch" };
  return {
    ok: true,
    binding: {
      channel: event.channel,
      conversationId: event.conversation.id,
      userId: event.sender.userId,
      sessionKey: pairing.sessionKey,
      sessionId: pairing.sessionId,
      sessionFile: pairing.sessionFile,
      sessionLabel: pairing.sessionLabel,
      boundAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      identity: {
        username: event.sender.username,
        displayName: event.sender.displayName,
        firstName: event.sender.firstName,
        lastName: event.sender.lastName,
        metadata: event.sender.metadata,
      },
      metadata: {
        conversationKind: event.conversation.kind,
        conversationTitle: event.conversation.title,
        conversationMetadata: event.conversation.metadata,
      },
    },
  };
}
