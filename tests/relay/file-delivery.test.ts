import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceOutboundFile, validateRelativeWorkspaceFilePath } from "../../extensions/relay/core/file-delivery.js";

const tempDirs: string[] = [];

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pirelay-file-delivery-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("relay local file delivery helpers", () => {
  it("loads safe workspace markdown documents", async () => {
    const root = await workspace();
    await writeFile(join(root, "proposal.md"), "# Proposal\n");

    const result = await loadWorkspaceOutboundFile("proposal.md", {
      workspaceRoot: root,
      maxDocumentBytes: 1024,
      maxImageBytes: 1024,
      allowedImageMimeTypes: ["image/png"],
    });

    expect(result).toMatchObject({ ok: true, kind: "document", relativePath: "proposal.md" });
    if (result.ok) {
      expect(result.file.fileName).toBe("proposal.md");
      expect(result.file.mimeType).toBe("text/markdown");
      expect(Buffer.from(result.file.data).toString("utf8")).toBe("# Proposal\n");
    }
  });

  it("loads supported workspace images", async () => {
    const root = await workspace();
    await writeFile(join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));

    const result = await loadWorkspaceOutboundFile("image.png", {
      workspaceRoot: root,
      maxDocumentBytes: 1024,
      maxImageBytes: 1024,
      allowedImageMimeTypes: ["image/png"],
    });

    expect(result).toMatchObject({ ok: true, kind: "image" });
    if (result.ok) expect(result.file.mimeType).toBe("image/png");
  });

  it("rejects unsafe paths before reading", async () => {
    expect(validateRelativeWorkspaceFilePath("../secret.txt")).toContain("traversal");
    expect(validateRelativeWorkspaceFilePath("/tmp/secret.txt")).toContain("relative");
    expect(validateRelativeWorkspaceFilePath(".env")).toContain("hidden");
  });

  it("rejects symlink escapes and unsupported binary documents", async () => {
    const root = await workspace();
    const outside = await workspace();
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
    await writeFile(join(root, "payload.txt"), Buffer.from([0, 1, 2, 3]));

    const escaped = await loadWorkspaceOutboundFile("link.txt", {
      workspaceRoot: root,
      maxDocumentBytes: 1024,
      maxImageBytes: 1024,
      allowedImageMimeTypes: ["image/png"],
    });
    expect(escaped).toMatchObject({ ok: false });
    if (!escaped.ok) expect(escaped.error).toContain("outside");

    const binary = await loadWorkspaceOutboundFile("payload.txt", {
      workspaceRoot: root,
      maxDocumentBytes: 1024,
      maxImageBytes: 1024,
      allowedImageMimeTypes: ["image/png"],
    });
    expect(binary).toMatchObject({ ok: false });
    if (!binary.ok) expect(binary.error).toContain("binary");
  });

  it("rejects oversized and unsupported files", async () => {
    const root = await workspace();
    await writeFile(join(root, "large.md"), "abcdef");
    await writeFile(join(root, "archive.zip"), "not really zip");

    const large = await loadWorkspaceOutboundFile("large.md", {
      workspaceRoot: root,
      maxDocumentBytes: 3,
      maxImageBytes: 1024,
      allowedImageMimeTypes: ["image/png"],
    });
    expect(large).toMatchObject({ ok: false });
    if (!large.ok) expect(large.error).toContain("too large");

    const unsupported = await loadWorkspaceOutboundFile("archive.zip", {
      workspaceRoot: root,
      maxDocumentBytes: 1024,
      maxImageBytes: 1024,
      allowedImageMimeTypes: ["image/png"],
    });
    expect(unsupported).toMatchObject({ ok: false });
    if (!unsupported.ok) expect(unsupported.error).toContain("Unsupported file type");
  });
});
