import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_STATE_DIR, getDefaultConfigPath } from "./paths.js";
import type { ConfigLoadResult, TelegramTunnelConfig } from "./types.js";
import { getDefaultRedactionPatterns } from "./utils.js";

interface ConfigFileShape {
  botToken?: string;
  TELEGRAM_BOT_TOKEN?: string;
  stateDir?: string;
  pairingExpiryMs?: number;
  busyDeliveryMode?: "followUp" | "steer";
  allowUserIds?: number[];
  summaryMode?: "deterministic" | "llm";
  maxTelegramMessageChars?: number;
  sendRetryCount?: number;
  sendRetryBaseMs?: number;
  pollingTimeoutSeconds?: number;
  redactionPatterns?: string[];
}

export class ConfigError extends Error {}

function expandHome(path: string): string {
  return path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path);
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAllowUserIds(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part) && part > 0);
}

async function readConfigFile(configPath: string): Promise<ConfigFileShape | undefined> {
  try {
    await access(configPath, constants.R_OK);
  } catch {
    return undefined;
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as ConfigFileShape;
  return parsed;
}

async function collectFileWarnings(configPath: string, warnings: string[]): Promise<void> {
  try {
    const info = await stat(configPath);
    if ((info.mode & 0o077) !== 0) {
      warnings.push(`Config file ${configPath} is group/world readable. Run chmod 600 to protect bot secrets.`);
    }
  } catch {
    // Ignore stat failures for warnings.
  }
}

export async function loadTelegramTunnelConfig(): Promise<ConfigLoadResult> {
  const envConfigPath = process.env.PI_TELEGRAM_TUNNEL_CONFIG;
  const configPath = expandHome(envConfigPath || getDefaultConfigPath(DEFAULT_STATE_DIR));
  const fileConfig = await readConfigFile(configPath);
  const warnings: string[] = [];

  if (fileConfig) {
    await collectFileWarnings(configPath, warnings);
    if (fileConfig.botToken || fileConfig.TELEGRAM_BOT_TOKEN) {
      warnings.push(`Bot token loaded from ${configPath}. Prefer TELEGRAM_BOT_TOKEN in the environment when possible.`);
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? fileConfig?.botToken ?? fileConfig?.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new ConfigError(
      `Missing Telegram bot token. Set TELEGRAM_BOT_TOKEN or create ${configPath} with {\n  \"botToken\": \"<token>\"\n}.`,
    );
  }

  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    throw new ConfigError("Telegram bot token format looks invalid.");
  }

  const stateDir = expandHome(process.env.PI_TELEGRAM_TUNNEL_STATE_DIR || fileConfig?.stateDir || DEFAULT_STATE_DIR);
  const busyDeliveryMode = (process.env.PI_TELEGRAM_TUNNEL_BUSY_MODE || fileConfig?.busyDeliveryMode || "followUp") as
    | "followUp"
    | "steer";

  if (busyDeliveryMode !== "followUp" && busyDeliveryMode !== "steer") {
    throw new ConfigError(`Invalid busy delivery mode: ${busyDeliveryMode}`);
  }

  const summaryMode = (process.env.PI_TELEGRAM_TUNNEL_SUMMARY_MODE || fileConfig?.summaryMode || "deterministic") as
    | "deterministic"
    | "llm";

  if (summaryMode !== "deterministic" && summaryMode !== "llm") {
    throw new ConfigError(`Invalid summary mode: ${summaryMode}`);
  }

  const allowUserIds = parseAllowUserIds(process.env.PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS) ?? fileConfig?.allowUserIds ?? [];
  const pairingExpiryMs = parseNumber(process.env.PI_TELEGRAM_TUNNEL_PAIRING_EXPIRY_MS, fileConfig?.pairingExpiryMs ?? 5 * 60_000);
  const maxTelegramMessageChars = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_MAX_MESSAGE_CHARS,
    fileConfig?.maxTelegramMessageChars ?? 3900,
  );
  const sendRetryCount = parseNumber(process.env.PI_TELEGRAM_TUNNEL_SEND_RETRY_COUNT, fileConfig?.sendRetryCount ?? 3);
  const sendRetryBaseMs = parseNumber(process.env.PI_TELEGRAM_TUNNEL_SEND_RETRY_BASE_MS, fileConfig?.sendRetryBaseMs ?? 800);
  const pollingTimeoutSeconds = parseNumber(
    process.env.PI_TELEGRAM_TUNNEL_POLLING_TIMEOUT_SECONDS,
    fileConfig?.pollingTimeoutSeconds ?? 20,
  );

  if (pairingExpiryMs < 30_000) {
    throw new ConfigError("pairingExpiryMs must be at least 30000.");
  }
  if (maxTelegramMessageChars < 256 || maxTelegramMessageChars > 4096) {
    throw new ConfigError("maxTelegramMessageChars must be between 256 and 4096.");
  }
  if (pollingTimeoutSeconds < 1 || pollingTimeoutSeconds > 50) {
    throw new ConfigError("pollingTimeoutSeconds must be between 1 and 50 seconds.");
  }

  const config: TelegramTunnelConfig = {
    botToken,
    configPath,
    stateDir,
    pairingExpiryMs,
    busyDeliveryMode,
    allowUserIds,
    summaryMode,
    maxTelegramMessageChars,
    sendRetryCount,
    sendRetryBaseMs,
    pollingTimeoutSeconds,
    redactionPatterns: fileConfig?.redactionPatterns ?? getDefaultRedactionPatterns(),
  };

  return { config, warnings };
}
