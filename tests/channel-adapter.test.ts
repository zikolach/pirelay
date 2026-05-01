import { describe, expect, it } from "vitest";
import { buttonsFallbackText, canSendFile, channelTextChunks, requiresTextChunking, supportsButtons, type ChannelCapabilities } from "../extensions/telegram-tunnel/channel-adapter.js";

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
});
