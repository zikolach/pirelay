import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clipboardCommandCandidates, copyTextToClipboard } from "../../extensions/relay/ui/clipboard.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("clipboard helpers", () => {
  it("selects platform-specific clipboard command candidates", () => {
    expect(clipboardCommandCandidates("darwin").map((candidate) => candidate.command)).toEqual(["pbcopy"]);
    expect(clipboardCommandCandidates("win32").map((candidate) => candidate.command)).toEqual(["clip.exe"]);
    expect(clipboardCommandCandidates("linux").map((candidate) => candidate.command)).toEqual(["wl-copy", "xclip", "xsel"]);
  });

  it("copies text through an explicit clipboard command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pirelay-clipboard-"));
    tempDirs.push(dir);
    const script = join(dir, "copy.sh");
    const output = join(dir, "clipboard.txt");
    await writeFile(script, "#!/bin/sh\ncat > \"$PI_RELAY_TEST_CLIPBOARD_OUT\"\n", { mode: 0o700 });
    await chmod(script, 0o700);

    const result = await copyTextToClipboard("hello clipboard", {
      env: { PI_RELAY_CLIPBOARD_COMMAND: script, PI_RELAY_TEST_CLIPBOARD_OUT: output },
    });

    expect(result).toMatchObject({ ok: true, command: script });
    await expect(readFile(output, "utf8")).resolves.toBe("hello clipboard");
  });

  it("reports unavailable clipboard commands", async () => {
    const result = await copyTextToClipboard("hello", { env: { PI_RELAY_CLIPBOARD_COMMAND: "/missing/pirelay-clipboard" } });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("unavailable");
  });
});
