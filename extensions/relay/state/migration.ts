import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { relayBindingStorageKey, emptyRelayStore } from "./schema.js";
import type { RelayStoreData } from "./schema.js";
import { legacyChannelBindingToRelayBinding, legacyTelegramBindingToRelayBinding } from "./legacy-telegram.js";
import type { LegacyTelegramTunnelStoreData } from "./legacy-telegram.js";

export interface LegacyMigrationResult {
  store: RelayStoreData;
  importedBindings: number;
  skippedPendingPairings: number;
  alreadyMigrated: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeRelayStore(value: unknown): RelayStoreData {
  if (!isObject(value) || value.version !== 1) return emptyRelayStore();
  return {
    version: 1,
    pendingPairings: isObject(value.pendingPairings) ? value.pendingPairings as RelayStoreData["pendingPairings"] : {},
    messengerBindings: isObject(value.messengerBindings) ? value.messengerBindings as RelayStoreData["messengerBindings"] : {},
    activeSelections: isObject(value.activeSelections) ? value.activeSelections as RelayStoreData["activeSelections"] : {},
    actions: isObject(value.actions) ? value.actions as RelayStoreData["actions"] : {},
    routes: isObject(value.routes) ? value.routes as RelayStoreData["routes"] : {},
    migrations: Array.isArray(value.migrations) ? value.migrations as RelayStoreData["migrations"] : [],
  };
}

export function migrateLegacyTelegramTunnelState(input: {
  legacy: LegacyTelegramTunnelStoreData;
  existing?: RelayStoreData;
  migratedAt?: string;
  sourceStatePath?: string;
}): LegacyMigrationResult {
  const store = input.existing ?? emptyRelayStore();
  const alreadyMigrated = store.migrations.some((migration) => migration.id === "telegram-tunnel-v1");
  if (alreadyMigrated) {
    return { store, importedBindings: 0, skippedPendingPairings: 0, alreadyMigrated: true };
  }

  let importedBindings = 0;
  for (const binding of Object.values(input.legacy.bindings ?? {})) {
    if (binding.status === "revoked" || binding.revokedAt) continue;
    const relayBinding = legacyTelegramBindingToRelayBinding(binding);
    store.messengerBindings[relayBindingStorageKey(relayBinding.messenger, relayBinding.sessionKey)] = relayBinding;
    importedBindings += 1;
  }

  for (const binding of Object.values(input.legacy.channelBindings ?? {})) {
    if (binding.status === "revoked" || binding.revokedAt) continue;
    const relayBinding = legacyChannelBindingToRelayBinding(binding);
    store.messengerBindings[relayBindingStorageKey(relayBinding.messenger, relayBinding.sessionKey)] = relayBinding;
    importedBindings += 1;
  }

  const skippedPendingPairings = Object.keys(input.legacy.pendingPairings ?? {}).length;
  store.migrations.push({
    id: "telegram-tunnel-v1",
    source: "telegram-tunnel",
    migratedAt: input.migratedAt ?? new Date().toISOString(),
    sourceStatePath: input.sourceStatePath,
    importedBindings,
    skippedPendingPairings,
  });

  return { store, importedBindings, skippedPendingPairings, alreadyMigrated: false };
}

async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    await access(path, constants.R_OK);
  } catch {
    return undefined;
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

export async function migrateLegacyTelegramTunnelStateFile(input: {
  legacyStatePath: string;
  targetStatePath: string;
  now?: string;
}): Promise<LegacyMigrationResult | undefined> {
  const legacy = await readJsonFile(input.legacyStatePath);
  if (!legacy) return undefined;
  const existingRaw = await readJsonFile(input.targetStatePath);
  const existing = normalizeRelayStore(existingRaw);
  if (existingRaw) {
    await copyFile(input.targetStatePath, `${input.targetStatePath}.bak`);
  }
  const result = migrateLegacyTelegramTunnelState({
    legacy: legacy as LegacyTelegramTunnelStoreData,
    existing,
    migratedAt: input.now,
    sourceStatePath: input.legacyStatePath,
  });
  await writeJsonFile(input.targetStatePath, result.store);
  return result;
}
