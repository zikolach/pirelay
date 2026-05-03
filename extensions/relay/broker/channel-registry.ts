import type { ChannelAdapter, ChannelAdapterKind } from "../core/channel-adapter.js";
import { DiscordChannelAdapter, type DiscordApiOperations } from "../adapters/discord/adapter.js";
import { SlackChannelAdapter, type SlackApiOperations } from "../adapters/slack/adapter.js";
import { TelegramChannelAdapter, type TelegramApiOperations } from "../adapters/telegram/adapter.js";
import type { TelegramTunnelConfig } from "../core/types.js";

export interface ChannelAdapterOperations {
  telegram?: TelegramApiOperations;
  discord?: DiscordApiOperations;
  slack?: SlackApiOperations;
}

export function enabledChannelKinds(config: TelegramTunnelConfig): ChannelAdapterKind[] {
  const kinds: ChannelAdapterKind[] = ["telegram"];
  if (config.discord?.enabled && config.discord.botToken) kinds.push("discord");
  if (config.slack?.enabled && config.slack.botToken && config.slack.signingSecret) kinds.push("slack");
  return kinds;
}

export function createEnabledChannelAdapters(config: TelegramTunnelConfig, operations: ChannelAdapterOperations = {}): ChannelAdapter[] {
  const adapters: ChannelAdapter[] = [new TelegramChannelAdapter(config, operations.telegram)];
  if (config.discord?.enabled && config.discord.botToken && operations.discord) {
    adapters.push(new DiscordChannelAdapter(config.discord, operations.discord));
  }
  if (config.slack?.enabled && config.slack.botToken && config.slack.signingSecret && operations.slack) {
    adapters.push(new SlackChannelAdapter(config.slack, operations.slack));
  }
  return adapters;
}

export function channelBindingStorageKey(channel: ChannelAdapterKind, sessionKey: string): string {
  return `${channel}:${sessionKey}`;
}
