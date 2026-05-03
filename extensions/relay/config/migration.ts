import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_PIRELAY_STATE_DIR, LEGACY_TELEGRAM_TUNNEL_STATE_DIR, expandHome, getDefaultRelayConfigPath } from "./paths.js";
import { canonicalizeRelayConfigFile, legacyRelayConfigKeys } from "./legacy.js";
import type { RelayConfigFile } from "./schema.js";

export type RelayConfigMigrationKind = "in-place" | "legacy-default-to-canonical";

export interface RelayConfigMigrationPlan {
  configPath: string;
  sourcePath: string;
  targetPath: string;
  kind: RelayConfigMigrationKind;
  legacyKeys: string[];
  canonicalConfig: RelayConfigFile;
}

export interface RelayConfigMigrationResult {
  migrated: boolean;
  configPath: string;
  sourcePath: string;
  targetPath: string;
  kind?: RelayConfigMigrationKind;
  legacyKeys: string[];
  backupPath?: string;
}

async function readJsonConfig(configPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    await access(configPath, constants.R_OK);
  } catch {
    return undefined;
  }
  return JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function backupPathFor(configPath: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${configPath}.bak-${stamp}`;
}

function activeConfigPathFromEnv(env: NodeJS.ProcessEnv): string {
  return expandHome(env.PI_RELAY_CONFIG ?? env.PI_TELEGRAM_TUNNEL_CONFIG ?? getDefaultRelayConfigPath(DEFAULT_PIRELAY_STATE_DIR));
}

export async function planRelayConfigMigration(configPath: string): Promise<RelayConfigMigrationPlan | undefined> {
  const sourcePath = expandHome(configPath);
  const rawConfig = await readJsonConfig(sourcePath);
  if (!rawConfig) return undefined;
  const legacyKeys = legacyRelayConfigKeys(rawConfig).sort();
  if (legacyKeys.length === 0) return undefined;
  return {
    configPath: sourcePath,
    sourcePath,
    targetPath: sourcePath,
    kind: "in-place",
    legacyKeys,
    canonicalConfig: canonicalizeRelayConfigFile(rawConfig as RelayConfigFile),
  };
}

export async function planRelayConfigMigrationForEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { activePath?: string; legacyPath?: string } = {},
): Promise<RelayConfigMigrationPlan | undefined> {
  const activePath = options.activePath ? expandHome(options.activePath) : activeConfigPathFromEnv(env);
  const activePlan = await planRelayConfigMigration(activePath);
  if (activePlan) return activePlan;

  const hasExplicitConfigPath = Boolean(env.PI_RELAY_CONFIG || env.PI_TELEGRAM_TUNNEL_CONFIG);
  if (hasExplicitConfigPath || await fileExists(activePath)) return undefined;

  const legacyPath = options.legacyPath ? expandHome(options.legacyPath) : getDefaultRelayConfigPath(LEGACY_TELEGRAM_TUNNEL_STATE_DIR);
  const legacyPlan = await planRelayConfigMigration(legacyPath);
  if (!legacyPlan) return undefined;
  return {
    ...legacyPlan,
    configPath: activePath,
    targetPath: activePath,
    kind: "legacy-default-to-canonical",
  };
}

export async function migrateRelayConfigPlan(plan: RelayConfigMigrationPlan, options: { now?: Date } = {}): Promise<RelayConfigMigrationResult> {
  const now = options.now ?? new Date();
  const backupPath = backupPathFor(plan.sourcePath, now);
  await copyFile(plan.sourcePath, backupPath, constants.COPYFILE_EXCL);
  await mkdir(dirname(plan.targetPath), { recursive: true, mode: 0o700 });
  await writeFile(plan.targetPath, `${JSON.stringify(plan.canonicalConfig, null, 2)}\n`, { mode: 0o600 });
  await chmod(plan.targetPath, 0o600);

  return {
    migrated: true,
    configPath: plan.targetPath,
    sourcePath: plan.sourcePath,
    targetPath: plan.targetPath,
    kind: plan.kind,
    legacyKeys: plan.legacyKeys,
    backupPath,
  };
}

export async function migrateRelayConfigFile(configPath: string, options: { now?: Date } = {}): Promise<RelayConfigMigrationResult> {
  const plan = await planRelayConfigMigration(configPath);
  if (!plan) {
    const resolvedPath = expandHome(configPath);
    return { migrated: false, configPath: resolvedPath, sourcePath: resolvedPath, targetPath: resolvedPath, legacyKeys: [] };
  }
  return migrateRelayConfigPlan(plan, options);
}
