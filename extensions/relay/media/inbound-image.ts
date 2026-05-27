import { Buffer } from "node:buffer";
import { decompressFrame, parseGIF, type ParsedGif } from "gifuct-js";
import { PNG } from "pngjs";
import { isAllowedImageMimeType, normalizeImageMimeType } from "./image-mime.js";

// GIF conversion is intentionally implemented with small pure-JavaScript
// dependencies (`gifuct-js` + `pngjs`) rather than a native image stack. PiRelay
// only needs deterministic first-frame extraction, and avoiding native bindings
// keeps the Pi package easier to install across local developer machines.
export const DEFAULT_DIRECT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DEFAULT_CONVERTIBLE_INBOUND_IMAGE_MIME_TYPES = ["image/gif"] as const;
export const DEFAULT_MAX_CONVERTED_IMAGE_PIXELS = 16_777_216;

export interface PreparedInboundImage {
  bytes: Buffer;
  mimeType: string;
  byteSize: number;
  converted: boolean;
  sourceMimeType: string;
}

export interface PrepareInboundImageOptions {
  allowedDirectMimeTypes: readonly string[];
  maxBytes: number;
  maxPixels?: number;
}

export function isDirectModelImageMimeType(mimeType: string | undefined, allowedDirectMimeTypes: readonly string[] = DEFAULT_DIRECT_IMAGE_MIME_TYPES): boolean {
  return isAllowedImageMimeType(mimeType, [...allowedDirectMimeTypes]);
}

export function isConvertibleInboundImageMimeType(mimeType: string | undefined): boolean {
  const normalized = normalizeImageMimeType(mimeType);
  return Boolean(normalized && DEFAULT_CONVERTIBLE_INBOUND_IMAGE_MIME_TYPES.includes(normalized as typeof DEFAULT_CONVERTIBLE_INBOUND_IMAGE_MIME_TYPES[number]));
}

export function isAcceptedInboundImageMimeType(mimeType: string | undefined, allowedDirectMimeTypes: readonly string[] = DEFAULT_DIRECT_IMAGE_MIME_TYPES): boolean {
  return isDirectModelImageMimeType(mimeType, allowedDirectMimeTypes) || isConvertibleInboundImageMimeType(mimeType);
}

export function acceptedInboundImageMimeTypes(allowedDirectMimeTypes: readonly string[] = DEFAULT_DIRECT_IMAGE_MIME_TYPES): string[] {
  const direct = normalizedDirectImageMimeTypes(allowedDirectMimeTypes);
  return [...new Set([...direct, ...DEFAULT_CONVERTIBLE_INBOUND_IMAGE_MIME_TYPES])];
}

export function acceptedInboundImageFormatsText(allowedDirectMimeTypes: readonly string[] = DEFAULT_DIRECT_IMAGE_MIME_TYPES): string {
  const direct = normalizedDirectImageMimeTypes(allowedDirectMimeTypes)
    .filter((value) => !isConvertibleInboundImageMimeType(value))
    .join(", ");
  const gifText = "image/gif (first frame converted to PNG)";
  return direct ? `${direct}, ${gifText}` : gifText;
}

function normalizedDirectImageMimeTypes(allowedDirectMimeTypes: readonly string[]): string[] {
  return allowedDirectMimeTypes.map((value) => normalizeImageMimeType(value)).filter((value): value is string => Boolean(value));
}

export function prepareInboundImageForPrompt(inputBytes: Uint8Array, sourceMimeType: string | undefined, options: PrepareInboundImageOptions): PreparedInboundImage {
  const bytes = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
  if (bytes.byteLength > options.maxBytes) {
    throw new Error(`Image is too large (${bytes.byteLength} bytes). Limit: ${options.maxBytes} bytes.`);
  }

  const normalized = normalizeImageMimeType(sourceMimeType) ?? "application/octet-stream";
  if (isConvertibleInboundImageMimeType(normalized)) {
    const converted = convertGifFirstFrameToPng(bytes, { maxBytes: options.maxBytes, maxPixels: options.maxPixels });
    return {
      bytes: converted,
      mimeType: "image/png",
      byteSize: converted.byteLength,
      converted: true,
      sourceMimeType: normalized,
    };
  }

  if (!isDirectModelImageMimeType(normalized, options.allowedDirectMimeTypes)) {
    throw new Error(`Unsupported image type: ${normalized}.`);
  }

  return {
    bytes,
    mimeType: normalized,
    byteSize: bytes.byteLength,
    converted: false,
    sourceMimeType: normalized,
  };
}

function convertGifFirstFrameToPng(bytes: Buffer, options: { maxBytes: number; maxPixels?: number }): Buffer {
  let parsed;
  try {
    const arrayBuffer = Uint8Array.from(bytes).buffer as ArrayBuffer;
    parsed = parseGIF(arrayBuffer);
  } catch (error) {
    throw new Error(`Could not decode GIF image: ${errorMessage(error)}`);
  }

  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_CONVERTED_IMAGE_PIXELS;
  validateImageDimensions(width, height, maxPixels);

  const rawFirstFrame = parsed.frames.find(isGifImageFrame);
  if (!rawFirstFrame) throw new Error("GIF does not contain any image frames.");

  let firstFrame;
  try {
    firstFrame = decompressFrame(rawFirstFrame, parsed.gct, true);
  } catch (error) {
    throw new Error(`Could not decode GIF first frame: ${errorMessage(error)}`);
  }
  validateImageDimensions(firstFrame.dims.width, firstFrame.dims.height, maxPixels);
  if (firstFrame.dims.left < 0 || firstFrame.dims.top < 0 || firstFrame.dims.left + firstFrame.dims.width > width || firstFrame.dims.top + firstFrame.dims.height > height) {
    throw new Error("GIF first frame dimensions are invalid.");
  }

  const png = new PNG({ width, height });
  for (let y = 0; y < firstFrame.dims.height; y++) {
    const sourceStart = y * firstFrame.dims.width * 4;
    const targetStart = ((firstFrame.dims.top + y) * width + firstFrame.dims.left) * 4;
    png.data.set(firstFrame.patch.subarray(sourceStart, sourceStart + firstFrame.dims.width * 4), targetStart);
  }

  const output = PNG.sync.write(png);
  if (output.byteLength > options.maxBytes) {
    throw new Error(`Converted GIF first frame is too large (${output.byteLength} bytes). Limit: ${options.maxBytes} bytes.`);
  }
  return output;
}

function isGifImageFrame(frame: ParsedGif["frames"][number]): frame is Extract<ParsedGif["frames"][number], { image: unknown }> {
  return "image" in frame;
}

function validateImageDimensions(width: number, height: number, maxPixels: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Image dimensions are invalid.");
  }
  if (width * height > maxPixels) {
    throw new Error(`Image dimensions are too large (${width}x${height}). Limit: ${maxPixels} pixels.`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
