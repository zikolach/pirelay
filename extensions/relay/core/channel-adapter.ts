import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { DeliveryMode, ImageFileLoadResult, LatestTurnImage, SessionRoute } from "./types.js";

export type ChannelAdapterKind = "telegram" | "discord" | "slack" | "signal" | "matrix" | (string & {});
export type ChannelMessageId = string;
export type ChannelConversationId = string;
export type ChannelUserId = string;

export interface ChannelIdentity {
  channel: ChannelAdapterKind;
  userId: ChannelUserId;
  username?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelConversation {
  channel: ChannelAdapterKind;
  id: ChannelConversationId;
  kind: "private" | "group" | "channel" | "unknown";
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelRouteAddress {
  channel: ChannelAdapterKind;
  conversationId: ChannelConversationId;
  userId: ChannelUserId;
}

export interface ChannelBinding {
  channel: ChannelAdapterKind;
  instanceId?: string;
  conversationId: ChannelConversationId;
  userId: ChannelUserId;
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  boundAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  paused?: boolean;
  identity?: Omit<ChannelIdentity, "channel" | "userId">;
  metadata?: Record<string, unknown>;
}

export interface ChannelInboundFile {
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

export interface ChannelInboundMessage {
  kind: "message";
  channel: ChannelAdapterKind;
  updateId: string;
  messageId: ChannelMessageId;
  text: string;
  attachments: ChannelInboundFile[];
  conversation: ChannelConversation;
  sender: ChannelIdentity;
  metadata?: Record<string, unknown>;
}

export interface ChannelInboundAction {
  kind: "action";
  channel: ChannelAdapterKind;
  updateId: string;
  actionId: string;
  messageId?: ChannelMessageId;
  actionData: string;
  conversation: ChannelConversation;
  sender: ChannelIdentity;
  metadata?: Record<string, unknown>;
}

export type ChannelInboundEvent = ChannelInboundMessage | ChannelInboundAction;

export interface ChannelButton {
  label: string;
  actionData: string;
  style?: "default" | "primary" | "danger";
}

export type ChannelButtonLayout = ChannelButton[][];

export interface ChannelOutboundFile {
  fileName: string;
  mimeType: string;
  data: Uint8Array | string;
  byteSize?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundText {
  kind: "text";
  address: ChannelRouteAddress;
  text: string;
  buttons?: ChannelButtonLayout;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundDocument {
  kind: "document";
  address: ChannelRouteAddress;
  file: ChannelOutboundFile;
  caption?: string;
  buttons?: ChannelButtonLayout;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundImage {
  kind: "image";
  address: ChannelRouteAddress;
  file: ChannelOutboundFile;
  caption?: string;
  buttons?: ChannelButtonLayout;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundActivity {
  kind: "activity";
  address: ChannelRouteAddress;
  activity: "typing" | "uploading" | "recording";
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundActionAnswer {
  kind: "action-answer";
  channel: ChannelAdapterKind;
  actionId: string;
  text?: string;
  alert?: boolean;
  metadata?: Record<string, unknown>;
}

export type ChannelOutboundPayload =
  | ChannelOutboundText
  | ChannelOutboundDocument
  | ChannelOutboundImage
  | ChannelOutboundActivity
  | ChannelOutboundActionAnswer;

export interface ChannelSharedRoomCapabilities {
  ordinaryText: boolean;
  mentions: boolean;
  replies: boolean;
  platformCommands: boolean;
  mediaAttachments: boolean;
  membershipEvents: boolean;
}

export interface ChannelCapabilities {
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
  sharedRooms?: ChannelSharedRoomCapabilities;
}

export interface ChannelAdapterMetadata {
  id: ChannelAdapterKind;
  displayName: string;
  capabilities: ChannelCapabilities;
  metadata?: Record<string, unknown>;
}

export interface ChannelInboundHandler {
  (event: ChannelInboundEvent): Promise<void>;
}

export interface ChannelAdapter extends ChannelAdapterMetadata {
  startPolling?(handler: ChannelInboundHandler): Promise<void>;
  stopPolling?(): Promise<void>;
  handleWebhook?(payload: unknown, headers: Record<string, string>, handler: ChannelInboundHandler): Promise<void>;
  send(payload: ChannelOutboundPayload): Promise<void>;
  sendText(address: ChannelRouteAddress, text: string, options?: { buttons?: ChannelButtonLayout }): Promise<void>;
  sendDocument(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void>;
  sendImage(address: ChannelRouteAddress, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void>;
  sendActivity(address: ChannelRouteAddress, activity: ChannelOutboundActivity["activity"]): Promise<void>;
  answerAction(actionId: string, options?: { text?: string; alert?: boolean }): Promise<void>;
}

export type RelayPromptContent = string | (TextContent | ImageContent)[];

export interface RelayPromptDeliveryRequest {
  route: SessionRoute;
  content: RelayPromptContent;
  deliverAs?: DeliveryMode;
  auditMessage?: string;
}

export interface RelayRouteResolution {
  route?: SessionRoute;
  liveRoutes: SessionRoute[];
  ambiguous: boolean;
  binding?: ChannelBinding;
}

export interface RelayOutboundContext {
  adapter: ChannelAdapter;
  address: ChannelRouteAddress;
  route?: SessionRoute;
}

export interface RelayCoreRouteBoundary {
  resolveRoute(event: ChannelInboundEvent): Promise<RelayRouteResolution>;
  isAuthorized(route: SessionRoute, identity: ChannelIdentity): boolean;
  persistRouteBinding(route: SessionRoute, binding: ChannelBinding | null, revoked?: boolean): Promise<void>;
}

export interface RelayCoreDeliveryBoundary {
  deliverPrompt(request: RelayPromptDeliveryRequest): Promise<void>;
  abort(route: SessionRoute, auditMessage: string): Promise<void>;
  compact(route: SessionRoute, auditMessage: string): Promise<void>;
}

export interface RelayCoreOutputBoundary {
  sendText(context: RelayOutboundContext, text: string, options?: { buttons?: ChannelButtonLayout }): Promise<void>;
  sendDocument(context: RelayOutboundContext, file: ChannelOutboundFile, options?: { caption?: string; buttons?: ChannelButtonLayout }): Promise<void>;
  sendImages(context: RelayOutboundContext, images: LatestTurnImage[]): Promise<void>;
  getLatestImages(route: SessionRoute): Promise<LatestTurnImage[]>;
  getImageByPath(route: SessionRoute, relativePath: string): Promise<ImageFileLoadResult>;
}

export interface RelayCoreAnswerBoundary {
  handleAnswerText(event: ChannelInboundMessage, route: SessionRoute): Promise<boolean>;
  handleAnswerAction(event: ChannelInboundAction, route: SessionRoute): Promise<boolean>;
  clearAnswerState(route: SessionRoute, identity?: ChannelIdentity): void;
}

export interface RelayCoreBoundaries {
  routes: RelayCoreRouteBoundary;
  delivery: RelayCoreDeliveryBoundary;
  output: RelayCoreOutputBoundary;
  answers: RelayCoreAnswerBoundary;
}

export function supportsButtons(adapter: Pick<ChannelAdapterMetadata, "capabilities">): boolean {
  return adapter.capabilities.inlineButtons && adapter.capabilities.callbacks;
}

export function canSendFile(adapter: Pick<ChannelAdapterMetadata, "capabilities">, file: Pick<ChannelOutboundFile, "byteSize">, kind: "document" | "image"): boolean {
  const limit = kind === "image" ? adapter.capabilities.maxImageBytes : adapter.capabilities.maxDocumentBytes;
  return typeof limit !== "number" || typeof file.byteSize !== "number" || file.byteSize <= limit;
}

export function assertCanSendOutboundFile(adapter: Pick<ChannelAdapterMetadata, "capabilities" | "displayName">, file: Pick<ChannelOutboundFile, "byteSize" | "mimeType">, kind: "document" | "image"): void {
  if (!canSendFile(adapter, file, kind)) {
    throw new Error(`${adapter.displayName} ${kind} is too large for outbound delivery.`);
  }
  if (kind === "image" && adapter.capabilities.supportedImageMimeTypes.length > 0 && !adapter.capabilities.supportedImageMimeTypes.includes(file.mimeType)) {
    throw new Error(`${adapter.displayName} image MIME type is not allowed: ${file.mimeType}`);
  }
}

export function decodeOutboundFileData(file: Pick<ChannelOutboundFile, "data">): Uint8Array {
  if (typeof file.data !== "string") return file.data;
  if (!isCanonicalBase64(file.data)) {
    throw new Error("ChannelOutboundFile.data string values must be base64-encoded.");
  }
  return Buffer.from(file.data, "base64");
}

export function requiresTextChunking(adapter: Pick<ChannelAdapterMetadata, "capabilities">, text: string): boolean {
  return text.length > adapter.capabilities.maxTextChars;
}

export function channelTextChunks(adapter: Pick<ChannelAdapterMetadata, "capabilities">, text: string): string[] {
  const maxChars = Math.max(1, adapter.capabilities.maxTextChars);
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }
  return chunks;
}

export function buttonsFallbackText(buttons: ChannelButtonLayout): string {
  const labels = buttons.flat().map((button, index) => `${index + 1}. ${button.label}`);
  return ["Actions:", ...labels].join("\n");
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
