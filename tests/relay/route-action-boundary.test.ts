import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const LONG_LIVED_ROUTE_FILES = [
  "extensions/relay/adapters/telegram/runtime.ts",
  "extensions/relay/adapters/discord/runtime.ts",
  "extensions/relay/adapters/slack/runtime.ts",
  "extensions/relay/broker/tunnel-runtime.ts",
];

describe("route-action safety module boundaries", () => {
  it("keeps raw route context access out of adapter and broker runtimes", async () => {
    for (const path of LONG_LIVED_ROUTE_FILES) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toContain("route.actions.context");
    }
  });

  it("centralizes route operation safety helpers in shared core", async () => {
    const source = await readFile("extensions/relay/core/route-actions.ts", "utf8");
    for (const helper of [
      "deliverRoutePrompt",
      "abortRouteSafely",
      "compactRouteSafely",
      "routeWorkspaceRootSafely",
      "latestRouteImagesSafely",
      "routeImageByPathSafely",
      "probeRouteAvailability",
    ]) {
      expect(source).toContain(helper);
    }
  });
});
