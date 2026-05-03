import { DiscordChannelAdapter, type DiscordApiOperations } from "./adapter.js";
import { channelAdapterToMessengerAdapter } from "../channel-compat.js";
import type { MessengerAdapter } from "../../core/adapter-contracts.js";
import type { DiscordRelayConfig } from "../../core/types.js";

export * from "./adapter.js";
export * from "./live-client.js";
export * from "./runtime.js";

export function createDiscordMessengerAdapter(config: DiscordRelayConfig, api: DiscordApiOperations, instanceId = "default"): MessengerAdapter {
  return channelAdapterToMessengerAdapter({ kind: "discord", instanceId }, new DiscordChannelAdapter(config, api));
}
