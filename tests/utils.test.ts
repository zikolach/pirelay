import { mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { base64ByteLength, chunkTelegramText, extractLocalImagePaths, isAllowedImageMimeType, latestImageFileCandidatesFromText, loadWorkspaceImageFile, modelSupportsImages, parseTelegramCommand, resolveBusyDeliveryMode, safeTelegramImageFilename } from "../extensions/telegram-tunnel/utils.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("telegram utils", () => {
  it("parses slash commands and strips bot usernames", () => {
    expect(parseTelegramCommand("/status")).toEqual({ command: "status", args: "" });
    expect(parseTelegramCommand("/followup@mybot fix the failing test")).toEqual({
      command: "followup",
      args: "fix the failing test",
    });
    expect(parseTelegramCommand("hello")).toBeUndefined();
  });

  it("selects busy delivery mode only while busy", () => {
    expect(resolveBusyDeliveryMode("followUp", false)).toBeUndefined();
    expect(resolveBusyDeliveryMode("steer", true)).toBe("steer");
  });

  it("chunks oversized Telegram output", () => {
    const chunks = chunkTelegramText("line1\nline2\nline3\nline4", 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.text.startsWith("[1/")).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 16)).toBe(true);
  });

  it("validates and formats image metadata", () => {
    expect(isAllowedImageMimeType("image/PNG; charset=binary", ["image/png"])).toBe(true);
    expect(safeTelegramImageFilename("../screen shot.png", "image/webp")).toBe("screen-shot.webp");
    expect(base64ByteLength(Buffer.from([1, 2, 3]).toString("base64"))).toBe(3);
    expect(modelSupportsImages({ input: ["text", "image"] } as never)).toBe(true);
    expect(modelSupportsImages({ input: ["text"] } as never)).toBe(false);
  });

  it("extracts latest-turn image path candidates from assistant text", () => {
    const paths = extractLocalImagePaths("Saved `outputs/cartoon-speaker.png` and [preview](renders/final.webp). Ignore https://x.test/nope.png");
    expect(paths).toEqual(["outputs/cartoon-speaker.png", "renders/final.webp"]);

    expect(latestImageFileCandidatesFromText(["outputs/a.png outputs/b.jpg"], { turnId: "turn", maxCount: 1 })).toEqual([
      { id: "turn-file-1", turnId: "turn", path: "outputs/a.png" },
    ]);
  });

  it("loads only safe workspace image files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-telegram-images-"));
    tempDirs.push(workspace);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await writeFile(join(workspace, "preview.png"), png);

    const loaded = await loadWorkspaceImageFile("preview.png", {
      workspaceRoot: workspace,
      turnId: "turn",
      index: 0,
      maxBytes: 1024,
      allowedMimeTypes: ["image/png"],
    });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.image.fileName).toBe("preview.png");
      expect(loaded.image.mimeType).toBe("image/png");
    }

    await writeFile(join(workspace, "not-image.png"), "text");
    await expect(loadWorkspaceImageFile("../secret.png", {
      workspaceRoot: workspace,
      turnId: "turn",
      index: 0,
      maxBytes: 1024,
      allowedMimeTypes: ["image/png"],
    })).resolves.toMatchObject({ ok: false });
    await expect(loadWorkspaceImageFile("not-image.png", {
      workspaceRoot: workspace,
      turnId: "turn",
      index: 0,
      maxBytes: 1024,
      allowedMimeTypes: ["image/png"],
    })).resolves.toMatchObject({ ok: false });
  });

  it("rejects symlink traversal outside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-telegram-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-telegram-outside-"));
    tempDirs.push(workspace, outside);
    await writeFile(join(outside, "secret.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await symlink(join(outside, "secret.png"), join(workspace, "linked.png"));

    const loaded = await loadWorkspaceImageFile("linked.png", {
      workspaceRoot: workspace,
      turnId: "turn",
      index: 0,
      maxBytes: 1024,
      allowedMimeTypes: ["image/png"],
    });
    expect(loaded).toMatchObject({ ok: false });
  });
});
