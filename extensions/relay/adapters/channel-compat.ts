import type { ChannelAdapter, ChannelInboundEvent, ChannelOutboundPayload, ChannelRouteAddress } from "../core/channel-adapter.js";
import type { MessengerAdapter, MessengerInboundHandler, RelayAddress, RelayInboundEvent, RelayOutboundPayload } from "../core/adapter-contracts.js";
import type { MessengerRef } from "../core/messenger-ref.js";

function relayAddressToChannel(address: RelayAddress): ChannelRouteAddress {
  return { channel: address.messenger.kind, conversationId: address.conversationId, userId: address.userId };
}

function relayOutboundToChannel(payload: RelayOutboundPayload): ChannelOutboundPayload {
  if (payload.kind === "action-answer") {
    return { ...payload, channel: payload.messenger.kind } as ChannelOutboundPayload;
  }
  return { ...payload, address: relayAddressToChannel(payload.address) } as ChannelOutboundPayload;
}

function channelInboundToRelay(ref: MessengerRef, event: ChannelInboundEvent): RelayInboundEvent {
  return {
    ...event,
    messenger: ref,
    conversation: { ...event.conversation, messenger: ref },
    sender: { ...event.sender, messenger: ref },
  } as RelayInboundEvent;
}

export function channelAdapterToMessengerAdapter(ref: MessengerRef, adapter: ChannelAdapter): MessengerAdapter {
  return {
    ref,
    displayName: adapter.displayName,
    capabilities: adapter.capabilities,
    metadata: adapter.metadata,
    startIngress: adapter.startPolling
      ? async (handler: MessengerInboundHandler) => adapter.startPolling?.(async (event) => handler(channelInboundToRelay(ref, event)))
      : undefined,
    stopIngress: adapter.stopPolling ? async () => adapter.stopPolling?.() : undefined,
    handleWebhook: adapter.handleWebhook
      ? async (payload, headers, handler) => adapter.handleWebhook?.(payload, headers, async (event) => handler(channelInboundToRelay(ref, event)))
      : undefined,
    send: async (payload) => adapter.send(relayOutboundToChannel(payload)),
    sendText: async (address, text, options) => adapter.sendText(relayAddressToChannel(address), text, options),
    sendDocument: async (address, file, options) => adapter.sendDocument(relayAddressToChannel(address), file, options),
    sendImage: async (address, file, options) => adapter.sendImage(relayAddressToChannel(address), file, options),
    sendActivity: async (address, activity) => adapter.sendActivity(relayAddressToChannel(address), activity),
    answerAction: async (actionId, options) => adapter.answerAction(actionId, options),
  };
}
