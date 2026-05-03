import { describe, expect, it } from "vitest";
import { BrokerRouteRegistry, createSharedSecretPeerAuthenticator, federationMessageContainsSecretLikeValue } from "../../extensions/relay/broker/index.js";
import type { BrokerFederationMessage, BrokerRouteRegistration } from "../../extensions/relay/broker/index.js";
import type { RelaySessionRouteDescriptor } from "../../extensions/relay/core/index.js";

const telegram = { kind: "telegram", instanceId: "default" };
const route: RelaySessionRouteDescriptor = {
  sessionKey: "session-1:/tmp/session.json",
  sessionId: "session-1",
  machineId: "laptop",
  sessionFile: "/tmp/session.json",
  sessionLabel: "Docs",
  online: true,
  turnState: "idle",
  bindings: [],
};

const registration: BrokerRouteRegistration = {
  protocolVersion: 1,
  route,
  messengerRefs: [telegram],
  registeredAt: "2026-05-02T12:00:00.000Z",
};

describe("broker route federation", () => {
  it("registers local and remote routes by messenger", () => {
    const registry = new BrokerRouteRegistry();
    registry.registerLocalRoute(route, [telegram], "2026-05-02T12:00:00.000Z");
    registry.registerRemoteRoute({ ...registration, route: { ...route, sessionKey: "session-2", machineId: "cloud" } });

    expect(registry.listForMessenger(telegram).map((record) => record.route.sessionKey).sort()).toEqual(["session-1:/tmp/session.json", "session-2"]);
    expect(registry.get("session-2")?.local).toBe(false);
    expect(registry.markMachineOffline("cloud")).toEqual(["session-2"]);
    expect(registry.get("session-2")).toBeUndefined();
  });

  it("signs and verifies authenticated peer messages", () => {
    const laptop = createSharedSecretPeerAuthenticator({ localPeerId: "laptop", peerSecrets: { cloud: "shared-secret" } });
    const cloud = createSharedSecretPeerAuthenticator({ localPeerId: "cloud", peerSecrets: { laptop: "shared-secret" } });
    const message: BrokerFederationMessage = { kind: "route-register", registration };

    const envelope = laptop.sign("cloud", message, { sentAt: "2026-05-02T12:00:00.000Z", nonce: "n1" });
    expect(cloud.verify(envelope)).toEqual(message);
    expect(cloud.verify({ ...envelope, signature: "00".repeat(32) })).toBeUndefined();
  });

  it("can detect secret-shaped values before federation logging", () => {
    expect(federationMessageContainsSecretLikeValue({ kind: "route-register", registration })).toBe(false);
    expect(federationMessageContainsSecretLikeValue({
      kind: "peer-offline",
      machineId: "laptop",
      reason: "Telegram failed with 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      at: "2026-05-02T12:00:00.000Z",
    })).toBe(true);
  });
});
