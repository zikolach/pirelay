import type { ChannelAdapter, ChannelAdapterKind, ChannelInboundEvent, ChannelInboundHandler } from "./channel-adapter.js";
import { channelBindingStorageKey } from "./channel-registry.js";

export interface ChannelRelayBrokerRegistration {
  adapter: ChannelAdapter;
  started: boolean;
}

export class ChannelRelayBroker {
  private readonly adapters = new Map<ChannelAdapterKind, ChannelRelayBrokerRegistration>();

  constructor(adapters: ChannelAdapter[] = []) {
    for (const adapter of adapters) this.registerAdapter(adapter);
  }

  registerAdapter(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Channel adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, { adapter, started: false });
  }

  getAdapter(kind: ChannelAdapterKind): ChannelAdapter | undefined {
    return this.adapters.get(kind)?.adapter;
  }

  listAdapters(): ChannelAdapter[] {
    return [...this.adapters.values()].map((registration) => registration.adapter);
  }

  bindingKey(kind: ChannelAdapterKind, sessionKey: string): string {
    return channelBindingStorageKey(kind, sessionKey);
  }

  async start(handler: ChannelInboundHandler): Promise<void> {
    await Promise.all([...this.adapters.values()].map(async (registration) => {
      if (registration.started || !registration.adapter.startPolling) return;
      registration.started = true;
      try {
        await registration.adapter.startPolling(async (event: ChannelInboundEvent) => {
          if (event.channel !== registration.adapter.id) {
            throw new Error(`Adapter ${registration.adapter.id} emitted ${event.channel} event.`);
          }
          await handler(event);
        });
      } catch (error) {
        registration.started = false;
        throw error;
      }
    }));
  }

  async stop(): Promise<void> {
    await Promise.all([...this.adapters.values()].map(async (registration) => {
      if (!registration.started) return;
      registration.started = false;
      await registration.adapter.stopPolling?.();
    }));
  }
}
