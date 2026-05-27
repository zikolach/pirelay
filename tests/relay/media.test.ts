import { describe, expect, it } from "vitest";
import { acceptedInboundImageFormatsText, acceptedInboundImageMimeTypes, base64ByteLength, imageMimeTypeToExtension, isAcceptedInboundImageMimeType, isAllowedImageMimeType, isConvertibleInboundImageMimeType, isDirectModelImageMimeType, normalizeImageMimeType, prepareInboundImageForPrompt } from "../../extensions/relay/media/index.js";

const ONE_BY_ONE_GIF = Buffer.from("R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("relay media helpers", () => {
  it("normalizes and validates image MIME types", () => {
    expect(normalizeImageMimeType("Image/PNG; charset=binary")).toBe("image/png");
    expect(isAllowedImageMimeType("image/png", ["image/png"])).toBe(true);
    expect(isAllowedImageMimeType("image/gif", ["image/png"])).toBe(false);
  });

  it("maps image MIME types and measures base64 bytes", () => {
    expect(imageMimeTypeToExtension("image/jpeg")).toBe("jpg");
    expect(imageMimeTypeToExtension("application/octet-stream")).toBe("bin");
    expect(base64ByteLength(Buffer.from("hello").toString("base64"))).toBe(5);
  });

  it("distinguishes direct model image formats from convertible inbound GIFs", () => {
    expect(isDirectModelImageMimeType("image/png", ["image/png"])).toBe(true);
    expect(isDirectModelImageMimeType("image/gif", ["image/png"])).toBe(false);
    expect(isConvertibleInboundImageMimeType("image/gif")).toBe(true);
    expect(isAcceptedInboundImageMimeType("image/gif", ["image/png"])).toBe(true);
    expect(isAcceptedInboundImageMimeType("image/tiff", ["image/png"])).toBe(false);
    expect(acceptedInboundImageMimeTypes(["image/png"])).toEqual(["image/png", "image/gif"]);
    expect(acceptedInboundImageFormatsText(["image/png"])).toContain("image/gif (first frame converted to PNG)");
  });

  it("passes direct model-ready images through unchanged", () => {
    const bytes = Buffer.from([1, 2, 3]);
    const prepared = prepareInboundImageForPrompt(bytes, "image/png", { allowedDirectMimeTypes: ["image/png"], maxBytes: 10 });

    expect(prepared).toMatchObject({ mimeType: "image/png", byteSize: 3, converted: false, sourceMimeType: "image/png" });
    expect(prepared.bytes).toEqual(bytes);
  });

  it("converts GIF first frame to PNG", () => {
    const prepared = prepareInboundImageForPrompt(ONE_BY_ONE_GIF, "image/gif", { allowedDirectMimeTypes: ["image/png"], maxBytes: 1024 });

    expect(prepared.mimeType).toBe("image/png");
    expect(prepared.sourceMimeType).toBe("image/gif");
    expect(prepared.converted).toBe(true);
    expect(prepared.bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    expect(prepared.byteSize).toBe(prepared.bytes.byteLength);
  });

  it("rejects corrupt and oversized GIF conversion inputs", () => {
    expect(() => prepareInboundImageForPrompt(Buffer.from("not-a-gif"), "image/gif", { allowedDirectMimeTypes: ["image/png"], maxBytes: 1024 })).toThrow(/Could not decode GIF|does not contain any image frames/);
    expect(() => prepareInboundImageForPrompt(ONE_BY_ONE_GIF, "image/gif", { allowedDirectMimeTypes: ["image/png"], maxBytes: 10 })).toThrow(/Image is too large|Converted GIF first frame is too large/);
    expect(() => prepareInboundImageForPrompt(ONE_BY_ONE_GIF, "image/gif", { allowedDirectMimeTypes: ["image/png"], maxBytes: 1024, maxPixels: 0 })).toThrow(/dimensions|pixels/);
  });
});
