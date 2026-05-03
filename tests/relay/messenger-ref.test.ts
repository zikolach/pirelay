import { describe, expect, it } from "vitest";
import { DEFAULT_MESSENGER_INSTANCE_ID, formatMessengerRef, messengerBindingScope, messengerRefsEqual, parseMessengerRef } from "../../extensions/relay/core/messenger-ref.js";

describe("messenger refs", () => {
  it("parses a messenger kind with the default instance", () => {
    expect(parseMessengerRef("telegram")).toEqual({ kind: "telegram", instanceId: DEFAULT_MESSENGER_INSTANCE_ID });
  });

  it("parses a messenger kind with an explicit instance", () => {
    expect(parseMessengerRef("discord:work-bot")).toEqual({ kind: "discord", instanceId: "work-bot" });
  });

  it("rejects malformed refs", () => {
    expect(parseMessengerRef("")).toBeUndefined();
    expect(parseMessengerRef("Telegram")).toBeUndefined();
    expect(parseMessengerRef("discord:" )).toBeUndefined();
    expect(parseMessengerRef("discord:work:extra")).toBeUndefined();
  });

  it("formats refs for user-facing commands", () => {
    expect(formatMessengerRef({ kind: "telegram", instanceId: "default" })).toBe("telegram");
    expect(formatMessengerRef({ kind: "discord", instanceId: "work" })).toBe("discord:work");
  });

  it("compares refs and builds binding scopes", () => {
    const left = { kind: "slack", instanceId: "team" };
    expect(messengerRefsEqual(left, { kind: "slack", instanceId: "team" })).toBe(true);
    expect(messengerRefsEqual(left, { kind: "slack", instanceId: "other" })).toBe(false);
    expect(messengerBindingScope(left, "session-1")).toBe("slack:team:session-1");
  });
});
