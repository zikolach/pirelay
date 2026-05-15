import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const HOT_PATH_FILES = [
  "extensions/relay/adapters/telegram/runtime.ts",
  "extensions/relay/adapters/discord/runtime.ts",
  "extensions/relay/adapters/slack/runtime.ts",
  "extensions/relay/runtime/extension-runtime.ts",
  "extensions/relay/broker/tunnel-runtime.ts",
] as const;

describe("relay runtime state loading hot paths", () => {
  it("do not use synchronous TunnelStateStore helpers in runtime delivery or timer modules", async () => {
    for (const path of HOT_PATH_FILES) {
      const text = await readFile(path, "utf8");
      expect(text, path).not.toMatch(/get(?:Active)?(?:Channel)?Binding(?:Record)?(?:BySessionKey|ForSession)Sync\s*\(/);
    }
  });
});
