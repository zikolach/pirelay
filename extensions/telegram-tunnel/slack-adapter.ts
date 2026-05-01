import { createHmac, timingSafeEqual } from "node:crypto";
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
import type { SlackRelayConfig } from "./types.js";

export interface SlackApiOperations {
  startSocketMode?(handler: (event: SlackEnvelope) => Promise<void>): Promise<void>;
  stopSocketMode?(): Promise<void>;
  postMessage(payload: SlackPostMessagePayload): Promise<void>;
  uploadFile(payload: SlackUploadFilePayload): Promise<void>;
  postEphemeral(payload: { channel: string; user: string; text: string }): Promise<void>;
}

export interface SlackEnvelope {
  type: "event_callback" | "block_actions";
  event?: SlackMessageEvent;
  actions?: Array<{ action_id?: string; value?: string }>;
  user?: { id: string; username?: string; name?: string; team_id?: string };
  channel?: { id: string };
  message?: { ts?: string };
  trigger_id?: string;
  team?: { id: string };
}

export interface SlackMessageEvent {
  type: "message";
  channel_type?: "im" | "channel" | "group" | "mpim";
  channel: string;
  user?: string;
  username?: string;
  text?: string;
  ts: string;
  team?: string;
  files?: SlackFilePayload[];
}

export interface SlackFilePayload {
  id: string;
  name?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
}

export interface SlackPostMessagePayload {
  channel: string;
  text: string;
  blocks?: SlackButtonElement[][];
}

export interface SlackUploadFilePayload {
  channel: string;
  fileName: string;
  data: Uint8Array;
  mimeType: string;
  caption?: string;
}

export interface SlackButtonElement {
  type: "button";
  text: string;
  value: string;
  style?: "primary" | "danger";
}

const SLACK_CHANNEL = "slack" as const;
const DEFAULT_SLACK_MAX_TEXT_CHARS = 3_000;
const DEFAULT_SLACK_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export class SlackChannelAdapter implements ChannelAdapter {
  readonly id = SLACK_CHANNEL;
  readonly displayName = "Slack";
  readonly capabilities: ChannelCapabilities;

  constructor(
    private readonly config: SlackRelayConfig,
    private readonly api: SlackApiOperations,
  ) {
    this.capabilities = slackCapabilities(config);
  }

  async startPolling(handler: ChannelInboundHandler): Promise<void> {
    if (!this.api.startSocketMode) return;
    await this.api.startSocketMode(async (envelope) => {
      await handler(slackEnvelopeToChannelEvent(envelope, this.config));
    });
  }

  async stopPolling(): Promise<void> {
    await this.api.stopSocketMode?.();
  }

  async handleWebhook(payload: unknown, headers: Record<string, string>, handler: ChannelInboundHandler): Promise<void> {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const timestamp = headers["x-slack-request-timestamp"] ?? headers["X-Slack-Request-Timestamp"];
    const signature = headers["x-slack-signature"] ?? headers["X-Slack-Signature"];
    if (!timestamp || !signature || !verifySlackSignature({ body, timestamp, signature, signingSecret: this.config.signingSecret })) {
      throw new Error("Invalid Slack signature.");
    }
    await handler(slackEnvelopeToChannelEvent(typeof payload === "string" ? JSON.parse(payload) as SlackEnvelope : payload as SlackEnvelope, this.config));
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
        await this.answerAction(payload.actionId, { text: payload.text });
        return;
    }
  }

  async sendText(address: ChannelRouteAddress, text: string, options?: { buttons?: ChannelButtonLayout }): Promise<void> {
    for (const chunk of channelTextChunks(this, text || " ")) {
      await this.api.postMessage({ channel: address.conversationId, text: chunk });
    }
    if (options?.buttons && options.buttons.length > 0) {
      await this.api.postMessage({ channel: address.conversationId, text: "Actions:", blocks: slackBlocksForButtons(options.buttons) });
    }
  }

  async sendDocument(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    await this.api.uploadFile({
      channel: address.conversationId,
      fileName: file.fileName,
      data: outboundFileBytes(file),
      mimeType: file.mimeType,
      caption: options?.caption,
    });
    if (options?.buttons) await this.sendText(address, "Actions:", { buttons: options.buttons });
  }

  async sendImage(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    await this.sendDocument(address, file, options);
  }

  async sendActivity(address: ChannelRouteAddress, _activity: "typing" | "uploading" | "recording" = "typing"): Promise<void> {
    await this.api.postEphemeral({ channel: address.conversationId, user: address.userId, text: "Pi is working…" });
  }

  async answerAction(actionId: string, options?: { text?: string }): Promise<void> {
    await this.api.postEphemeral({ channel: actionId, user: "", text: options?.text ?? "Done" });
  }
}

export function slackCapabilities(config: Pick<SlackRelayConfig, "allowChannelMessages" | "maxTextChars" | "maxFileBytes" | "allowedImageMimeTypes">): ChannelCapabilities {
  return {
    inlineButtons: true,
    textMessages: true,
    documents: true,
    images: true,
    activityIndicators: true,
    callbacks: true,
    privateChats: true,
    groupChats: Boolean(config.allowChannelMessages),
    maxTextChars: config.maxTextChars ?? DEFAULT_SLACK_MAX_TEXT_CHARS,
    maxDocumentBytes: config.maxFileBytes ?? DEFAULT_SLACK_MAX_FILE_BYTES,
    maxImageBytes: config.maxFileBytes ?? DEFAULT_SLACK_MAX_FILE_BYTES,
    supportedImageMimeTypes: config.allowedImageMimeTypes ?? DEFAULT_IMAGE_MIME_TYPES,
    supportsMarkdown: true,
  };
}

export function verifySlackSignature(input: { body: string; timestamp: string; signature: string; signingSecret: string; nowSeconds?: number }): boolean {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 5 * 60) return false;
  const expected = `v0=${createHmac("sha256", input.signingSecret).update(`v0:${input.timestamp}:${input.body}`).digest("hex")}`;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(input.signature);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function slackEnvelopeToChannelEvent(envelope: SlackEnvelope, config: SlackRelayConfig): ChannelInboundEvent {
  if (envelope.type === "block_actions") {
    const action = envelope.actions?.[0];
    const channelId = envelope.channel?.id ?? "";
    const user = envelope.user ?? { id: "unknown" };
    return {
      kind: "action",
      channel: SLACK_CHANNEL,
      updateId: envelope.trigger_id ?? `${channelId}:${envelope.message?.ts ?? Date.now()}`,
      actionId: envelope.trigger_id ?? channelId,
      messageId: envelope.message?.ts,
      actionData: action?.value ?? action?.action_id ?? "",
      conversation: slackConversation(channelId, "im"),
      sender: slackIdentity(user.id, user.username ?? user.name, user.team_id ?? envelope.team?.id),
      metadata: { teamId: envelope.team?.id },
    };
  }
  if (!envelope.event) throw new Error("Slack envelope does not contain a supported event.");
  return slackEventToChannelEvent(envelope.event, config);
}

export function isSlackIdentityAllowed(identity: ChannelIdentity, config: Pick<SlackRelayConfig, "allowUserIds" | "workspaceId">): boolean {
  const teamId = typeof identity.metadata?.teamId === "string" ? identity.metadata.teamId : undefined;
  if (config.workspaceId && teamId && config.workspaceId !== teamId) return false;
  const allowed = config.allowUserIds ?? [];
  return allowed.length === 0 || allowed.includes(identity.userId);
}

export function slackPairingCommand(code: string): string {
  return `/pirelay ${code}`;
}

export function slackEventToChannelEvent(event: SlackMessageEvent, config: Pick<SlackRelayConfig, "allowedImageMimeTypes" | "maxFileBytes">): ChannelInboundMessage {
  const teamId = event.team;
  return {
    kind: "message",
    channel: SLACK_CHANNEL,
    updateId: event.ts,
    messageId: event.ts,
    text: event.text ?? "",
    attachments: (event.files ?? []).map((file) => slackFileToInboundFile(file, config)),
    conversation: slackConversation(event.channel, event.channel_type),
    sender: slackIdentity(event.user ?? event.username ?? "unknown", event.username, teamId),
    metadata: { teamId },
  };
}

function slackConversation(channel: string, channelType: SlackMessageEvent["channel_type"]): ChannelConversation {
  return {
    channel: SLACK_CHANNEL,
    id: channel,
    kind: channelType === "im" ? "private" : channelType === "channel" || channelType === "group" ? "channel" : channelType === "mpim" ? "group" : "unknown",
  };
}

function slackIdentity(userId: string, username?: string, teamId?: string): ChannelIdentity {
  return {
    channel: SLACK_CHANNEL,
    userId,
    username,
    displayName: username,
    metadata: { teamId },
  };
}

function slackFileToInboundFile(file: SlackFilePayload, config: Pick<SlackRelayConfig, "allowedImageMimeTypes" | "maxFileBytes">): ChannelInboundFile {
  const image = Boolean(file.mimetype?.startsWith("image/"));
  const supportedMime = !file.mimetype || (config.allowedImageMimeTypes ?? DEFAULT_IMAGE_MIME_TYPES).includes(file.mimetype);
  const supportedSize = typeof file.size !== "number" || file.size <= (config.maxFileBytes ?? DEFAULT_SLACK_MAX_FILE_BYTES);
  return {
    id: file.id,
    kind: image ? "image" : "document",
    fileName: file.name,
    mimeType: file.mimetype,
    byteSize: file.size,
    supported: supportedMime && supportedSize,
    unsupportedReason: !supportedMime ? "Unsupported MIME type." : !supportedSize ? "File is too large." : undefined,
    metadata: { url: file.url_private_download },
  };
}

function slackBlocksForButtons(layout: ChannelButtonLayout): SlackButtonElement[][] {
  return layout.map((row) => row.map((button) => ({
    type: "button",
    text: button.label,
    value: button.actionData,
    style: button.style === "primary" ? "primary" : button.style === "danger" ? "danger" : undefined,
  })));
}

function outboundFileBytes(file: ChannelOutboundFile): Uint8Array {
  return typeof file.data === "string" ? Buffer.from(file.data, "base64") : file.data;
}
