import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decideRelayLifecycleNotification, formatRelayLifecycleNotification } from "../../extensions/relay/notifications/lifecycle.js";
import { TunnelStateStore } from "../../extensions/relay/state/tunnel-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("relay lifecycle notifications", () => {
  it("formats safe distinct lifecycle messages", () => {
    expect(formatRelayLifecycleNotification({ kind: "offline", sessionLabel: "Docs" })).toContain("went offline locally");
    expect(formatRelayLifecycleNotification({ kind: "online", sessionLabel: "Docs" })).toContain("back online");
    const disconnected = formatRelayLifecycleNotification({ kind: "disconnected", sessionLabel: "Docs", channel: "slack" });
    expect(disconnected).toContain("disconnected locally");
    expect(disconnected).toContain("relay pair <pin>");
    expect(disconnected).not.toContain("/relay");
    expect(disconnected).not.toContain("C0");
    expect(formatRelayLifecycleNotification({ kind: "online", sessionLabel: "   " })).toBe("Pi session is back online.");
    expect(formatRelayLifecycleNotification({ kind: "offline", sessionLabel: "   " })).not.toContain("Pi session Pi session");
  });

  it("initializes online state silently and sends restored notification only after offline", () => {
    const first = decideRelayLifecycleNotification({ channel: "slack", sessionKey: "s1", conversationId: "c1", userId: "u1", kind: "online", nowIso: "2026-05-12T10:00:00.000Z" });
    expect(first.shouldNotify).toBe(false);
    expect(first.record.state).toBe("online");

    const offline = decideRelayLifecycleNotification({ previous: first.record, channel: "slack", sessionKey: "s1", conversationId: "c1", userId: "u1", kind: "offline", nowIso: "2026-05-12T10:01:00.000Z" });
    expect(offline.shouldNotify).toBe(true);

    const duplicateOffline = decideRelayLifecycleNotification({ previous: offline.record, channel: "slack", sessionKey: "s1", conversationId: "c1", userId: "u1", kind: "offline", nowIso: "2026-05-12T10:01:30.000Z" });
    expect(duplicateOffline.shouldNotify).toBe(false);

    const restored = decideRelayLifecycleNotification({ previous: duplicateOffline.record, channel: "slack", sessionKey: "s1", conversationId: "c1", userId: "u1", kind: "online", nowIso: "2026-05-12T10:03:00.000Z" });
    expect(restored.shouldNotify).toBe(true);
  });

  it("persists lifecycle metadata backward-compatibly", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-lifecycle-state-"));
    tempDirs.push(stateDir);
    const store = new TunnelStateStore(stateDir);

    await expect(store.load()).resolves.toMatchObject({ lifecycleNotifications: {} });
    const first = await store.recordLifecycleNotification({ channel: "telegram", sessionKey: "s1", conversationId: "123", userId: "456", kind: "online", nowIso: "2026-05-12T10:00:00.000Z" });
    expect(first.shouldNotify).toBe(false);
    const offline = await store.recordLifecycleNotification({ channel: "telegram", sessionKey: "s1", conversationId: "123", userId: "456", kind: "offline", nowIso: "2026-05-12T10:01:00.000Z" });
    expect(offline.shouldNotify).toBe(true);

    const loaded = await store.load();
    expect(Object.values(loaded.lifecycleNotifications)).toHaveLength(1);
    expect(Object.values(loaded.lifecycleNotifications)[0]).toMatchObject({ channel: "telegram", sessionKey: "s1", state: "offline" });
  });

  it("marks lifecycle deliveries only after successful sends", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-lifecycle-delivery-"));
    tempDirs.push(stateDir);
    const store = new TunnelStateStore(stateDir);

    const offline = await store.recordLifecycleNotification({ channel: "telegram", sessionKey: "s1", conversationId: "123", userId: "456", kind: "offline", nowIso: "2026-05-12T10:00:00.000Z" });
    expect(offline.shouldNotify).toBe(true);
    await store.markLifecycleNotificationDelivered({ channel: "telegram", sessionKey: "s1", conversationId: "123", userId: "456", kind: "offline", deliveredAt: "2026-05-12T10:00:01.000Z" });

    const online = await store.recordLifecycleNotification({ channel: "telegram", sessionKey: "s1", conversationId: "123", userId: "456", kind: "online", nowIso: "2026-05-12T10:01:00.000Z" });
    expect(online.shouldNotify).toBe(true);
    let loaded = await store.load();
    expect(Object.values(loaded.lifecycleNotifications)[0]).toMatchObject({ state: "offline", lastEvent: "offline" });

    await store.markLifecycleNotificationDelivered({ channel: "telegram", sessionKey: "s1", conversationId: "123", userId: "456", kind: "online", deliveredAt: "2026-05-12T10:01:01.000Z" });
    loaded = await store.load();
    expect(Object.values(loaded.lifecycleNotifications)[0]).toMatchObject({ state: "online", lastEvent: "online" });
  });
});
