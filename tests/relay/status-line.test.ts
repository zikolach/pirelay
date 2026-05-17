import { describe, expect, it } from "vitest";
import { formatRelayStatusLine } from "../../extensions/relay/runtime/status-line.js";

describe("relay status line formatting", () => {
  it("formats compact off, unpaired, starting, and error states", () => {
    expect(formatRelayStatusLine({ channel: "slack", configured: false })).toBe("sl ○");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: true })).toBe("sl ◇");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: false })).toBe("sl ◌");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, error: "boom\nwith detail" })).toBe("sl ✖");
  });

  it("keeps only useful paired/paused details", () => {
    expect(formatRelayStatusLine({ channel: "telegram", configured: true, runtimeStarted: true, binding: { conversationKind: "private" } })).toBe("tg ● ✉");
    expect(formatRelayStatusLine({ channel: "discord", configured: true, runtimeStarted: true, binding: { conversationKind: "channel" } })).toBe("dc ● #");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: true, binding: { paused: true, conversationKind: "im" } })).toBe("sl Ⅱ ✉");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: true, binding: { conversationKind: "C123456" } })).toBe("sl ●");
  });

  it("applies status tones to the full segment", () => {
    const colorize = (tone: string, text: string) => `<${tone}>${text}</${tone}>`;

    expect(formatRelayStatusLine({ channel: "telegram", configured: true, runtimeStarted: true }, { colorize })).toBe("<muted>tg ◇</muted>");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, runtimeStarted: false }, { colorize })).toBe("<accent>sl ◌</accent>");
    expect(formatRelayStatusLine({ channel: "discord", configured: true, binding: {} }, { colorize })).toBe("<success>dc ●</success>");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, binding: { paused: true } }, { colorize })).toBe("<warning>sl Ⅱ</warning>");
    expect(formatRelayStatusLine({ channel: "slack", configured: true, error: "boom" }, { colorize })).toBe("<error>sl ✖</error>");
  });
});
