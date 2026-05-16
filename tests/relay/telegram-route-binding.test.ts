import { describe, expect, it } from "vitest";
import { persistedTelegramBindingForRoute, routeWithPersistedTelegramBinding } from "../../extensions/relay/broker/telegram-route-binding.js";

const binding = {
  sessionKey: "session:memory",
  sessionId: "session",
  sessionLabel: "Docs",
  chatId: 123,
  userId: 456,
  boundAt: new Date(0).toISOString(),
  lastSeenAt: new Date(0).toISOString(),
};

describe("broker Telegram route binding hydration", () => {
  it("uses an active persisted binding when a registered route omits binding metadata", () => {
    expect(routeWithPersistedTelegramBinding({ sessionKey: "session:memory" }, { bindings: { "session:memory": binding } })).toEqual({
      sessionKey: "session:memory",
      binding,
    });
  });

  it("does not override client binding metadata", () => {
    const clientBinding = { ...binding, chatId: 999 };
    expect(routeWithPersistedTelegramBinding({ sessionKey: "session:memory", binding: clientBinding }, { bindings: { "session:memory": binding } })).toMatchObject({ binding: clientBinding });
  });

  it("ignores revoked persisted bindings", () => {
    expect(persistedTelegramBindingForRoute({ sessionKey: "session:memory" }, { bindings: { "session:memory": { ...binding, status: "revoked" } } })).toBeUndefined();
    expect(persistedTelegramBindingForRoute({ sessionKey: "session:memory" }, { bindings: { "session:memory": { ...binding, revokedAt: new Date(1).toISOString() } } })).toBeUndefined();
  });
});
