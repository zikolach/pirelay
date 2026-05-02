import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TunnelStateStore } from "../extensions/telegram-tunnel/state-store.js";

const tempDirs: string[] = [];

async function createStore(): Promise<TunnelStateStore> {
  const dir = await mkdtemp(join(tmpdir(), "pi-telegram-tunnel-"));
  tempDirs.push(dir);
  return new TunnelStateStore(dir);
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
});
