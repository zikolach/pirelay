import { Api, GrammyError, HttpError } from "grammy";
import type { User } from "grammy/types";
import type { TelegramTunnelConfig, TelegramInboundMessage, TelegramOutboundChunk } from "./types.js";
import { chunkTelegramText, redactSecret, sleep } from "./utils.js";

export class TelegramApiClient {
  private readonly api: Api;

  constructor(private readonly config: TelegramTunnelConfig) {
    this.api = new Api(config.botToken);
  }

  async getMe(): Promise<User> {
    return this.api.getMe();
  }

  async getUpdates(offset: number | undefined): Promise<TelegramInboundMessage[]> {
    const updates = await this.api.getUpdates({
      offset,
      timeout: this.config.pollingTimeoutSeconds,
      allowed_updates: ["message"],
    });

    return updates
      .flatMap((update) => {
        const message = update.message;
        if (!message?.text || !message.from || !message.chat) return [];
        return [
          {
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
          } satisfies TelegramInboundMessage,
        ];
      })
      .sort((a, b) => a.updateId - b.updateId);
  }

  async sendPlainText(chatId: number, text: string): Promise<void> {
    const redacted = redactSecret(text, this.config.redactionPatterns);
    const chunks = chunkTelegramText(redacted, this.config.maxTelegramMessageChars);
    for (const chunk of chunks) {
      await this.sendChunk(chatId, chunk);
    }
  }

  private async sendChunk(chatId: number, chunk: TelegramOutboundChunk): Promise<void> {
    const totalAttempts = Math.max(1, this.config.sendRetryCount);
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        await this.api.sendMessage(chatId, chunk.text);
        return;
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
