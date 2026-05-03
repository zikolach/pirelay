import { describe, expect, it } from "vitest";
import { formatRelayStatusForRoute, formatSessionSelectorError } from "../../extensions/relay/formatting/presenters.js";
import type { ChannelBinding } from "../../extensions/relay/core/channel-adapter.js";
import type { SessionRoute } from "../../extensions/relay/core/types.js";

function route(): SessionRoute {
  return {
    sessionKey: "session:/Users/example/.pi/agent/sessions/raw.jsonl",
    sessionId: "session",
    sessionFile: "/Users/example/.pi/agent/sessions/raw.jsonl",
    sessionLabel: "Docs",
    lastActivityAt: Date.parse("2026-05-02T12:00:00.000Z"),
    notification: { lastStatus: "running" },
    actions: {
      context: { isIdle: () => false } as never,
      getModel: () => undefined,
      sendUserMessage: () => undefined,
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "not-found" }),
      appendAudit: () => undefined,
      persistBinding: () => undefined,
      promptLocalConfirmation: async () => true,
      abort: () => undefined,
      compact: async () => undefined,
    },
  };
}

const discordBinding: ChannelBinding = {
  channel: "discord",
  conversationId: "1500082265877909634",
  userId: "386480375649796096",
  sessionKey: "session:/Users/example/.pi/agent/sessions/raw.jsonl",
  sessionId: "session",
  sessionFile: "/Users/example/.pi/agent/sessions/raw.jsonl",
  sessionLabel: "Docs",
  boundAt: "2026-05-02T12:00:00.000Z",
  lastSeenAt: "2026-05-02T12:00:00.000Z",
  identity: { displayName: "zikolach" },
  metadata: { alias: "phone" },
};

describe("shared relay presenters", () => {
  it("formats status with shared fields without raw session paths or storage keys", () => {
    const text = formatRelayStatusForRoute(route(), {
      online: true,
      busy: true,
      binding: discordBinding,
      progressMode: "verbose",
      includeLastStatus: true,
    });

    expect(text).toContain("Session: phone");
    expect(text).toContain("Label: Docs");
    expect(text).toContain("Online: yes");
    expect(text).toContain("Busy: yes");
    expect(text).toContain("Progress mode: verbose");
    expect(text).toContain("Last status: running");
    expect(text).not.toContain("/Users/example");
    expect(text).not.toContain("session:/");
    expect(text).not.toContain("discord:session");
  });

  it("formats shared selector errors for command parity", () => {
    expect(formatSessionSelectorError({ kind: "missing" }, "")).toContain("/sessions");
    expect(formatSessionSelectorError({ kind: "no-match" }, "docs")).toContain("No session matches docs");
  });
});
