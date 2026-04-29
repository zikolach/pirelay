import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_STATE_DIR = join(homedir(), ".pi", "agent", "telegram-tunnel");

export function getDefaultConfigPath(stateDir = DEFAULT_STATE_DIR): string {
  return join(stateDir, "config.json");
}

export function getStateFilePath(stateDir = DEFAULT_STATE_DIR): string {
  return join(stateDir, "state.json");
}

export function getLockFilePath(stateDir = DEFAULT_STATE_DIR): string {
  return join(stateDir, "polling.lock");
}

export async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export async function ensureStateDir(stateDir = DEFAULT_STATE_DIR): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
}
