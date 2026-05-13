import { describe, expect, it } from "vitest";
import { buttonsFallbackText, canSendFile, channelTextChunks, paragraphAwareTextChunks, requiresTextChunking, supportsButtons, type ChannelCapabilities } from "../extensions/relay/core/channel-adapter.js";

const baseCapabilities: ChannelCapabilities = {
  inlineButtons: true,
  textMessages: true,
  documents: true,
  images: true,
  activityIndicators: true,
  callbacks: true,
  privateChats: true,
  groupChats: false,
  maxTextChars: 10,
  maxDocumentBytes: 100,
  maxImageBytes: 50,
  supportedImageMimeTypes: ["image/png"],
};

describe("channel adapter boundaries", () => {
  it("requires both inline buttons and callbacks for button support", () => {
    expect(supportsButtons({ capabilities: baseCapabilities })).toBe(true);
    expect(supportsButtons({ capabilities: { ...baseCapabilities, callbacks: false } })).toBe(false);
    expect(supportsButtons({ capabilities: { ...baseCapabilities, inlineButtons: false } })).toBe(false);
  });

  it("detects text that needs adapter-aware chunking", () => {
    expect(requiresTextChunking({ capabilities: baseCapabilities }, "1234567890")).toBe(false);
    expect(requiresTextChunking({ capabilities: baseCapabilities }, "12345678901")).toBe(true);
  });

  it("checks file limits when adapters declare them", () => {
    expect(canSendFile({ capabilities: baseCapabilities }, { byteSize: 50 }, "image")).toBe(true);
    expect(canSendFile({ capabilities: baseCapabilities }, { byteSize: 51 }, "image")).toBe(false);
    expect(canSendFile({ capabilities: baseCapabilities }, { byteSize: 101 }, "document")).toBe(false);
    expect(canSendFile({ capabilities: { ...baseCapabilities, maxDocumentBytes: undefined } }, { byteSize: 101 }, "document")).toBe(true);
    expect(canSendFile({ capabilities: baseCapabilities }, {}, "document")).toBe(true);
  });

  it("formats text fallbacks for adapters without button support", () => {
    const buttons = [[{ label: "Show full", actionData: "full" }], [{ label: "Cancel", actionData: "cancel" }]];
    expect(buttonsFallbackText(buttons)).toBe("Actions:\n1. Show full\n2. Cancel");
  });

  it("chunks text according to adapter limits", () => {
    expect(channelTextChunks({ capabilities: baseCapabilities }, "12345678901")).toEqual(["1234567890", "1"]);
  });

  it("packs text chunks by paragraph before hard splitting", () => {
    expect(paragraphAwareTextChunks("short\n\nparagraph\n\ntail", 16)).toEqual(["short\n\nparagraph", "\n\ntail"]);
  });

  it("preserves whitespace and line endings exactly while chunking", () => {
    const text = "one\r\n\r\n  indented code\n\n\ntrailing spaces   end";
    const chunks = paragraphAwareTextChunks(text, 14);

    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 14)).toBe(true);
    expect(chunks.join("")).toContain("\r\n\r\n");
    expect(chunks.join("")).toContain("  indented");
    expect(chunks.join("")).toContain("   end");
  });
});
