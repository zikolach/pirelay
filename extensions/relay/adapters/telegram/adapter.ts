import type {
  ChannelAdapter,
  ChannelAdapterKind,
  ChannelButtonLayout,
  ChannelCapabilities,
  ChannelConversation,
  ChannelIdentity,
  ChannelInboundEvent,
  ChannelInboundFile,
  ChannelInboundHandler,
  ChannelInboundMessage,
  ChannelOutboundFile,
  ChannelOutboundPayload,
  ChannelRouteAddress,
} from "../../core/channel-adapter.js";
import type { SharedRoomAddressing } from "../../core/shared-room.js";
import { TelegramApiClient } from "./api.js";
import type {
  TelegramChatSummary,
  TelegramInboundCallback,
  TelegramInboundImageReference,
  TelegramInboundMessage,
  TelegramInlineKeyboard,
  TelegramTunnelConfig,
  TelegramUserSummary,
} from "../../core/types.js";

const TELEGRAM_CHANNEL: ChannelAdapterKind = "telegram";

export interface TelegramApiOperations {
  getUpdates(offset: number | undefined): Promise<Array<TelegramInboundMessage | TelegramInboundCallback>>;
  sendPlainTextWithKeyboard(chatId: number, text: string, keyboard?: TelegramInlineKeyboard): Promise<void>;
  sendDocumentData(chatId: number, filename: string, data: Uint8Array, caption?: string): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string, alert?: boolean): Promise<void>;
  sendChatAction(chatId: number, action?: "typing" | "upload_document" | "record_video"): Promise<void>;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly id = TELEGRAM_CHANNEL;
  readonly displayName = "Telegram";
  readonly capabilities: ChannelCapabilities;
  private polling = false;

  constructor(
    config: TelegramTunnelConfig,
    private readonly api: TelegramApiOperations = new TelegramApiClient(config),
  ) {
    this.capabilities = telegramCapabilities(config);
  }

  async startPolling(handler: ChannelInboundHandler): Promise<void> {
    this.polling = true;
    let offset: number | undefined;
    while (this.polling) {
      try {
        const updates = await this.api.getUpdates(offset);
        for (const update of updates) {
          await handler(telegramUpdateToChannelEvent(update));
          offset = Math.max(offset ?? 0, update.updateId + 1);
        }
      } catch {
        if (this.polling) await sleep(1_500);
      }
    }
  }

  async stopPolling(): Promise<void> {
    this.polling = false;
  }

  async send(payload: ChannelOutboundPayload): Promise<void> {
    switch (payload.kind) {
      case "text":
        await this.sendText(payload.address, payload.text, { buttons: payload.buttons });
        return;
      case "document":
        await this.sendDocument(payload.address, payload.file, { caption: payload.caption, buttons: payload.buttons });
        return;
      case "image":
        await this.sendImage(payload.address, payload.file, { caption: payload.caption, buttons: payload.buttons });
        return;
      case "activity":
        await this.sendActivity(payload.address, payload.activity);
        return;
      case "action-answer":
        await this.answerAction(payload.actionId, { text: payload.text, alert: payload.alert });
        return;
    }
  }

  async sendText(address: ChannelRouteAddress, text: string, options?: { buttons?: ChannelButtonLayout }): Promise<void> {
    await this.api.sendPlainTextWithKeyboard(telegramChatId(address), text, options?.buttons ? toTelegramKeyboard(options.buttons) : undefined);
  }

  async sendDocument(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    await this.api.sendDocumentData(telegramChatId(address), file.fileName, outboundFileBytes(file), options?.caption);
    if (options?.buttons) {
      await this.sendText(address, "Actions:", { buttons: options.buttons });
    }
  }

  async sendImage(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    await this.sendDocument(address, file, options);
  }

  async sendActivity(address: ChannelRouteAddress, activity: "typing" | "uploading" | "recording"): Promise<void> {
    const telegramAction = activity === "uploading" ? "upload_document" : activity === "recording" ? "record_video" : "typing";
    await this.api.sendChatAction(telegramChatId(address), telegramAction);
  }

  async answerAction(actionId: string, options?: { text?: string; alert?: boolean }): Promise<void> {
    await this.api.answerCallbackQuery(actionId, options?.text, options?.alert);
  }
}

export function telegramCapabilities(config: TelegramTunnelConfig): ChannelCapabilities {
  return {
    inlineButtons: true,
    textMessages: true,
    documents: true,
    images: true,
    activityIndicators: true,
    callbacks: true,
    privateChats: true,
    groupChats: false,
    maxTextChars: config.maxTelegramMessageChars,
    maxDocumentBytes: undefined,
    maxImageBytes: config.maxOutboundImageBytes,
    supportedImageMimeTypes: config.allowedImageMimeTypes,
    supportsMarkdown: false,
    sharedRooms: {
      ordinaryText: false,
      mentions: true,
      replies: true,
      platformCommands: true,
      mediaAttachments: true,
      membershipEvents: false,
    },
  };
}

export function telegramUserToChannelIdentity(user: TelegramUserSummary): ChannelIdentity {
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username;
  return {
    channel: TELEGRAM_CHANNEL,
    userId: String(user.id),
    username: user.username,
    displayName,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export function telegramChatToChannelConversation(chat: TelegramChatSummary): ChannelConversation {
  return {
    channel: TELEGRAM_CHANNEL,
    id: String(chat.id),
    kind: chat.type === "private" ? "private" : chat.type === "group" || chat.type === "supergroup" ? "group" : chat.type === "channel" ? "channel" : "unknown",
    title: chat.title,
  };
}

export function telegramImageReferenceToInboundFile(reference: TelegramInboundImageReference): ChannelInboundFile {
  return {
    id: reference.fileId,
    uniqueId: reference.fileUniqueId,
    kind: "image",
    fileName: reference.fileName,
    mimeType: reference.mimeType,
    byteSize: reference.fileSize,
    width: reference.width,
    height: reference.height,
    supported: reference.supported,
    unsupportedReason: reference.unsupportedReason,
    metadata: { telegramKind: reference.kind },
  };
}

export function telegramUpdateToChannelEvent(update: TelegramInboundMessage | TelegramInboundCallback): ChannelInboundEvent {
  if (update.kind === "callback") {
    return {
      kind: "action",
      channel: TELEGRAM_CHANNEL,
      updateId: String(update.updateId),
      actionId: update.callbackQueryId,
      messageId: typeof update.messageId === "number" ? String(update.messageId) : undefined,
      actionData: update.data,
      conversation: telegramChatToChannelConversation(update.chat),
      sender: telegramUserToChannelIdentity(update.user),
    };
  }

  return {
    kind: "message",
    channel: TELEGRAM_CHANNEL,
    updateId: String(update.updateId),
    messageId: String(update.messageId),
    text: update.text,
    attachments: update.images?.map(telegramImageReferenceToInboundFile) ?? [],
    conversation: telegramChatToChannelConversation(update.chat),
    sender: telegramUserToChannelIdentity(update.user),
    metadata: { botMentions: telegramMentionedBotUsernames(update.text) },
  } satisfies ChannelInboundMessage;
}

export function telegramMentionedBotUsernames(text: string): string[] {
  return [...text.matchAll(/@([A-Za-z][A-Za-z0-9_]{4,31})/g)].map((match) => match[1]!).filter(Boolean);
}

export function telegramMessageSharedRoomAddressing(text: string, localBotUsername: string | undefined): SharedRoomAddressing {
  const mentions = telegramMentionedBotUsernames(text).map((username) => username.toLowerCase());
  if (mentions.length === 0) return { kind: "none" };
  if (localBotUsername && mentions.includes(localBotUsername.replace(/^@/, "").toLowerCase())) return { kind: "local" };
  return { kind: "none" };
}

export function toTelegramKeyboard(layout: ChannelButtonLayout): TelegramInlineKeyboard {
  return layout.map((row) => row.map((button) => ({ text: button.label, callbackData: button.actionData })));
}

function telegramChatId(address: ChannelRouteAddress): number {
  const chatId = Number(address.conversationId);
  if (!Number.isSafeInteger(chatId)) throw new Error(`Invalid Telegram chat id: ${address.conversationId}`);
  return chatId;
}

function outboundFileBytes(file: ChannelOutboundFile): Uint8Array {
  if (typeof file.data !== "string") return file.data;
  if (!isCanonicalBase64(file.data)) {
    throw new Error("ChannelOutboundFile.data string values must be base64-encoded.");
  }
  return Buffer.from(file.data, "base64");
}

function isCanonicalBase64(data: string): boolean {
  if (data.length === 0 || data.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  try {
    return Buffer.from(data, "base64").toString("base64") === data;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
