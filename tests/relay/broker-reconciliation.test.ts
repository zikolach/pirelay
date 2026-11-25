import { describe, expect, it } from "vitest";
import {
  normalizeBrokerReconciliationRequest,
  normalizeBrokerReconciliationResponse,
  synchronizationStateAfterConnect,
  synchronizationStateAfterDisconnect,
  synchronizationStateAfterResponse,
} from "../../extensions/relay/broker/reconciliation.js";
import { MAX_BROKER_RECONCILIATION_ROUTES } from "../../extensions/relay/broker/protocol.js";
import type { RelayRouteState } from "../../extensions/relay/core/relay-core.js";

function route(sessionKey = "session-1"): RelayRouteState {
  return {
    channel: "telegram",
    sessionKey,
    sessionId: sessionKey,
    sessionLabel: sessionKey,
    busy: false,
    notification: {},
  };
}

describe("broker route reconciliation contracts", () => {
  it("normalizes a bounded valid route snapshot", () => {
    expect(normalizeBrokerReconciliationRequest({ clientId: "client-1", routes: [route()] }, "epoch-1")).toEqual({
      ok: true,
      request: { clientId: "client-1", observedBrokerEpoch: undefined, routes: [route()] },
    });
  });

  it.each([
    undefined,
    {},
    { clientId: "", routes: [] },
    { clientId: "client-1", routes: "not-an-array" },
    { clientId: "client-1", routes: [{ ...route(), busy: "no" }] },
    { clientId: "client-1", routes: [{ ...route(), notification: null }] },
  ])("rejects malformed snapshots without reflecting input", (input) => {
    const result = normalizeBrokerReconciliationRequest(input, "epoch-1");
    expect(result).toMatchObject({ ok: false, rejection: { code: "invalid-request" } });
    if (!result.ok) expect(result.rejection.safeMessage).not.toContain("session-1");
  });

  it("accepts bounded non-Telegram channel descriptors", () => {
    const discordRoute = { ...route(), channel: "discord" as const };
    expect(normalizeBrokerReconciliationRequest({ clientId: "client-1", routes: [discordRoute] }, "epoch-1")).toMatchObject({ ok: true });
  });

  it("rejects snapshots over the route count limit", () => {
    const routes = Array.from({ length: MAX_BROKER_RECONCILIATION_ROUTES + 1 }, (_, index) => route(`session-${index}`));
    expect(normalizeBrokerReconciliationRequest({ clientId: "client-1", routes }, "epoch-1")).toMatchObject({
      ok: false,
      rejection: { code: "too-many-routes" },
    });
  });

  it("rejects oversized payloads before accepting descriptors", () => {
    const oversized = route();
    oversized.notification = { lastAssistantText: "x".repeat(300_000) };
    expect(normalizeBrokerReconciliationRequest({ clientId: "client-1", routes: [oversized] }, "epoch-1")).toMatchObject({
      ok: false,
      rejection: { code: "payload-too-large" },
    });
  });

  it("rejects duplicate routes atomically", () => {
    expect(normalizeBrokerReconciliationRequest({ clientId: "client-1", routes: [route(), route()] }, "epoch-1")).toMatchObject({
      ok: false,
      rejection: { index: 1, code: "duplicate-route" },
    });
  });

  it("rejects stale observed broker epochs", () => {
    expect(normalizeBrokerReconciliationRequest({ clientId: "client-1", observedBrokerEpoch: "epoch-old", routes: [route()] }, "epoch-new")).toMatchObject({
      ok: false,
      rejection: { code: "stale-epoch" },
    });
  });

  it("normalizes only bounded typed reconciliation responses", () => {
    expect(normalizeBrokerReconciliationResponse({ brokerEpoch: "epoch-1", acceptedSessionKeys: ["session-1"], rejected: [] })).toEqual({ brokerEpoch: "epoch-1", acceptedSessionKeys: ["session-1"], rejected: [] });
    expect(normalizeBrokerReconciliationResponse({ brokerEpoch: "epoch-1", acceptedSessionKeys: [], rejected: [{ index: 0, code: "stale-owner", safeMessage: "A newer broker client owns this route." }] })).toMatchObject({ rejected: [{ code: "stale-owner" }] });
    expect(normalizeBrokerReconciliationResponse({ brokerEpoch: "epoch-1", acceptedSessionKeys: ["session-1", "session-1"], rejected: [] })).toBeUndefined();
    expect(normalizeBrokerReconciliationResponse({ brokerEpoch: "epoch-1", acceptedSessionKeys: [], rejected: [{ code: "unknown", safeMessage: "no" }] })).toBeUndefined();
  });

  it("tracks transport and per-route health within the acknowledged epoch", () => {
    const pending = synchronizationStateAfterConnect(["session-1", "session-2"]);
    expect(pending).toEqual({ transport: "connected", brokerEpoch: undefined, routes: { "session-1": "pending", "session-2": "pending" } });

    const synchronized = synchronizationStateAfterResponse(["session-1", "session-2"], {
      brokerEpoch: "epoch-2",
      acceptedSessionKeys: ["session-1"],
      rejected: [],
    });
    expect(synchronized).toEqual({ transport: "connected", brokerEpoch: "epoch-2", routes: { "session-1": "synchronized", "session-2": "missing" } });

    expect(synchronizationStateAfterDisconnect(["session-1", "session-2"])).toEqual({
      transport: "reconnecting",
      routes: { "session-1": "unknown", "session-2": "unknown" },
    });
  });

  it("maps indexed rejections back to request-order routes", () => {
    expect(synchronizationStateAfterResponse(["session-1", "session-2"], {
      brokerEpoch: "epoch-2",
      acceptedSessionKeys: ["session-1"],
      rejected: [{ index: 1, code: "invalid-request", safeMessage: "Invalid route." }],
    })).toMatchObject({ routes: { "session-1": "synchronized", "session-2": "rejected" } });
  });

  it("marks unacknowledged routes rejected for a general safe rejection", () => {
    expect(synchronizationStateAfterResponse(["session-1"], {
      brokerEpoch: "epoch-2",
      acceptedSessionKeys: [],
      rejected: [{ code: "invalid-request", safeMessage: "Invalid broker reconciliation request." }],
    })).toMatchObject({ routes: { "session-1": "rejected" } });
  });
});
