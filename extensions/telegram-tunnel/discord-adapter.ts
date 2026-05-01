import type {
  ChannelAdapter,
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
} from "./channel-adapter.js";
import { channelTextChunks } from "./channel-adapter.js";
import type { DiscordRelayConfig } from "./types.js";

export interface DiscordApiOperations {
  connect?(handler: (event: DiscordGatewayEvent) => Promise<void>): Promise<void>;
  disconnect?(): Promise<void>;
  sendMessage(payload: DiscordSendMessagePayload): Promise<void>;
  sendFile(payload: DiscordSendFilePayload): Promise<void>;
  sendTyping(channelId: string): Promise<void>;
  answerInteraction(interactionId: string, options?: { text?: string; alert?: boolean }): Promise<void>;
}

export interface DiscordGatewayEvent {
  type: "message" | "interaction";
  payload: DiscordMessagePayload | DiscordInteractionPayload;
}

export interface DiscordMessagePayload {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: { id: string; username?: string; global_name?: string; discriminator?: string };
  content?: string;
  attachments?: DiscordAttachmentPayload[];
}

export interface DiscordAttachmentPayload {
  id: string;
  filename?: string;
  content_type?: string;
  size?: number;
  url?: string;
  width?: number;
  height?: number;
}

export interface DiscordInteractionPayload {
  id: string;
  channel_id: string;
  guild_id?: string;
  user?: { id: string; username?: string; global_name?: string; discriminator?: string };
  member?: { user?: { id: string; username?: string; global_name?: string; discriminator?: string } };
  data?: { custom_id?: string };
  message?: { id?: string };
}

export interface DiscordSendMessagePayload {
  channelId: string;
  content: string;
  components?: DiscordButtonComponent[][];
}

export interface DiscordSendFilePayload {
  channelId: string;
  fileName: string;
  data: Uint8Array;
  caption?: string;
  mimeType: string;
}

export interface DiscordButtonComponent {
  label: string;
  customId: string;
  style: "secondary" | "primary" | "danger";
}

const DISCORD_CHANNEL = "discord" as const;
const DEFAULT_DISCORD_MAX_TEXT_CHARS = 2_000;
const DEFAULT_DISCORD_MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export class DiscordChannelAdapter implements ChannelAdapter {
  readonly id = DISCORD_CHANNEL;
  readonly displayName = "Discord";
  readonly capabilities: ChannelCapabilities;

  constructor(
    private readonly config: DiscordRelayConfig,
    private readonly api: DiscordApiOperations,
  ) {
    this.capabilities = discordCapabilities(config);
  }

  async startPolling(handler: ChannelInboundHandler): Promise<void> {
    if (!this.api.connect) return;
    await this.api.connect(async (event) => {
      await handler(discordGatewayEventToChannelEvent(event, this.config));
    });
  }

  async stopPolling(): Promise<void> {
    await this.api.disconnect?.();
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
    const chunks = channelTextChunks(this, text || " ");
    for (const chunk of chunks) {
      await this.api.sendMessage({ channelId: address.conversationId, content: chunk });
    }
    if (options?.buttons && options.buttons.length > 0) {
      await this.api.sendMessage({ channelId: address.conversationId, content: "Actions:", components: discordComponentsForButtons(options.buttons) });
    }
  }

  async sendDocument(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    await this.api.sendFile({
      channelId: address.conversationId,
      fileName: file.fileName,
      data: outboundFileBytes(file),
      caption: options?.caption,
      mimeType: file.mimeType,
    });
    if (options?.buttons) await this.sendText(address, "Actions:", { buttons: options.buttons });
  }

  async sendImage(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    await this.sendDocument(address, file, options);
  }

  async sendActivity(address: ChannelRouteAddress, _activity: "typing" | "uploading" | "recording" = "typing"): Promise<void> {
    await this.api.sendTyping(address.conversationId);
  }

  async answerAction(actionId: string, options?: { text?: string; alert?: boolean }): Promise<void> {
    await this.api.answerInteraction(actionId, options);
  }
}

export function discordCapabilities(config: Pick<DiscordRelayConfig, "allowGuildChannels" | "maxTextChars" | "maxFileBytes" | "allowedImageMimeTypes">): ChannelCapabilities {
  return {
    inlineButtons: true,
    textMessages: true,
    documents: true,
    images: true,
    activityIndicators: true,
    callbacks: true,
    privateChats: true,
    groupChats: Boolean(config.allowGuildChannels),
    maxTextChars: config.maxTextChars ?? DEFAULT_DISCORD_MAX_TEXT_CHARS,
    maxDocumentBytes: config.maxFileBytes ?? DEFAULT_DISCORD_MAX_FILE_BYTES,
    maxImageBytes: config.maxFileBytes ?? DEFAULT_DISCORD_MAX_FILE_BYTES,
    supportedImageMimeTypes: config.allowedImageMimeTypes ?? DEFAULT_IMAGE_MIME_TYPES,
    supportsMarkdown: true,
  };
}

export function discordGatewayEventToChannelEvent(event: DiscordGatewayEvent, config: DiscordRelayConfig): ChannelInboundEvent {
  return event.type === "interaction"
    ? discordInteractionToChannelEvent(event.payload as DiscordInteractionPayload)
    : discordMessageToChannelEvent(event.payload as DiscordMessagePayload, config);
}

export function discordMessageToChannelEvent(message: DiscordMessagePayload, config: Pick<DiscordRelayConfig, "allowedImageMimeTypes" | "maxFileBytes">): ChannelInboundMessage {
  const conversation = discordConversation(message.channel_id, message.guild_id);
  const sender = discordIdentity(message.author);
  return {
    kind: "message",
    channel: DISCORD_CHANNEL,
    updateId: message.id,
    messageId: message.id,
    text: message.content ?? "",
    attachments: (message.attachments ?? []).map((attachment) => discordAttachmentToInboundFile(attachment, config)),
    conversation,
    sender,
    metadata: { guildId: message.guild_id },
  };
}

export function discordInteractionToChannelEvent(interaction: DiscordInteractionPayload): ChannelInboundEvent {
  const user = interaction.user ?? interaction.member?.user ?? { id: "unknown" };
  return {
    kind: "action",
    channel: DISCORD_CHANNEL,
    updateId: interaction.id,
    actionId: interaction.id,
    messageId: interaction.message?.id,
    actionData: interaction.data?.custom_id ?? "",
    conversation: discordConversation(interaction.channel_id, interaction.guild_id),
    sender: discordIdentity(user),
    metadata: { guildId: interaction.guild_id },
  };
}

export function isDiscordGuildMessage(event: ChannelInboundEvent): boolean {
  return event.channel === DISCORD_CHANNEL && event.conversation.kind !== "private";
}

export function isDiscordIdentityAllowed(identity: ChannelIdentity, config: Pick<DiscordRelayConfig, "allowUserIds">): boolean {
  const allowed = config.allowUserIds ?? [];
  return allowed.length === 0 || allowed.includes(identity.userId);
}

export function discordPairingCommand(code: string): string {
  return `/start ${code}`;
}

function discordConversation(channelId: string, guildId?: string): ChannelConversation {
  return {
    channel: DISCORD_CHANNEL,
    id: channelId,
    kind: guildId ? "group" : "private",
    metadata: guildId ? { guildId } : undefined,
  };
}

function discordIdentity(user: { id: string; username?: string; global_name?: string; discriminator?: string }): ChannelIdentity {
  return {
    channel: DISCORD_CHANNEL,
    userId: user.id,
    username: user.username,
    displayName: user.global_name ?? user.username,
    metadata: { discriminator: user.discriminator },
  };
}

function discordAttachmentToInboundFile(attachment: DiscordAttachmentPayload, config: Pick<DiscordRelayConfig, "allowedImageMimeTypes" | "maxFileBytes">): ChannelInboundFile {
  const mimeType = attachment.content_type;
  const image = Boolean(mimeType?.startsWith("image/"));
  const supportedMime = !mimeType || (config.allowedImageMimeTypes ?? DEFAULT_IMAGE_MIME_TYPES).includes(mimeType);
  const supportedSize = typeof attachment.size !== "number" || attachment.size <= (config.maxFileBytes ?? DEFAULT_DISCORD_MAX_FILE_BYTES);
  return {
    id: attachment.id,
    kind: image ? "image" : "document",
    fileName: attachment.filename,
    mimeType,
    byteSize: attachment.size,
    width: attachment.width,
    height: attachment.height,
    supported: supportedMime && supportedSize,
    unsupportedReason: !supportedMime ? "Unsupported MIME type." : !supportedSize ? "File is too large." : undefined,
    metadata: { url: attachment.url },
  };
}

function discordComponentsForButtons(layout: ChannelButtonLayout): DiscordButtonComponent[][] {
  return layout.map((row) => row.map((button) => ({
    label: button.label,
    customId: button.actionData,
    style: button.style === "primary" ? "primary" : button.style === "danger" ? "danger" : "secondary",
  })));
}

function outboundFileBytes(file: ChannelOutboundFile): Uint8Array {
  return typeof file.data === "string" ? Buffer.from(file.data, "base64") : file.data;
}
