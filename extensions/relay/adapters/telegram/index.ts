import { TelegramChannelAdapter } from "./adapter.js";
import { channelAdapterToMessengerAdapter } from "../channel-compat.js";
import type { MessengerAdapter } from "../../core/adapter-contracts.js";
import type { TelegramTunnelConfig } from "../../core/types.js";

export * from "./adapter.js";
export * from "./api.js";
export * from "./actions.js";
export * from "./formatting.js";
export * from "./runtime.js";

export function createTelegramMessengerAdapter(config: TelegramTunnelConfig, instanceId = "default"): MessengerAdapter {
  return channelAdapterToMessengerAdapter({ kind: "telegram", instanceId }, new TelegramChannelAdapter(config));
}
