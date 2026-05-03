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
} from "../../core/channel-adapter.js";
import { assertCanSendOutboundFile, channelTextChunks, decodeOutboundFileData } from "../../core/channel-adapter.js";
import type { DiscordRelayConfig } from "../../core/types.js";

export interface DiscordApiOperations {
  connect?(handler: (event: DiscordGatewayEvent) => Promise<void>): Promise<void>;
  disconnect?(): Promise<void>;
  sendMessage(payload: DiscordSendMessagePayload): Promise<void>;
  sendFile(payload: DiscordSendFilePayload): Promise<void>;
  sendTyping(channelId: string): Promise<void>;
  answerInteraction(interactionId: string, interactionToken: string | undefined, options?: { text?: string; alert?: boolean }): Promise<void>;
  downloadFile?(url: string): Promise<Uint8Array>;
}

export interface DiscordGatewayEvent {
  type: "message" | "interaction";
  payload: DiscordMessagePayload | DiscordInteractionPayload;
}

export interface DiscordMessagePayload {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: { id: string; username?: string; global_name?: string; discriminator?: string; bot?: boolean };
  webhook_id?: string;
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
  token?: string;
  channel_id: string;
  guild_id?: string;
  user?: { id: string; username?: string; global_name?: string; discriminator?: string; bot?: boolean };
  member?: { user?: { id: string; username?: string; global_name?: string; discriminator?: string; bot?: boolean } };
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
      const normalized = discordGatewayEventToChannelEvent(event, this.config);
      if (normalized) await handler(normalized);
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
    const chunks = channelTextChunks(this, escapeDiscordPlainText(text || " "));
    for (const chunk of chunks) {
      await this.api.sendMessage({ channelId: address.conversationId, content: chunk });
    }
    if (options?.buttons && options.buttons.length > 0) {
      await this.api.sendMessage({ channelId: address.conversationId, content: "Actions:", components: discordComponentsForButtons(options.buttons) });
    }
  }

  async sendDocument(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    assertCanSendOutboundFile(this, file, "document");
    await this.api.sendFile({
      channelId: address.conversationId,
      fileName: file.fileName,
      data: decodeOutboundFileData(file),
      caption: options?.caption ? escapeDiscordPlainText(options.caption) : undefined,
      mimeType: file.mimeType,
    });
    if (options?.buttons) await this.sendButtonPrompt(address, options.buttons);
  }

  async sendImage(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    assertCanSendOutboundFile(this, file, "image");
    await this.sendDocument(address, file, options);
  }

  async sendActivity(address: ChannelRouteAddress, _activity: "typing" | "uploading" | "recording" = "typing"): Promise<void> {
    await this.api.sendTyping(address.conversationId);
  }

  async answerAction(actionId: string, options?: { text?: string; alert?: boolean }): Promise<void> {
    const parsed = parseDiscordActionId(actionId);
    await this.api.answerInteraction(parsed.interactionId, parsed.interactionToken, options ? { ...options, text: options.text ? escapeDiscordPlainText(options.text) : undefined } : undefined);
  }

  async downloadAttachment(file: ChannelInboundFile): Promise<Uint8Array> {
    const url = typeof file.metadata?.url === "string" ? file.metadata.url : undefined;
    if (!url || !this.api.downloadFile) throw new Error("Discord attachment download URL is unavailable.");
    return this.api.downloadFile(url);
  }

  private async sendButtonPrompt(address: ChannelRouteAddress, buttons: ChannelButtonLayout): Promise<void> {
    await this.api.sendMessage({ channelId: address.conversationId, content: "Actions:", components: discordComponentsForButtons(buttons) });
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

export function discordGatewayEventToChannelEvent(event: DiscordGatewayEvent, config: DiscordRelayConfig): ChannelInboundEvent | undefined {
  return event.type === "interaction"
    ? discordInteractionToChannelEvent(event.payload as DiscordInteractionPayload)
    : discordMessageToChannelEvent(event.payload as DiscordMessagePayload, config);
}

export function discordMessageToChannelEvent(message: DiscordMessagePayload, config: Pick<DiscordRelayConfig, "allowedImageMimeTypes" | "maxFileBytes">): ChannelInboundMessage | undefined {
  if (message.author.bot || message.webhook_id) return undefined;
  const conversation = discordConversation(message.channel_id, message.guild_id);
  const sender = discordIdentity(message.author, message.guild_id);
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
    actionId: buildDiscordActionId(interaction.id, interaction.token),
    messageId: interaction.message?.id,
    actionData: interaction.data?.custom_id ?? "",
    conversation: discordConversation(interaction.channel_id, interaction.guild_id),
    sender: discordIdentity(user, interaction.guild_id),
    metadata: { guildId: interaction.guild_id },
  };
}

export function isDiscordGuildMessage(event: ChannelInboundEvent): boolean {
  return event.channel === DISCORD_CHANNEL && event.conversation.kind !== "private";
}

export function isDiscordIdentityAllowed(identity: ChannelIdentity, config: Pick<DiscordRelayConfig, "allowUserIds" | "allowGuildChannels" | "allowGuildIds">): boolean {
  const allowed = config.allowUserIds ?? [];
  if (allowed.length > 0 && !allowed.includes(identity.userId)) return false;
  const guildId = typeof identity.metadata?.guildId === "string" ? identity.metadata.guildId : undefined;
  if (!guildId) return true;
  if (!config.allowGuildChannels) return false;
  const allowedGuilds = config.allowGuildIds ?? [];
  return allowedGuilds.length > 0 && allowedGuilds.includes(guildId);
}

export function discordPairingCommand(code: string): string {
  return `/start ${code}`;
}

export function escapeDiscordPlainText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([`*_~|>#])/g, "\\$1")
    .replace(/@(everyone|here|&?\d+)/g, "@\u200b$1");
}

function discordConversation(channelId: string, guildId?: string): ChannelConversation {
  return {
    channel: DISCORD_CHANNEL,
    id: channelId,
    kind: guildId ? "group" : "private",
    metadata: guildId ? { guildId } : undefined,
  };
}

function discordIdentity(user: { id: string; username?: string; global_name?: string; discriminator?: string }, guildId?: string): ChannelIdentity {
  return {
    channel: DISCORD_CHANNEL,
    userId: user.id,
    username: user.username,
    displayName: user.global_name ?? user.username,
    metadata: { discriminator: user.discriminator, guildId },
  };
}

function discordAttachmentToInboundFile(attachment: DiscordAttachmentPayload, config: Pick<DiscordRelayConfig, "allowedImageMimeTypes" | "maxFileBytes">): ChannelInboundFile {
  const mimeType = attachment.content_type;
  const image = Boolean(mimeType?.startsWith("image/"));
  const supportedMime = !image || !mimeType || (config.allowedImageMimeTypes ?? DEFAULT_IMAGE_MIME_TYPES).includes(mimeType);
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

export function buildDiscordActionId(interactionId: string, interactionToken?: string): string {
  return interactionToken ? `${interactionId}:${encodeURIComponent(interactionToken)}` : interactionId;
}

export function parseDiscordActionId(actionId: string): { interactionId: string; interactionToken?: string } {
  const [interactionId, encodedToken] = actionId.split(":", 2);
  return { interactionId: interactionId ?? actionId, interactionToken: encodedToken ? decodeURIComponent(encodedToken) : undefined };
}
