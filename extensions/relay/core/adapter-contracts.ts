import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { MessengerRef } from "./messenger-ref.js";

export type PlatformUserId = string;
export type PlatformConversationId = string;
export type PlatformMessageId = string;

export interface PlatformIdentity {
  messenger: MessengerRef;
  userId: PlatformUserId;
  username?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformConversation {
  messenger: MessengerRef;
  id: PlatformConversationId;
  kind: "private" | "group" | "channel" | "unknown";
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface RelayAddress {
  messenger: MessengerRef;
  conversationId: PlatformConversationId;
  userId: PlatformUserId;
}

export interface RelayBinding {
  messenger: MessengerRef;
  conversationId: PlatformConversationId;
  userId: PlatformUserId;
  sessionKey: string;
  sessionId: string;
  machineId?: string;
  sessionFile?: string;
  sessionLabel: string;
  boundAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  paused?: boolean;
  alias?: string;
  identity?: Omit<PlatformIdentity, "messenger" | "userId">;
  metadata?: Record<string, unknown>;
}

export interface RelayPendingPairing {
  nonceHash: string;
  messenger: MessengerRef;
  machineId: string;
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface RelayAttachment {
  id: string;
  uniqueId?: string;
  kind: "image" | "document" | "audio" | "video" | "other";
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  supported?: boolean;
  unsupportedReason?: string;
  metadata?: Record<string, unknown>;
}

export interface RelayInboundMessage {
  kind: "message";
  messenger: MessengerRef;
  updateId: string;
  messageId: PlatformMessageId;
  text: string;
  attachments: RelayAttachment[];
  conversation: PlatformConversation;
  sender: PlatformIdentity;
  metadata?: Record<string, unknown>;
}

export interface RelayInboundAction {
  kind: "action";
  messenger: MessengerRef;
  updateId: string;
  actionId: string;
  messageId?: PlatformMessageId;
  actionData: string;
  conversation: PlatformConversation;
  sender: PlatformIdentity;
  metadata?: Record<string, unknown>;
}

export type RelayInboundEvent = RelayInboundMessage | RelayInboundAction;

export interface RelayButton {
  label: string;
  actionData: string;
  style?: "default" | "primary" | "danger";
}

export type RelayButtonLayout = RelayButton[][];

export interface RelayOutboundFile {
  fileName: string;
  mimeType: string;
  data: Uint8Array | string;
  byteSize?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface RelayOutboundText {
  kind: "text";
  address: RelayAddress;
  text: string;
  buttons?: RelayButtonLayout;
  metadata?: Record<string, unknown>;
}

export interface RelayOutboundDocument {
  kind: "document";
  address: RelayAddress;
  file: RelayOutboundFile;
  caption?: string;
  buttons?: RelayButtonLayout;
  metadata?: Record<string, unknown>;
}

export interface RelayOutboundImage {
  kind: "image";
  address: RelayAddress;
  file: RelayOutboundFile;
  caption?: string;
  buttons?: RelayButtonLayout;
  metadata?: Record<string, unknown>;
}

export interface RelayOutboundActivity {
  kind: "activity";
  address: RelayAddress;
  activity: "typing" | "uploading" | "recording";
  metadata?: Record<string, unknown>;
}

export interface RelayOutboundActionAnswer {
  kind: "action-answer";
  messenger: MessengerRef;
  actionId: string;
  text?: string;
  alert?: boolean;
  metadata?: Record<string, unknown>;
}

export type RelayOutboundPayload = RelayOutboundText | RelayOutboundDocument | RelayOutboundImage | RelayOutboundActivity | RelayOutboundActionAnswer;

export interface MessengerSharedRoomCapabilities {
  ordinaryText: boolean;
  mentions: boolean;
  replies: boolean;
  platformCommands: boolean;
  mediaAttachments: boolean;
  membershipEvents: boolean;
}

export interface MessengerCapabilities {
  inlineButtons: boolean;
  textMessages: boolean;
  documents: boolean;
  images: boolean;
  activityIndicators: boolean;
  callbacks: boolean;
  privateChats: boolean;
  groupChats: boolean;
  maxTextChars: number;
  maxDocumentBytes?: number;
  maxImageBytes?: number;
  supportedImageMimeTypes: string[];
  supportsMarkdown?: boolean;
  sharedRooms?: MessengerSharedRoomCapabilities;
}

export interface MessengerAdapterMetadata {
  ref: MessengerRef;
  displayName: string;
  capabilities: MessengerCapabilities;
  metadata?: Record<string, unknown>;
}

export interface MessengerInboundHandler {
  (event: RelayInboundEvent): Promise<void>;
}

export interface MessengerAdapter extends MessengerAdapterMetadata {
  startIngress?(handler: MessengerInboundHandler): Promise<void>;
  stopIngress?(): Promise<void>;
  handleWebhook?(payload: unknown, headers: Record<string, string>, handler: MessengerInboundHandler): Promise<void>;
  send(payload: RelayOutboundPayload): Promise<void>;
  sendText(address: RelayAddress, text: string, options?: { buttons?: RelayButtonLayout }): Promise<void>;
  sendDocument(address: RelayAddress, file: RelayOutboundFile, options?: { caption?: string; buttons?: RelayButtonLayout }): Promise<void>;
  sendImage(address: RelayAddress, file: RelayOutboundFile, options?: { caption?: string; buttons?: RelayButtonLayout }): Promise<void>;
  sendActivity(address: RelayAddress, activity: RelayOutboundActivity["activity"]): Promise<void>;
  answerAction(actionId: string, options?: { text?: string; alert?: boolean }): Promise<void>;
}

export type RelayPromptContent = string | (TextContent | ImageContent)[];

export interface RelayPromptDeliveryRequest<Route> {
  route: Route;
  content: RelayPromptContent;
  deliverAs?: "followUp" | "steer";
  auditMessage?: string;
}
