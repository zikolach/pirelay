import { Api, GrammyError, HttpError, InputFile } from "grammy";
import type { User } from "grammy/types";
import type {
  LatestTurnImage,
  TelegramDownloadedImage,
  TelegramInboundCallback,
  TelegramInboundImageReference,
  TelegramInboundMessage,
  TelegramInboundUpdate,
  TelegramInlineKeyboard,
  TelegramOutboundChunk,
  TelegramTunnelConfig,
} from "../../core/types.js";
import { formatTelegramChatText } from "./formatting.js";
import { chunkTelegramText, isAllowedImageMimeType, normalizeImageMimeType, redactSecret, safeTelegramImageFilename, sleep } from "../../core/utils.js";

export class TelegramApiClient {
  private readonly api: Api;

  constructor(private readonly config: TelegramTunnelConfig) {
    this.api = new Api(config.botToken);
  }

  async getMe(): Promise<User> {
    return this.api.getMe();
  }

  async getUpdates(offset: number | undefined): Promise<TelegramInboundUpdate[]> {
    const updates = await this.api.getUpdates({
      offset,
      timeout: this.config.pollingTimeoutSeconds,
      allowed_updates: ["message", "callback_query"],
    });

    const inbound: TelegramInboundUpdate[] = [];
    const mediaGroups = new Map<string, TelegramInboundMessage>();

    const addMessage = (message: TelegramInboundMessage, mediaGroupId?: string) => {
      if (!mediaGroupId || !message.images || message.images.length === 0) {
        inbound.push(message);
        return;
      }

      const groupKey = `${message.chat.id}:${message.user.id}:${mediaGroupId}`;
      const existing = mediaGroups.get(groupKey);
      if (!existing) {
        mediaGroups.set(groupKey, message);
        return;
      }

      existing.updateId = Math.max(existing.updateId, message.updateId);
      existing.images = [...(existing.images ?? []), ...(message.images ?? [])];
      if (!existing.text && message.text) {
        existing.text = message.text;
      } else if (existing.text && message.text && existing.text !== message.text) {
        existing.text = `${existing.text}\n${message.text}`;
      }
    };

    for (const update of updates) {
      const message = update.message;
      if (message && message.from && message.chat) {
        const text = message.text ?? message.caption ?? "";
        const images = this.extractImageReferences(message);
        if (!text && images.length === 0) {
          // Ignore unsupported non-text/non-image messages.
        } else {
          addMessage({
            kind: "message",
            updateId: update.update_id,
            messageId: message.message_id,
            text,
            images: images.length > 0 ? images : undefined,
            chat: {
              id: message.chat.id,
              type: message.chat.type,
              title: "title" in message.chat ? message.chat.title : undefined,
            },
            user: {
              id: message.from.id,
              username: message.from.username,
              firstName: message.from.first_name,
              lastName: message.from.last_name,
              isBot: message.from.is_bot,
            },
          } satisfies TelegramInboundMessage, typeof message.media_group_id === "string" ? message.media_group_id : undefined);
          continue;
        }
      }

      const callback = update.callback_query;
      const callbackMessage = callback?.message;
      const callbackChat = callbackMessage?.chat;
      if (callback?.data && callback.from && callbackChat) {
        inbound.push({
          kind: "callback",
          updateId: update.update_id,
          callbackQueryId: callback.id,
          messageId: callbackMessage?.message_id,
          data: callback.data,
          chat: {
            id: callbackChat.id,
            type: callbackChat.type,
            title: "title" in callbackChat ? callbackChat.title : undefined,
          },
          user: {
            id: callback.from.id,
            username: callback.from.username,
            firstName: callback.from.first_name,
            lastName: callback.from.last_name,
            isBot: callback.from.is_bot,
          },
        } satisfies TelegramInboundCallback);
      }
    }

    return [...inbound, ...mediaGroups.values()].sort((a, b) => a.updateId - b.updateId);
  }

  async sendPlainText(chatId: number, text: string): Promise<void> {
    await this.sendPlainTextWithKeyboard(chatId, text);
  }

  async sendPlainTextWithKeyboard(chatId: number, text: string, keyboard?: TelegramInlineKeyboard): Promise<void> {
    const redacted = redactSecret(text, this.config.redactionPatterns);
    const formatted = formatTelegramChatText(redacted);
    const chunks = chunkTelegramText(formatted, this.config.maxTelegramMessageChars);
    for (const chunk of chunks) {
      const isLast = chunk.index === chunk.total;
      await this.sendChunk(chatId, chunk, isLast ? keyboard : undefined);
    }
  }

  async sendMarkdownDocument(chatId: number, filename: string, text: string, caption?: string): Promise<void> {
    const redacted = redactSecret(text, this.config.redactionPatterns);
    await this.sendDocumentData(chatId, filename, Buffer.from(redacted, "utf8"), caption);
  }

  async sendDocumentData(chatId: number, filename: string, data: Uint8Array, caption?: string): Promise<void> {
    const redactedCaption = caption ? redactSecret(caption, this.config.redactionPatterns) : undefined;
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await this.withRetry(() => this.api.sendDocument(
      chatId,
      new InputFile(bytes, filename),
      redactedCaption ? { caption: redactedCaption } : undefined,
    ));
  }

  async downloadImage(reference: TelegramInboundImageReference): Promise<TelegramDownloadedImage> {
    if (!reference.supported) {
      throw new Error(reference.unsupportedReason || "Unsupported image attachment.");
    }
    if (reference.fileSize && reference.fileSize > this.config.maxInboundImageBytes) {
      throw new Error(`Image is too large (${reference.fileSize} bytes). Limit: ${this.config.maxInboundImageBytes} bytes.`);
    }

    const telegramFile = await this.withRetry(() => this.api.getFile(reference.fileId));
    const remoteSize = telegramFile.file_size ?? reference.fileSize;
    if (remoteSize && remoteSize > this.config.maxInboundImageBytes) {
      throw new Error(`Image is too large (${remoteSize} bytes). Limit: ${this.config.maxInboundImageBytes} bytes.`);
    }
    if (!telegramFile.file_path) {
      throw new Error("Telegram did not return a downloadable file path for this image.");
    }

    const response = await fetch(`https://api.telegram.org/file/bot${this.config.botToken}/${telegramFile.file_path}`);
    if (!response.ok) {
      throw new Error(`Telegram file download failed with HTTP ${response.status}.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > this.config.maxInboundImageBytes) {
      throw new Error(`Image is too large (${buffer.byteLength} bytes). Limit: ${this.config.maxInboundImageBytes} bytes.`);
    }

    const mimeType = normalizeImageMimeType(reference.mimeType) ?? reference.mimeType;
    if (!isAllowedImageMimeType(mimeType, this.config.allowedImageMimeTypes)) {
      throw new Error(`Unsupported image type: ${mimeType}.`);
    }

    return {
      image: { type: "image", data: buffer.toString("base64"), mimeType },
      fileName: safeTelegramImageFilename(reference.fileName, mimeType, reference.kind === "photo" ? "telegram-photo" : "telegram-image"),
      fileSize: buffer.byteLength,
      source: reference,
    };
  }

  async sendImageDocument(chatId: number, image: LatestTurnImage, caption?: string): Promise<void> {
    const bytes = Buffer.from(image.data, "base64");
    const redactedCaption = caption ? redactSecret(caption, this.config.redactionPatterns) : undefined;
    await this.withRetry(() => this.api.sendDocument(
      chatId,
      new InputFile(bytes, safeTelegramImageFilename(image.fileName, image.mimeType)),
      redactedCaption ? { caption: redactedCaption } : undefined,
    ));
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, alert = false): Promise<void> {
    const options = text || alert ? { text, show_alert: alert } : undefined;
    await this.withRetry(() => this.api.answerCallbackQuery(callbackQueryId, options));
  }

  async sendChatAction(chatId: number, action: "typing" | "upload_document" | "record_video" = "typing"): Promise<void> {
    await this.withRetry(() => this.api.sendChatAction(chatId, action));
  }

  private extractImageReferences(message: Record<string, any>): TelegramInboundImageReference[] {
    const references: TelegramInboundImageReference[] = [];
    const photo = Array.isArray(message.photo) ? this.selectBestPhotoSize(message.photo) : undefined;
    if (photo?.file_id) {
      references.push({
        kind: "photo",
        fileId: photo.file_id,
        fileUniqueId: photo.file_unique_id,
        mimeType: "image/jpeg",
        fileSize: typeof photo.file_size === "number" ? photo.file_size : undefined,
        width: typeof photo.width === "number" ? photo.width : undefined,
        height: typeof photo.height === "number" ? photo.height : undefined,
        supported: true,
      });
    }

    const document = message.document;
    if (document?.file_id) {
      const mimeType = normalizeImageMimeType(document.mime_type) ?? "application/octet-stream";
      const supported = isAllowedImageMimeType(mimeType, this.config.allowedImageMimeTypes);
      references.push({
        kind: "document",
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        fileName: typeof document.file_name === "string" ? document.file_name : undefined,
        mimeType,
        fileSize: typeof document.file_size === "number" ? document.file_size : undefined,
        supported,
        unsupportedReason: supported ? undefined : `Unsupported image document type: ${mimeType}.`,
      });
    }

    return references;
  }

  private selectBestPhotoSize(photoSizes: Array<Record<string, any>>): Record<string, any> | undefined {
    const sorted = [...photoSizes]
      .filter((photo) => typeof photo.file_id === "string")
      .sort((left, right) => {
        const leftArea = Number(left.width ?? 0) * Number(left.height ?? 0);
        const rightArea = Number(right.width ?? 0) * Number(right.height ?? 0);
        return rightArea - leftArea;
      });
    return sorted.find((photo) => typeof photo.file_size !== "number" || photo.file_size <= this.config.maxInboundImageBytes) ?? sorted[0];
  }

  private async sendChunk(chatId: number, chunk: TelegramOutboundChunk, keyboard?: TelegramInlineKeyboard): Promise<void> {
    await this.withRetry(() => this.api.sendMessage(chatId, chunk.text, keyboard ? { reply_markup: toTelegramReplyMarkup(keyboard) } : undefined));
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const totalAttempts = Math.max(1, this.config.sendRetryCount);
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const retryAfterMs = getRetryDelay(error) ?? this.config.sendRetryBaseMs * attempt;
        if (attempt >= totalAttempts || !isRetriableError(error)) {
          break;
        }
        await sleep(retryAfterMs);
      }
    }

    throw normalizeTelegramError(lastError);
  }
}

export function toTelegramReplyMarkup(keyboard: TelegramInlineKeyboard): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: keyboard.map((row) => row.map((button) => ({
      text: button.text,
      callback_data: button.callbackData,
    }))),
  };
}

export function isRetriableError(error: unknown): boolean {
  if (error instanceof HttpError) return true;
  if (error instanceof GrammyError) {
    return error.error_code === 429 || error.error_code >= 500;
  }
  return false;
}

export function getRetryDelay(error: unknown): number | undefined {
  if (error instanceof GrammyError && error.parameters?.retry_after) {
    return error.parameters.retry_after * 1000;
  }
  return undefined;
}

export function normalizeTelegramError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}
