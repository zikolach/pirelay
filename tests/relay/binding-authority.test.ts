import { describe, expect, it } from "vitest";
import {
  bindingAuthorityStateFromData,
  channelDestinationKey,
  resolveChannelBindingAuthority,
  resolveTelegramBindingAuthority,
  stateUnavailableBindingAuthority,
  telegramDestinationKey,
} from "../../extensions/relay/core/binding-authority.js";
import type { ChannelPersistedBindingRecord, PersistedBindingRecord, TunnelStoreData } from "../../extensions/relay/core/types.js";

function emptyState(): TunnelStoreData {
  return {
    pendingPairings: {},
    bindings: {},
    channelBindings: {},
    activeChannelSelections: {},
    trustedRelayUsers: {},
    lifecycleNotifications: {},
    delegationTasks: {},
    delegationAudit: [],
  };
}

function telegramBinding(overrides: Partial<PersistedBindingRecord> = {}): PersistedBindingRecord {
  return {
    sessionKey: "session-1",
    sessionId: "session-1",
    sessionLabel: "Docs",
    chatId: 100,
    userId: 200,
    boundAt: "2026-05-15T00:00:00.000Z",
    lastSeenAt: "2026-05-15T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

function channelBinding(overrides: Partial<ChannelPersistedBindingRecord> = {}): ChannelPersistedBindingRecord {
  return {
    channel: "slack",
    instanceId: "work",
    conversationId: "C1",
    userId: "U1",
    sessionKey: "session-1",
    sessionId: "session-1",
    sessionLabel: "Docs",
    boundAt: "2026-05-15T00:00:00.000Z",
    lastSeenAt: "2026-05-15T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

describe("binding authority", () => {
  it.each([
    ["active", telegramBinding(), { chatId: 100, userId: 200 }, "active"],
    ["paused", telegramBinding({ paused: true }), { chatId: 100, userId: 200 }, "paused"],
    ["revoked", telegramBinding({ status: "revoked", revokedAt: "2026-05-15T00:01:00.000Z" }), { chatId: 100, userId: 200 }, "revoked"],
    ["moved-chat", telegramBinding({ chatId: 999 }), { chatId: 100, userId: 200 }, "moved"],
    ["moved-user", telegramBinding({ userId: 999 }), { chatId: 100, userId: 200 }, "moved"],
  ] as const)("classifies Telegram %s bindings", (_name, binding, expected, kind) => {
    const state = emptyState();
    state.bindings[binding.sessionKey] = binding;
    const outcome = resolveTelegramBindingAuthority(bindingAuthorityStateFromData(state), { sessionKey: "session-1", ...expected });
    expect(outcome.kind).toBe(kind);
  });

  it("supports includePaused for Telegram bindings", () => {
    const state = emptyState();
    state.bindings["session-1"] = telegramBinding({ paused: true });
    const outcome = resolveTelegramBindingAuthority(bindingAuthorityStateFromData(state), { sessionKey: "session-1", chatId: 100, userId: 200, includePaused: true });
    expect(outcome).toMatchObject({ kind: "active", source: "persisted", binding: { paused: true } });
  });

  it.each([
    ["active", channelBinding(), { conversationId: "C1", userId: "U1" }, "active"],
    ["paused", channelBinding({ paused: true }), { conversationId: "C1", userId: "U1" }, "paused"],
    ["revoked", channelBinding({ status: "revoked", revokedAt: "2026-05-15T00:01:00.000Z" }), { conversationId: "C1", userId: "U1" }, "revoked"],
    ["moved-conversation", channelBinding({ conversationId: "C2" }), { conversationId: "C1", userId: "U1" }, "moved"],
    ["moved-user", channelBinding({ userId: "U2" }), { conversationId: "C1", userId: "U1" }, "moved"],
  ] as const)("classifies channel %s bindings", (_name, binding, expected, kind) => {
    const state = emptyState();
    state.channelBindings[`slack:work:${binding.sessionKey}`] = binding;
    const outcome = resolveChannelBindingAuthority(bindingAuthorityStateFromData(state), { channel: "slack", instanceId: "work", sessionKey: "session-1", ...expected });
    expect(outcome.kind).toBe(kind);
  });

  it("allows exact volatile fallback only when explicitly permitted and no persisted record exists", () => {
    const state = emptyState();
    const candidate = telegramBinding();
    expect(resolveTelegramBindingAuthority(bindingAuthorityStateFromData(state), { sessionKey: "session-1", chatId: 100, userId: 200 }, candidate).kind).toBe("missing");
    expect(resolveTelegramBindingAuthority(bindingAuthorityStateFromData(state), { sessionKey: "session-1", chatId: 100, userId: 200, allowVolatileFallback: true }, candidate)).toMatchObject({ kind: "active", source: "volatile" });
    expect(resolveTelegramBindingAuthority(bindingAuthorityStateFromData(state), { sessionKey: "session-1", chatId: 999, userId: 200, allowVolatileFallback: true }, candidate).kind).toBe("missing");
  });

  it("never lets volatile fallback override revoked, moved, paused, or unavailable state", () => {
    const candidate = telegramBinding();
    const revokedState = emptyState();
    revokedState.bindings["session-1"] = telegramBinding({ status: "revoked", revokedAt: "2026-05-15T00:01:00.000Z" });
    expect(resolveTelegramBindingAuthority(bindingAuthorityStateFromData(revokedState), { sessionKey: "session-1", chatId: 100, userId: 200, allowVolatileFallback: true }, candidate).kind).toBe("revoked");

    const movedState = emptyState();
    movedState.bindings["session-1"] = telegramBinding({ chatId: 999 });
    expect(resolveTelegramBindingAuthority(bindingAuthorityStateFromData(movedState), { sessionKey: "session-1", chatId: 100, userId: 200, allowVolatileFallback: true }, candidate).kind).toBe("moved");

    const pausedState = emptyState();
    pausedState.bindings["session-1"] = telegramBinding({ paused: true });
    expect(resolveTelegramBindingAuthority(bindingAuthorityStateFromData(pausedState), { sessionKey: "session-1", chatId: 100, userId: 200, allowVolatileFallback: true }, candidate).kind).toBe("paused");

    expect(resolveTelegramBindingAuthority(stateUnavailableBindingAuthority(new Error("boom")), { sessionKey: "session-1", chatId: 100, userId: 200, allowVolatileFallback: true }, candidate).kind).toBe("state-unavailable");
  });

  it("derives stable destination keys without cross-messenger or cross-user collisions", () => {
    expect(telegramDestinationKey({ sessionKey: "s1", chatId: 1, userId: 2 })).toBe("telegram:default:s1:1:2");
    expect(channelDestinationKey({ channel: "discord", instanceId: "default", sessionKey: "s1", conversationId: "1", userId: "2" })).toBe("discord:default:s1:1:2");
    expect(channelDestinationKey({ channel: "slack", instanceId: "default", sessionKey: "s1", conversationId: "1", userId: "2" })).not.toBe(channelDestinationKey({ channel: "discord", instanceId: "default", sessionKey: "s1", conversationId: "1", userId: "2" }));
    expect(channelDestinationKey({ channel: "discord", instanceId: "default", sessionKey: "s1", conversationId: "1", userId: "3" })).not.toBe(channelDestinationKey({ channel: "discord", instanceId: "default", sessionKey: "s1", conversationId: "1", userId: "2" }));
  });
});
