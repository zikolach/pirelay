import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTelegramTunnelConfig } from "../extensions/telegram-tunnel/config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("telegram tunnel config", () => {
  it("normalizes progress mode values loaded from config files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      progressMode: "completion-only",
    }));
    vi.stubEnv("PI_TELEGRAM_TUNNEL_CONFIG", configPath);

    const { config } = await loadTelegramTunnelConfig();

    expect(config.progressMode).toBe("completionOnly");
  });
});
