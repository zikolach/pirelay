import { describe, expect, it } from "vitest";
import { formatRelayStatusLine } from "../../extensions/relay/runtime/status-line.js";

describe("relay status line formatting", () => {
  it("formats off, ready, and error states", () => {
    expect(formatRelayStatusLine({ channel: "slack", configured: false })).toBe("slack: off");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: true })).toBe("slack: ready unpaired");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: false })).toBe("slack: starting");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, error: "boom\nwith detail" })).toBe("slack error: boom with detail");
  });

  it("formats paired and paused states without identifiers", () => {
    expect(formatRelayStatusLine({ channel: "telegram", configured: true, runtimeStarted: true, binding: { conversationKind: "private" } })).toBe("telegram: paired dm");
    expect(formatRelayStatusLine({ channel: "discord", configured: true, runtimeStarted: true, binding: { conversationKind: "channel" } })).toBe("discord: paired channel");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: true, binding: { paused: true, conversationKind: "im" } })).toBe("slack: paused dm");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: true, binding: { conversationKind: "C123456" } })).toBe("slack: paired");
  });
});
