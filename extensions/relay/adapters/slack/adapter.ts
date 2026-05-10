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
} from "../../core/channel-adapter.js";
import { assertCanSendOutboundFile, channelTextChunks, decodeOutboundFileData } from "../../core/channel-adapter.js";
import type { SlackRelayConfig } from "../../core/types.js";
import type { SharedRoomAddressing } from "../../core/shared-room.js";

export interface SlackApiOperations {
  startSocketMode?(handler: (event: SlackEnvelope) => Promise<void>): Promise<void>;
  stopSocketMode?(): Promise<void>;
  authTest?(): Promise<SlackAuthTestResult>;
  postMessage(payload: SlackPostMessagePayload): Promise<void>;
  uploadFile(payload: SlackUploadFilePayload): Promise<void>;
  postEphemeral(payload: { channel: string; user: string; text: string }): Promise<void>;
  postResponse?(responseUrl: string, payload: { text: string; replaceOriginal?: boolean; ephemeral?: boolean }): Promise<void>;
  downloadFile?(url: string): Promise<Uint8Array>;
}

export interface SlackAuthTestResult {
  teamId: string;
  userId: string;
  botId?: string;
  appId?: string;
}

export interface SlackEnvelope {
  type: "event_callback" | "block_actions";
  envelopeId?: string;
  eventId?: string;
  retryAttempt?: number;
  retryReason?: string;
  event?: SlackMessageEvent;
  actions?: Array<{ action_id?: string; value?: string }>;
  user?: { id: string; username?: string; name?: string; team_id?: string };
  channel?: { id: string };
  message?: { ts?: string; thread_ts?: string };
  trigger_id?: string;
  response_url?: string;
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
  thread_ts?: string;
  team?: string;
  bot_id?: string;
  subtype?: string;
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
  threadTs?: string;
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
      const normalized = slackEnvelopeToChannelEvent(envelope, this.config);
      if (normalized) await handler(normalized);
    });
  }

  async stopPolling(): Promise<void> {
    await this.api.stopSocketMode?.();
  }

  async handleWebhook(payload: unknown, headers: Record<string, string>, handler: ChannelInboundHandler): Promise<void> {
    const body = rawSlackBody(payload, headers);
    const timestamp = headers["x-slack-request-timestamp"] ?? headers["X-Slack-Request-Timestamp"];
    const signature = headers["x-slack-signature"] ?? headers["X-Slack-Signature"];
    if (!this.config.signingSecret || !timestamp || !signature || !verifySlackSignature({ body, timestamp, signature, signingSecret: this.config.signingSecret })) {
      throw new Error("Invalid Slack signature.");
    }
    const normalized = slackEnvelopeToChannelEvent(parseSlackWebhookBody(body, payload), this.config);
    if (normalized) await handler(normalized);
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
    const threadTs = slackThreadTs(address);
    for (const chunk of channelTextChunks(this, text || " ")) {
      await this.api.postMessage({ channel: address.conversationId, text: chunk, threadTs });
    }
    if (options?.buttons && options.buttons.length > 0) {
      await this.api.postMessage({ channel: address.conversationId, text: "Actions:", threadTs, blocks: slackBlocksForButtons(options.buttons) });
    }
  }

  async sendDocument(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    assertCanSendOutboundFile(this, file, "document");
    await this.api.uploadFile({
      channel: address.conversationId,
      fileName: file.fileName,
      data: decodeOutboundFileData(file),
      mimeType: file.mimeType,
      caption: options?.caption,
    });
    if (options?.buttons) await this.sendButtonPrompt(address, options.buttons);
  }

  async sendImage(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void> {
    assertCanSendOutboundFile(this, file, "image");
    await this.sendDocument(address, file, options);
  }

  async sendActivity(address: ChannelRouteAddress, _activity: "typing" | "uploading" | "recording" = "typing"): Promise<void> {
    await this.api.postEphemeral({ channel: address.conversationId, user: address.userId, text: "Pi is working…" });
  }

  async answerAction(actionId: string, options?: { text?: string }): Promise<void> {
    const target = parseSlackActionId(actionId);
    const text = options?.text ?? "Done";
    if (target.responseUrl && this.api.postResponse) {
      await this.api.postResponse(target.responseUrl, { text, ephemeral: true });
      return;
    }
    await this.api.postEphemeral({ channel: target.channelId, user: target.userId, text });
  }

  async downloadFile(file: ChannelInboundFile): Promise<Uint8Array> {
    const url = typeof file.metadata?.url === "string" ? file.metadata.url : undefined;
    if (!url || !this.api.downloadFile) throw new Error("Slack file download URL is unavailable.");
    return this.api.downloadFile(url);
  }

  private async sendButtonPrompt(address: ChannelRouteAddress, buttons: ChannelButtonLayout): Promise<void> {
    await this.api.postMessage({ channel: address.conversationId, text: "Actions:", blocks: slackBlocksForButtons(buttons) });
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
    sharedRooms: {
      ordinaryText: false,
      mentions: true,
      replies: false,
      platformCommands: false,
      mediaAttachments: false,
      membershipEvents: false,
    },
  };
}

export function slackMentionedUserIds(text: string): string[] {
  return [...text.matchAll(/<@([A-Z0-9_]+)>/g)].map((match) => match[1]!).filter(Boolean);
}

export function slackMessageSharedRoomAddressing(text: string, localBotUserId: string | undefined, remoteBotUserIds: readonly string[] = []): SharedRoomAddressing {
  const botUserIds = new Set([...(localBotUserId ? [localBotUserId] : []), ...remoteBotUserIds]);
  const mentions = [...new Set(slackMentionedUserIds(text).filter((mention) => botUserIds.has(mention)))];
  if (mentions.length === 0) return { kind: "none" };
  if (mentions.length > 1) return { kind: "ambiguous", reason: "multiple bot mentions" };
  if (localBotUserId && mentions.includes(localBotUserId)) return { kind: "local" };
  return { kind: "remote", selector: mentions[0] };
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

export function slackEnvelopeToChannelEvent(envelope: SlackEnvelope, config: SlackRelayConfig): ChannelInboundEvent | undefined {
  if (envelope.type === "block_actions") {
    const action = envelope.actions?.[0];
    const channelId = envelope.channel?.id ?? "";
    const user = envelope.user ?? { id: "unknown" };
    return {
      kind: "action",
      channel: SLACK_CHANNEL,
      updateId: envelope.trigger_id ?? `${channelId}:${envelope.message?.ts ?? Date.now()}`,
      actionId: buildSlackActionId({ channelId, userId: user.id, responseUrl: envelope.response_url, triggerId: envelope.trigger_id }),
      messageId: envelope.message?.ts,
      actionData: action?.value ?? action?.action_id ?? "",
      conversation: slackConversationFromId(channelId),
      sender: slackIdentity(user.id, user.username ?? user.name, user.team_id ?? envelope.team?.id),
    metadata: { teamId: envelope.team?.id, threadTs: envelope.message?.thread_ts ?? envelope.message?.ts },
    };
  }
  if (!envelope.event) throw new Error("Slack envelope does not contain a supported event.");
  return slackEventToChannelEvent(envelope.event, config);
}

export function isSlackIdentityAllowed(identity: ChannelIdentity, config: Pick<SlackRelayConfig, "allowUserIds" | "workspaceId">): boolean {
  const teamId = typeof identity.metadata?.teamId === "string" ? identity.metadata.teamId : undefined;
  if (config.workspaceId && teamId !== config.workspaceId) return false;
  const allowed = config.allowUserIds ?? [];
  return allowed.length === 0 || allowed.includes(identity.userId);
}

export function slackPairingCommand(code: string): string {
  return `/pirelay ${code}`;
}

export function slackEventToChannelEvent(event: SlackMessageEvent, config: Pick<SlackRelayConfig, "allowedImageMimeTypes" | "maxFileBytes">): ChannelInboundMessage | undefined {
  if (!event.user || event.bot_id || (event.subtype && event.subtype !== "file_share")) return undefined;
  const teamId = event.team;
  return {
    kind: "message",
    channel: SLACK_CHANNEL,
    updateId: event.ts,
    messageId: event.ts,
    text: event.text ?? "",
    attachments: (event.files ?? []).map((file) => slackFileToInboundFile(file, config)),
    conversation: slackConversation(event.channel, event.channel_type),
    sender: slackIdentity(event.user, event.username, teamId),
    metadata: { teamId, threadTs: event.thread_ts ?? event.ts },
  };
}

function slackThreadTs(address: ChannelRouteAddress): string | undefined {
  const value = (address as ChannelRouteAddress & { threadTs?: unknown }).threadTs;
  return typeof value === "string" && value ? value : undefined;
}

function slackConversation(channel: string, channelType: SlackMessageEvent["channel_type"]): ChannelConversation {
  return {
    channel: SLACK_CHANNEL,
    id: channel,
    kind: channelType === "im" ? "private" : channelType === "channel" || channelType === "group" ? "channel" : channelType === "mpim" ? "group" : "unknown",
  };
}

function slackConversationFromId(channel: string): ChannelConversation {
  if (channel.startsWith("D")) return slackConversation(channel, "im");
  if (channel.startsWith("G")) return slackConversation(channel, "group");
  if (channel.startsWith("C")) return slackConversation(channel, "channel");
  return slackConversation(channel, undefined);
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
  const supportedMime = !image || !file.mimetype || (config.allowedImageMimeTypes ?? DEFAULT_IMAGE_MIME_TYPES).includes(file.mimetype);
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

export interface SlackActionTarget {
  channelId: string;
  userId: string;
  responseUrl?: string;
  triggerId?: string;
}

export function buildSlackActionId(target: SlackActionTarget): string {
  return Buffer.from(JSON.stringify(target), "utf8").toString("base64url");
}

export function parseSlackActionId(actionId: string): SlackActionTarget {
  try {
    const parsed = JSON.parse(Buffer.from(actionId, "base64url").toString("utf8")) as Partial<SlackActionTarget>;
    if (typeof parsed.channelId === "string" && typeof parsed.userId === "string") {
      return {
        channelId: parsed.channelId,
        userId: parsed.userId,
        responseUrl: typeof parsed.responseUrl === "string" ? parsed.responseUrl : undefined,
        triggerId: typeof parsed.triggerId === "string" ? parsed.triggerId : undefined,
      };
    }
  } catch {
    // Fall through to legacy channel-id action handling.
  }
  return { channelId: actionId, userId: "" };
}

export function parseSlackWebhookBody(rawBody: string, parsedPayload?: unknown): SlackEnvelope {
  if (typeof parsedPayload === "object" && parsedPayload !== null && !Array.isArray(parsedPayload)) {
    const payload = (parsedPayload as { payload?: unknown }).payload;
    if (typeof payload === "string") return JSON.parse(payload) as SlackEnvelope;
    if (typeof (parsedPayload as { type?: unknown }).type === "string") return parsedPayload as SlackEnvelope;
  }
  const params = new URLSearchParams(rawBody);
  const formPayload = params.get("payload");
  if (formPayload) return JSON.parse(formPayload) as SlackEnvelope;
  return JSON.parse(rawBody) as SlackEnvelope;
}

function rawSlackBody(payload: unknown, headers: Record<string, string>): string {
  if (typeof payload === "string") return payload;
  const raw = headers["x-slack-raw-body"] ?? headers["X-Slack-Raw-Body"];
  if (raw) return raw;
  throw new Error("Raw Slack request body is required for signature verification.");
}
