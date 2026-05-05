import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TunnelStateStore } from "../extensions/relay/state/tunnel-store.js";

const tempDirs: string[] = [];

async function createStore(): Promise<TunnelStateStore> {
  const dir = await mkdtemp(join(tmpdir(), "pi-telegram-tunnel-"));
  tempDirs.push(dir);
  return new TunnelStateStore(dir);
}

async function createStoreWithDir(): Promise<{ store: TunnelStateStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-telegram-tunnel-"));
  tempDirs.push(dir);
  return { store: new TunnelStateStore(dir), dir };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("TunnelStateStore", () => {
  it("creates and consumes single-use pairing nonces", async () => {
    const store = await createStore();
    const { nonce } = await store.createPendingPairing({
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
      sessionLabel: "session-1.jsonl",
      expiryMs: 60_000,
    });

    const consumed = await store.consumePendingPairing(nonce);
    expect(consumed?.sessionId).toBe("session-1");

    const consumedAgain = await store.consumePendingPairing(nonce);
    expect(consumedAgain).toBeUndefined();
  });

  it("keeps channel-scoped pairing nonces from being consumed by the wrong channel", async () => {
    const store = await createStore();
    const { nonce } = await store.createPendingPairing({
      channel: "discord",
      sessionId: "session-discord",
      sessionFile: "/tmp/session-discord.jsonl",
      sessionLabel: "session-discord.jsonl",
      expiryMs: 60_000,
    });

    expect(await store.consumePendingPairing(nonce, { channel: "telegram" })).toBeUndefined();
    const consumed = await store.consumePendingPairing(nonce, { channel: "discord" });
    expect(consumed).toMatchObject({ channel: "discord", sessionId: "session-discord" });
  });

  it("rejects expired pairing nonces", async () => {
    const store = await createStore();
    const { nonce } = await store.createPendingPairing({
      sessionId: "session-2",
      sessionFile: "/tmp/session-2.jsonl",
      sessionLabel: "session-2.jsonl",
      expiryMs: 60_000,
    });

    const data = await store.load();
    const onlyPairing = Object.values(data.pendingPairings)[0]!;
    onlyPairing.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await store.save(data);

    const consumed = await store.consumePendingPairing(nonce);
    expect(consumed).toBeUndefined();
  });

  it("serializes concurrent state updates so messenger bindings are not clobbered", async () => {
    const { store, dir } = await createStoreWithDir();
    const sameDirStore = new TunnelStateStore(dir);

    await Promise.all([
      store.update(async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        data.bindings["session-1"] = {
          sessionKey: "session-1",
          sessionId: "session-1",
          sessionLabel: "Docs",
          chatId: 123,
          userId: 123,
          boundAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          status: "active",
        };
      }),
      sameDirStore.upsertChannelBinding({
        channel: "discord",
        conversationId: "dm1",
        userId: "u1",
        sessionKey: "session-1",
        sessionId: "session-1",
        sessionLabel: "Docs",
        boundAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      }),
    ]);

    const data = await store.load();
    expect(Object.keys(data.bindings)).toEqual(["session-1"]);
    expect(Object.values(data.channelBindings)).toContainEqual(expect.objectContaining({ channel: "discord", userId: "u1", sessionKey: "session-1" }));
  });

  it("persists active channel selections with optional machine identity", async () => {
    const store = await createStore();

    await store.setActiveChannelSelection("discord", "room1", "u1", "session-1", { machineId: "laptop", machineDisplayName: "Laptop" });
    await store.setActiveChannelSelection("telegram", "room1", "u1", "session-2", { machineId: "desktop" });

    expect(await store.getActiveChannelSelection("discord", "room1", "u1")).toMatchObject({
      channel: "discord",
      conversationId: "room1",
      userId: "u1",
      sessionKey: "session-1",
      machineId: "laptop",
      machineDisplayName: "Laptop",
    });
    expect(await store.getActiveChannelSelection("telegram", "room1", "u1")).toMatchObject({ sessionKey: "session-2", machineId: "desktop" });
  });

  it("keys channel bindings by messenger instance so same-kind pairings do not clobber each other", async () => {
    const store = await createStore();

    await store.upsertChannelBinding({
      channel: "discord",
      instanceId: "personal",
      conversationId: "dm-personal",
      userId: "u1",
      sessionKey: "session-1",
      sessionId: "session-1",
      sessionLabel: "Personal",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    await store.upsertChannelBinding({
      channel: "discord",
      instanceId: "work",
      conversationId: "dm-work",
      userId: "u1",
      sessionKey: "session-1",
      sessionId: "session-1",
      sessionLabel: "Work",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    const data = await store.load();
    expect(Object.keys(data.channelBindings).sort()).toEqual(["discord:personal:session-1", "discord:work:session-1"]);
    expect(await store.getChannelBindingBySessionKey("discord", "session-1", "personal")).toMatchObject({ conversationId: "dm-personal" });
    expect(await store.getChannelBindingBySessionKey("discord", "session-1", "work")).toMatchObject({ conversationId: "dm-work" });
  });
});
