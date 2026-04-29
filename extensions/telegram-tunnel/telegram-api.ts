import { Api, GrammyError, HttpError, InputFile } from "grammy";
import type { User } from "grammy/types";
import type { TelegramTunnelConfig, TelegramInboundCallback, TelegramInboundMessage, TelegramInboundUpdate, TelegramInlineKeyboard, TelegramOutboundChunk } from "./types.js";
import { formatTelegramChatText } from "./telegram-format.js";
import { chunkTelegramText, redactSecret, sleep } from "./utils.js";

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
    for (const update of updates) {
      const message = update.message;
      if (message?.text && message.from && message.chat) {
        inbound.push({
          kind: "message",
          updateId: update.update_id,
          messageId: message.message_id,
          text: message.text,
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
          },
        } satisfies TelegramInboundMessage);
        continue;
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
          },
        } satisfies TelegramInboundCallback);
      }
    }

    return inbound.sort((a, b) => a.updateId - b.updateId);
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
    await this.withRetry(() => this.api.sendDocument(
      chatId,
      new InputFile(Buffer.from(redacted, "utf8"), filename),
      caption ? { caption } : undefined,
    ));
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.withRetry(() => this.api.answerCallbackQuery(callbackQueryId, text ? { text } : undefined));
  }

  async sendChatAction(chatId: number, action: "typing" = "typing"): Promise<void> {
    await this.withRetry(() => this.api.sendChatAction(chatId, action));
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
