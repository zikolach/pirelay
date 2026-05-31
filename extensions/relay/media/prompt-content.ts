import type { ImageContent } from "@mariozechner/pi-ai";
import { safeTelegramImageFilename } from "../core/utils.js";
import { prepareInboundImageForPrompt } from "./inbound-image.js";

export interface InboundImagePromptContentOptions {
  mimeType: string | undefined;
  allowedMimeTypes: string[];
  maxBytes: number;
  fileName?: string;
  fallbackBase?: string;
}

export interface PreparedInboundImagePromptContent {
  image: ImageContent;
  fileName: string;
  fileSize: number;
  mimeType: string;
  converted: boolean;
  sourceMimeType: string;
}

export function prepareInboundImagePromptContent(bytes: Uint8Array, options: InboundImagePromptContentOptions): PreparedInboundImagePromptContent {
  const prepared = prepareInboundImageForPrompt(bytes, options.mimeType, {
    allowedDirectMimeTypes: options.allowedMimeTypes,
    maxBytes: options.maxBytes,
  });
  return {
    image: { type: "image", data: prepared.bytes.toString("base64"), mimeType: prepared.mimeType },
    fileName: safeTelegramImageFilename(options.fileName, prepared.mimeType, options.fallbackBase ?? "telegram-image"),
    fileSize: prepared.byteSize,
    mimeType: prepared.mimeType,
    converted: prepared.converted,
    sourceMimeType: prepared.sourceMimeType,
  };
}
