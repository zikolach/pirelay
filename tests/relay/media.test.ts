import { describe, expect, it } from "vitest";
import { base64ByteLength, imageMimeTypeToExtension, isAllowedImageMimeType, normalizeImageMimeType } from "../../extensions/relay/media/index.js";

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
});
