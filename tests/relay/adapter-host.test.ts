import { describe, expect, it } from "vitest";
import { MessengerAdapterHost, planMessengerAdapterLifecycles } from "../../extensions/relay/broker/index.js";
import type { MessengerAdapter, MessengerInboundHandler, RelayOutboundFile, RelayOutboundPayload, RelayAddress } from "../../extensions/relay/core/index.js";

function fakeAdapter(kind: string, instanceId: string, events: string[]): MessengerAdapter {
  return {
    ref: { kind, instanceId },
    displayName: `${kind}:${instanceId}`,
    capabilities: {
      inlineButtons: true,
      textMessages: true,
      documents: true,
      images: true,
      activityIndicators: true,
      callbacks: true,
      privateChats: true,
      groupChats: false,
      maxTextChars: 1000,
      supportedImageMimeTypes: ["image/png"],
    },
    async startIngress(_handler: MessengerInboundHandler) { events.push(`start:${kind}:${instanceId}`); },
    async stopIngress() { events.push(`stop:${kind}:${instanceId}`); },
    async send(_payload: RelayOutboundPayload) {},
    async sendText(_address: RelayAddress, _text: string) {},
    async sendDocument(_address: RelayAddress, _file: RelayOutboundFile) {},
    async sendImage(_address: RelayAddress, _file: RelayOutboundFile) {},
    async sendActivity() {},
    async answerAction() {},
  };
}

describe("messenger adapter host", () => {
  it("plans only owned enabled adapters for startup", () => {
    const events: string[] = [];
    const plan = planMessengerAdapterLifecycles([
      {
        ref: { kind: "telegram", instanceId: "default" },
        enabled: true,
        token: "telegram-token",
        adapter: fakeAdapter("telegram", "default", events),
        ownership: { localMachineId: "laptop", policy: { kind: "owner", machineId: "laptop" } },
      },
      {
        ref: { kind: "discord", instanceId: "default" },
        enabled: true,
        token: "discord-token",
        adapter: fakeAdapter("discord", "default", events),
        ownership: { localMachineId: "laptop", policy: { kind: "owner", machineId: "cloud" } },
      },
    ]);

    expect(plan.map((item) => item.kind)).toEqual(["start", "skip"]);
  });

  it("starts and stops only owned ingress adapters", async () => {
    const events: string[] = [];
    const host = new MessengerAdapterHost([
      {
        ref: { kind: "telegram", instanceId: "default" },
        enabled: true,
        token: "telegram-token",
        adapter: fakeAdapter("telegram", "default", events),
        ownership: { localMachineId: "laptop", policy: { kind: "owner", machineId: "laptop" } },
      },
      {
        ref: { kind: "discord", instanceId: "default" },
        enabled: false,
        token: "discord-token",
        adapter: fakeAdapter("discord", "default", events),
        ownership: { localMachineId: "laptop", policy: { kind: "auto" } },
      },
    ]);

    await host.startOwnedIngress(async () => {});
    expect(host.startedRefs()).toEqual(["telegram"]);
    await host.stopStartedIngress();
    expect(events).toEqual(["start:telegram:default", "stop:telegram:default"]);
  });
});
