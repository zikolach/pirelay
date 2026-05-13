import { describe, expect, it, vi } from "vitest";
import { finalOutputMarkdownFile, sendFinalOutputWithFallback, shouldSendFullFinalOutput } from "../../extensions/relay/core/final-output.js";
import type { ChannelAdapter, ChannelOutboundFile, ChannelOutboundPayload, ChannelRouteAddress } from "../../extensions/relay/core/channel-adapter.js";
import type { SessionRoute } from "../../extensions/relay/core/types.js";

const address: ChannelRouteAddress = { channel: "slack", conversationId: "C1", userId: "U1" };

function route(): SessionRoute {
  return {
    sessionKey: "s:file",
    sessionId: "s",
    sessionFile: "file",
    sessionLabel: "Docs",
    notification: { lastTurnId: "turn-1", lastAssistantText: "answer" },
    actions: {} as never,
  };
}

function adapter(options: { documents?: boolean; maxTextChars?: number } = {}) {
  const sentTexts: string[] = [];
  const sentDocuments: ChannelOutboundFile[] = [];
  const fake: ChannelAdapter = {
    id: "slack",
    displayName: "Slack",
    capabilities: {
      inlineButtons: true,
      textMessages: true,
      documents: options.documents ?? true,
      images: true,
      activityIndicators: false,
      callbacks: true,
      privateChats: true,
      groupChats: true,
      maxTextChars: options.maxTextChars ?? 20,
      supportedImageMimeTypes: ["image/png"],
    },
    send: vi.fn(async (_payload: ChannelOutboundPayload) => undefined),
    sendText: vi.fn(async (_address, text) => { sentTexts.push(text); }),
    sendDocument: vi.fn(async (_address, file) => { sentDocuments.push(file); }),
    sendImage: vi.fn(async () => undefined),
    sendActivity: vi.fn(async () => undefined),
    answerAction: vi.fn(async () => undefined),
  };
  return { fake, sentTexts, sentDocuments };
}

describe("final output delivery policy", () => {
  it("sends full output for non-quiet modes", () => {
    expect(shouldSendFullFinalOutput("quiet")).toBe(false);
    expect(shouldSendFullFinalOutput("normal")).toBe(true);
    expect(shouldSendFullFinalOutput("verbose")).toBe(true);
    expect(shouldSendFullFinalOutput("completionOnly")).toBe(true);
  });

  it("sends message chunks when output fits bounded chunks", async () => {
    const { fake, sentTexts, sentDocuments } = adapter({ maxTextChars: 100 });
    await expect(sendFinalOutputWithFallback(fake, address, route(), "short final answer", { maxMessageChunks: 2 })).resolves.toBe("messages");
    expect(sentTexts).toEqual(["short final answer"]);
    expect(sentDocuments).toEqual([]);
  });

  it("sends each chunk separately when chunked output stays under the threshold", async () => {
    const { fake, sentTexts, sentDocuments } = adapter({ maxTextChars: 10 });
    await expect(sendFinalOutputWithFallback(fake, address, route(), "first part\n\nsecond", { maxMessageChunks: 2 })).resolves.toBe("messages");
    expect(sentTexts).toEqual(["first part", "\n\nsecond"]);
    expect(sentTexts.join("")).toBe("first part\n\nsecond");
    expect(sentDocuments).toEqual([]);
  });

  it("falls back to a Markdown document when chat chunking is excessive", async () => {
    const { fake, sentTexts, sentDocuments } = adapter({ maxTextChars: 10 });
    await expect(sendFinalOutputWithFallback(fake, address, route(), "paragraph one\n\nparagraph two\n\nparagraph three", { maxMessageChunks: 2 })).resolves.toBe("document");
    expect(sentTexts).toEqual([]);
    expect(sentDocuments).toHaveLength(1);
    expect(sentDocuments[0]).toMatchObject({ fileName: "pi-output-s-turn-1.md", mimeType: "text/markdown" });
  });

  it("reports a limitation when document fallback is unavailable", async () => {
    const { fake, sentTexts, sentDocuments } = adapter({ documents: false, maxTextChars: 10 });
    await expect(sendFinalOutputWithFallback(fake, address, route(), "paragraph one\n\nparagraph two\n\nparagraph three", { maxMessageChunks: 2 })).resolves.toBe("unavailable");
    expect(sentDocuments).toEqual([]);
    expect(sentTexts[0]).toContain("too large");
  });

  it("creates shared Markdown files for latest assistant output", () => {
    const file = finalOutputMarkdownFile(route(), "# Answer\n");
    expect(file.fileName).toBe("pi-output-s-turn-1.md");
    expect(Buffer.from(file.data).toString("utf8")).toBe("# Answer\n");
  });
});
