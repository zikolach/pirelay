import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverWorkspaceFileToRequester, formatRequesterFileDeliveryResult, parseRemoteSendFileArgs, type RelayFileDeliveryRequester } from "../../extensions/relay/core/requester-file-delivery.js";
import type { ChannelAdapter, ChannelOutboundPayload } from "../../extensions/relay/core/channel-adapter.js";
import type { SessionRoute } from "../../extensions/relay/core/types.js";

const tempDirs: string[] = [];

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pirelay-requester-file-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function requester(overrides: Partial<RelayFileDeliveryRequester> = {}): RelayFileDeliveryRequester {
  return {
    channel: "slack",
    instanceId: "default",
    conversationId: "C1",
    userId: "U1",
    sessionKey: "s:file",
    safeLabel: "Slack U1",
    createdAt: Date.now(),
    ...overrides,
  };
}

function route(req = requester()): SessionRoute {
  return {
    sessionKey: "s:file",
    sessionId: "s",
    sessionFile: "file",
    sessionLabel: "Docs",
    notification: {},
    remoteRequester: req,
    actions: { context: { cwd: process.cwd() }, appendAudit: vi.fn() } as never,
  };
}

function adapter() {
  const sent: Array<{ kind: string; fileName: string; caption?: string; threadTs?: string }> = [];
  const fake: ChannelAdapter = {
    id: "slack",
    displayName: "Slack",
    capabilities: {
      inlineButtons: true,
      textMessages: true,
      documents: true,
      images: true,
      activityIndicators: false,
      callbacks: true,
      privateChats: true,
      groupChats: true,
      maxTextChars: 1000,
      maxDocumentBytes: 1024,
      maxImageBytes: 1024,
      supportedImageMimeTypes: ["image/png"],
    },
    send: vi.fn(async (_payload: ChannelOutboundPayload) => undefined),
    sendText: vi.fn(async () => undefined),
    sendDocument: vi.fn(async (address, file, options) => { sent.push({ kind: "document", fileName: file.fileName, caption: options?.caption, threadTs: (address as { threadTs?: string }).threadTs }); }),
    sendImage: vi.fn(async (address, file, options) => { sent.push({ kind: "image", fileName: file.fileName, caption: options?.caption, threadTs: (address as { threadTs?: string }).threadTs }); }),
    sendActivity: vi.fn(async () => undefined),
    answerAction: vi.fn(async () => undefined),
  };
  return { fake, sent };
}

describe("requester-scoped file delivery", () => {
  it("parses requester-scoped remote send-file arguments", () => {
    expect(parseRemoteSendFileArgs("docs/report.md Report")).toEqual({ relativePath: "docs/report.md", caption: "Report" });
    expect(parseRemoteSendFileArgs("slack docs/report.md")).toBeUndefined();
    expect(parseRemoteSendFileArgs("all docs/report.md")).toBeUndefined();
    expect(parseRemoteSendFileArgs("telegram")).toBeUndefined();
  });

  it("delivers safe workspace files to the requester thread", async () => {
    const root = await workspace();
    await writeFile(join(root, "report.md"), "# Report\n");
    const req = requester({ threadId: "thread-1" });
    const { fake, sent } = adapter();

    const result = await deliverWorkspaceFileToRequester({ route: route(req), requester: req, adapter: fake, workspaceRoot: root, relativePath: "report.md", caption: "Report", source: "remote-command" });

    expect(result).toMatchObject({ ok: true, kind: "document", relativePath: "report.md" });
    expect(sent).toEqual([{ kind: "document", fileName: "report.md", caption: "Report", threadTs: "thread-1" }]);
    expect(formatRequesterFileDeliveryResult(result)).toContain("Delivered report.md");
  });

  it("fails closed for stale requesters, unsafe paths, missing files, oversized files, and missing capabilities", async () => {
    const root = await workspace();
    await writeFile(join(root, "report.md"), "# Report\n");
    const req = requester();
    const { fake, sent } = adapter();

    const missingContextRoute = route(req);
    missingContextRoute.remoteRequester = undefined;
    const missingContext = await deliverWorkspaceFileToRequester({ route: missingContextRoute, requester: req, adapter: fake, workspaceRoot: root, relativePath: "report.md", source: "assistant-tool" });
    expect(missingContext).toMatchObject({ ok: false, code: "stale-requester" });

    const stale = await deliverWorkspaceFileToRequester({ route: route(requester({ userId: "U2" })), requester: req, adapter: fake, workspaceRoot: root, relativePath: "report.md", source: "assistant-tool" });
    expect(stale).toMatchObject({ ok: false, code: "stale-requester" });

    const empty = await deliverWorkspaceFileToRequester({ route: route(req), requester: req, adapter: fake, workspaceRoot: root, relativePath: "   ", source: "assistant-tool" });
    expect(empty).toMatchObject({ ok: false, code: "validation-failed", error: "Usage: send-file <relative-path> [caption]" });

    const unsafe = await deliverWorkspaceFileToRequester({ route: route(req), requester: req, adapter: fake, workspaceRoot: root, relativePath: "../secret.md", source: "remote-command" });
    expect(unsafe).toMatchObject({ ok: false, code: "validation-failed" });

    const missing = await deliverWorkspaceFileToRequester({ route: route(req), requester: req, adapter: fake, workspaceRoot: root, relativePath: "missing.md", source: "remote-command" });
    expect(missing).toMatchObject({ ok: false, code: "validation-failed" });

    const oversized = await deliverWorkspaceFileToRequester({ route: route(req), requester: req, adapter: fake, workspaceRoot: root, relativePath: "report.md", source: "remote-command", maxDocumentBytes: 1 });
    expect(oversized).toMatchObject({ ok: false, code: "validation-failed" });

    fake.capabilities.documents = false;
    const unsupported = await deliverWorkspaceFileToRequester({ route: route(req), requester: req, adapter: fake, workspaceRoot: root, relativePath: "report.md", source: "remote-command" });
    expect(unsupported).toMatchObject({ ok: false, code: "unsupported-capability" });

    expect(sent).toEqual([]);
  });

  it("redacts upload failures", async () => {
    const root = await workspace();
    await writeFile(join(root, "report.md"), "# Report\n");
    const req = requester();
    const { fake } = adapter();
    fake.sendDocument = vi.fn(async () => { throw new Error("upload failed for xoxb-secret 123456:ABCdefGhIJKlmNoPQRstuVWXYz https://discord.com/api/webhooks/1/secret https://hooks.slack.com/actions/T/B/secret"); });

    const result = await deliverWorkspaceFileToRequester({ route: route(req), requester: req, adapter: fake, workspaceRoot: root, relativePath: "report.md", source: "remote-command" });

    expect(result).toMatchObject({ ok: false, code: "upload-failed" });
    if (!result.ok) {
      expect(result.error).not.toContain("xoxb-secret");
      expect(result.error).not.toContain("ABCdefGhIJKlmNoPQRstuVWXYz");
      expect(result.error).not.toContain("discord.com/api/webhooks");
      expect(result.error).not.toContain("hooks.slack.com");
    }
  });
});
