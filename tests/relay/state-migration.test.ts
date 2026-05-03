import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import legacyState from "../fixtures/legacy-telegram-tunnel/state.json" with { type: "json" };
import { migrateLegacyTelegramTunnelState, migrateLegacyTelegramTunnelStateFile } from "../../extensions/relay/state/index.js";

describe("legacy Telegram tunnel state migration", () => {
  it("imports active non-secret bindings and skips pending pairings", () => {
    const result = migrateLegacyTelegramTunnelState({
      legacy: legacyState,
      migratedAt: "2026-05-02T00:00:00.000Z",
      sourceStatePath: "/legacy/state.json",
    });

    expect(result.importedBindings).toBe(2);
    expect(result.skippedPendingPairings).toBe(2);
    expect(Object.keys(result.store.pendingPairings)).toEqual([]);
    expect(result.store.messengerBindings["telegram:default:session-active:/tmp/session-active.json"]).toMatchObject({
      messenger: { kind: "telegram", instanceId: "default" },
      conversationId: "111222333",
      userId: "1001",
      sessionLabel: "Active legacy session",
      status: "active",
    });
    expect(result.store.messengerBindings["telegram:default:session-revoked:/tmp/session-revoked.json"]).toBeUndefined();
    expect(result.store.messengerBindings["discord:default:session-discord:/tmp/session-discord.json"]).toMatchObject({
      messenger: { kind: "discord", instanceId: "default" },
      conversationId: "dm-2001",
      userId: "2001",
      status: "active",
    });
    expect(result.store.migrations).toEqual([{
      id: "telegram-tunnel-v1",
      source: "telegram-tunnel",
      migratedAt: "2026-05-02T00:00:00.000Z",
      sourceStatePath: "/legacy/state.json",
      importedBindings: 2,
      skippedPendingPairings: 2,
    }]);
  });

  it("is idempotent when migration marker exists", () => {
    const first = migrateLegacyTelegramTunnelState({ legacy: legacyState, migratedAt: "2026-05-02T00:00:00.000Z" });
    const second = migrateLegacyTelegramTunnelState({ legacy: legacyState, existing: first.store, migratedAt: "2026-05-03T00:00:00.000Z" });

    expect(second.alreadyMigrated).toBe(true);
    expect(second.importedBindings).toBe(0);
    expect(second.store.migrations).toHaveLength(1);
  });

  it("creates a backup before overwriting an existing target state file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-state-migration-"));
    const legacyPath = join(dir, "legacy-state.json");
    const targetPath = join(dir, "state.json");
    await writeFile(legacyPath, JSON.stringify(legacyState), { mode: 0o600 });
    await writeFile(targetPath, JSON.stringify({ version: 1, pendingPairings: {}, messengerBindings: {}, activeSelections: {}, actions: {}, routes: {}, migrations: [] }), { mode: 0o600 });

    const result = await migrateLegacyTelegramTunnelStateFile({
      legacyStatePath: legacyPath,
      targetStatePath: targetPath,
      now: "2026-05-02T00:00:00.000Z",
    });

    expect(result?.importedBindings).toBe(2);
    expect(JSON.parse(await readFile(`${targetPath}.bak`, "utf8"))).toMatchObject({ version: 1 });
    expect(JSON.parse(await readFile(targetPath, "utf8")).migrations).toHaveLength(1);
  });
});
