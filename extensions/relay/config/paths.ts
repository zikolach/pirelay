import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_PIRELAY_STATE_DIR = join(homedir(), ".pi", "agent", "pirelay");
export const LEGACY_TELEGRAM_TUNNEL_STATE_DIR = join(homedir(), ".pi", "agent", "telegram-tunnel");

export function expandHome(path: string): string {
  return path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path);
}

export function getDefaultRelayConfigPath(stateDir = DEFAULT_PIRELAY_STATE_DIR): string {
  return join(stateDir, "config.json");
}
