import { describe, expect, it } from "vitest";
import { BrokerRouteRegistry, FederatedDeliveryRouter } from "../../extensions/relay/broker/index.js";
import type { BrokerFederationMessage, BrokerPeerMessageTransport } from "../../extensions/relay/broker/index.js";
import type { RelayInboundEvent, RelayOutboundPayload, RelaySessionRouteDescriptor } from "../../extensions/relay/core/index.js";

const messenger = { kind: "telegram", instanceId: "default" };
const remoteRoute: RelaySessionRouteDescriptor = {
  sessionKey: "remote-session",
  sessionId: "remote-session",
  machineId: "cloud",
  sessionLabel: "Cloud",
  online: true,
  turnState: "idle",
  bindings: [],
};
const event: RelayInboundEvent = {
  kind: "message",
  messenger,
  updateId: "u1",
  messageId: "m1",
  text: "hello",
  attachments: [],
  conversation: { messenger, id: "chat", kind: "private" },
  sender: { messenger, userId: "user" },
};
const payload: RelayOutboundPayload = {
  kind: "text",
  address: { messenger, conversationId: "chat", userId: "user" },
  text: "done",
};

describe("federated delivery router", () => {
  it("forwards prompts and outbound notifications to remote route owners", async () => {
    const registry = new BrokerRouteRegistry();
    registry.registerRemoteRoute({ protocolVersion: 1, route: remoteRoute, messengerRefs: [messenger], registeredAt: "2026-05-02T12:00:00.000Z" });
    const sent: Array<{ machineId: string; message: BrokerFederationMessage }> = [];
    const transport: BrokerPeerMessageTransport = { send: async (machineId, message) => { sent.push({ machineId, message }); } };
    const router = new FederatedDeliveryRouter(registry, transport);

    await expect(router.deliverPrompt({ targetSessionKey: "remote-session", ingressMessenger: messenger, event, requestedAt: "now" })).resolves.toEqual({
      status: "forwarded",
      sessionKey: "remote-session",
      machineId: "cloud",
    });
    await expect(router.forwardOutbound({ sourceSessionKey: "remote-session", payload, requestedAt: "now" })).resolves.toMatchObject({ status: "forwarded" });
    expect(sent.map((item) => item.message.kind)).toEqual(["prompt-deliver", "outbound-deliver"]);
  });

  it("forwards terminal completion, failure, and abort notifications through the ingress owner", async () => {
    const registry = new BrokerRouteRegistry();
    registry.registerRemoteRoute({ protocolVersion: 1, route: remoteRoute, messengerRefs: [messenger], registeredAt: "2026-05-02T12:00:00.000Z" });
    const sent: BrokerFederationMessage[] = [];
    const router = new FederatedDeliveryRouter(registry, { send: async (_machineId, message) => { sent.push(message); } });

    for (const status of ["completed", "failed", "aborted"] as const) {
      await expect(router.forwardOutbound({
        sourceSessionKey: "remote-session",
        payload: { ...payload, text: `Pi task ${status}.`, metadata: { status } },
        requestedAt: status,
      })).resolves.toMatchObject({ status: "forwarded", machineId: "cloud" });
    }

    expect(sent).toHaveLength(3);
    expect(sent.map((message) => message.kind)).toEqual(["outbound-deliver", "outbound-deliver", "outbound-deliver"]);
    expect(sent.map((message) => message.kind === "outbound-deliver" ? message.outbound.payload.metadata?.status : undefined)).toEqual(["completed", "failed", "aborted"]);
  });

  it("returns local for routes owned by this broker", async () => {
    const registry = new BrokerRouteRegistry();
    registry.registerLocalRoute({ ...remoteRoute, machineId: "laptop" }, [messenger]);
    const router = new FederatedDeliveryRouter(registry, { send: async () => { throw new Error("should not send"); } });

    await expect(router.deliverPrompt({ targetSessionKey: "remote-session", ingressMessenger: messenger, event })).resolves.toEqual({
      status: "local",
      sessionKey: "remote-session",
    });
  });

  it("reports offline when a route is missing or peer transport fails", async () => {
    const registry = new BrokerRouteRegistry();
    const router = new FederatedDeliveryRouter(registry, { send: async () => {} });
    await expect(router.deliverPrompt({ targetSessionKey: "missing", ingressMessenger: messenger, event })).resolves.toMatchObject({ status: "offline" });

    registry.registerRemoteRoute({ protocolVersion: 1, route: remoteRoute, messengerRefs: [messenger], registeredAt: "2026-05-02T12:00:00.000Z" });
    const failing = new FederatedDeliveryRouter(registry, { send: async () => { throw new Error("peer offline"); } });
    await expect(failing.deliverPrompt({ targetSessionKey: "remote-session", ingressMessenger: messenger, event })).resolves.toMatchObject({ status: "offline", reason: "peer offline" });
  });

  it("supports failover refresh by removing stale machine routes and registering new owner routes", () => {
    const registry = new BrokerRouteRegistry();
    registry.registerRemoteRoute({ protocolVersion: 1, route: remoteRoute, messengerRefs: [messenger], registeredAt: "old" });
    expect(registry.markMachineOffline("cloud")).toEqual(["remote-session"]);
    registry.registerRemoteRoute({ protocolVersion: 1, route: { ...remoteRoute, machineId: "backup" }, messengerRefs: [messenger], registeredAt: "new" });
    expect(registry.get("remote-session")?.ownerMachineId).toBe("backup");
  });
});
