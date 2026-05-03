import { SlackChannelAdapter, type SlackApiOperations } from "./adapter.js";
import { channelAdapterToMessengerAdapter } from "../channel-compat.js";
import type { MessengerAdapter } from "../../core/adapter-contracts.js";
import type { SlackRelayConfig } from "../../core/types.js";

export * from "./adapter.js";

export function createSlackMessengerAdapter(config: SlackRelayConfig, api: SlackApiOperations, instanceId = "default"): MessengerAdapter {
  return channelAdapterToMessengerAdapter({ kind: "slack", instanceId }, new SlackChannelAdapter(config, api));
}
