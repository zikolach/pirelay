const imageMimeToExtension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function normalizeImageMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  return normalized || undefined;
}

export function isAllowedImageMimeType(mimeType: string | undefined, allowedMimeTypes: string[]): boolean {
  const normalized = normalizeImageMimeType(mimeType);
  return Boolean(normalized && allowedMimeTypes.map((value) => value.toLowerCase()).includes(normalized));
}

export function imageMimeTypeToExtension(mimeType: string): string {
  return imageMimeToExtension[normalizeImageMimeType(mimeType) ?? ""] ?? "bin";
}

export function base64ByteLength(data: string): number {
  return Buffer.byteLength(data, "base64");
}
