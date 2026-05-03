import { describe, expect, it } from "vitest";
import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative } from "node:path";

const relayRoot = join(process.cwd(), "extensions", "relay");
const legacyTelegramTunnelRoot = join(process.cwd(), "extensions", "telegram-tunnel");
const sharedFolders = ["core", "config", "state", "commands", "middleware", "media", "notifications", "formatting", "ui"];
const forbiddenImportFragments = [
  "../adapters/",
  "./adapters/",
  "../broker/entry",
  "./broker/entry",
  "../runtime/extension-runtime",
  "./runtime/extension-runtime",
  "@mariozechner/pi-coding-agent",
];
const forbiddenLegacyResourceFragments = [
  "extensions/telegram-tunnel",
  "./extensions/telegram-tunnel",
  "skills/telegram-tunnel",
  "./skills/telegram-tunnel",
];
const legacyFixtureAllowList = [
  join("tests", "fixtures", "legacy-telegram-tunnel"),
  join("tests", "relay", "state-migration.test.ts"),
  join("tests", "relay", "import-boundaries.test.ts"),
  join("openspec", "changes", "harden-multi-messenger-support"),
  join("openspec", "changes", "archive"),
  join("openspec", "specs", "telegram-session-tunnel"),
  join("openspec", "specs", "relay-channel-adapters"),
];

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

async function collectProjectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "trash") return [];
    if (entry.isDirectory()) return collectProjectFiles(path);
    return entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

function isAllowedLegacyReference(path: string): boolean {
  const relativePath = relative(process.cwd(), path);
  return legacyFixtureAllowList.some((allowed) => relativePath === allowed || relativePath.startsWith(`${allowed}/`));
}

describe("relay import boundaries", () => {
  it("keeps shared folders independent from adapter and runtime side-effect modules", async () => {
    const files = (await Promise.all(sharedFolders.map((folder) => collectTypeScriptFiles(join(relayRoot, folder))))).flat();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const fragment of forbiddenImportFragments) {
        if (fragment === "@mariozechner/pi-coding-agent" && file.endsWith(join("extensions", "relay", "core", "types.ts")) && source.includes("import type")) {
          continue;
        }
        if (source.includes(`from "${fragment}`) || source.includes(`from '${fragment}`) || source.includes(`import("${fragment}`) || source.includes(`import('${fragment}`)) {
          violations.push(`${relative(process.cwd(), file)} imports ${fragment}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("removes the legacy telegram-tunnel extension folder and resource references", async () => {
    await expect(access(legacyTelegramTunnelRoot, constants.F_OK)).rejects.toThrow();
    const files = await collectProjectFiles(process.cwd());
    const violations: string[] = [];

    for (const file of files) {
      if (isAllowedLegacyReference(file)) continue;
      const source = await readFile(file, "utf8");
      for (const fragment of forbiddenLegacyResourceFragments) {
        if (source.includes(fragment)) violations.push(`${relative(process.cwd(), file)} references ${fragment}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
