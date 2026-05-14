import { describe, expect, it } from "vitest";
import { relayRouteStateForRoute, statusSnapshotForRoute } from "../extensions/relay/core/relay-core.js";
import type { SessionRoute } from "../extensions/relay/core/types.js";

function route(): SessionRoute {
  return {
    sessionKey: "s:/tmp/s.jsonl",
    sessionId: "s",
    sessionFile: "/tmp/s.jsonl",
    sessionLabel: "session",
    lastActivityAt: 123,
    notification: { lastStatus: "running" },
    actions: {
      context: { isIdle: () => false } as never,
      getModel: () => ({ provider: "test", id: "model-with-image", input: ["text", "image"] }) as never,
      sendUserMessage: () => undefined,
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "missing" }),
      appendAudit: () => undefined,
      persistBinding: () => undefined,
      promptLocalConfirmation: async () => true,
      abort: () => undefined,
      compact: async () => undefined,
    },
  };
}

describe("relay core route helpers", () => {
  it("builds channel-neutral route state for broker synchronization", () => {
    expect(relayRouteStateForRoute(route(), { channel: "telegram", busy: true })).toMatchObject({
      channel: "telegram",
      sessionKey: "s:/tmp/s.jsonl",
      busy: true,
      modelId: "test/model-with-image",
      imageInputSupported: true,
      notification: { lastStatus: "running" },
    });
  });

  it("builds runtime status snapshots without channel transport details", () => {
    expect(statusSnapshotForRoute(route(), { online: true, busy: false })).toMatchObject({
      sessionKey: "s:/tmp/s.jsonl",
      online: true,
      busy: false,
      modelId: "test/model-with-image",
    });
  });

  it("marks unavailable routes offline when busy is not supplied", () => {
    const unavailable = route();
    unavailable.actions.isIdle = () => undefined;

    expect(statusSnapshotForRoute(unavailable, { online: true })).toMatchObject({ online: false, busy: false });
    expect(relayRouteStateForRoute(unavailable, { channel: "telegram" })).toMatchObject({ busy: false });
  });
});
