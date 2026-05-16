import type { ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { StructuredAnswerMetadata } from "./guided-answer.js";
import type { ChannelBinding } from "./channel-adapter.js";
import type { RelayFileDeliveryRequester } from "./requester-file-delivery.js";
import type { RelayLifecycleNotificationRecord } from "../notifications/lifecycle.js";
import type { DelegationAutonomyLevel, DelegationTaskAuditEvent, DelegationTaskRecord, TrustedDelegationPeer } from "./agent-delegation.js";

export type DeliveryMode = "followUp" | "steer";
export type SummaryMode = "deterministic" | "llm";
export type ProgressMode = "quiet" | "normal" | "verbose" | "completionOnly";

export interface ProgressActivityEntry {
  id: string;
  kind: "lifecycle" | "tool" | "assistant" | "status";
  text: string;
  detail?: string;
  at: number;
}

export interface SharedRoomRelayConfig {
  enabled?: boolean;
  roomHint?: string;
  plainText?: "auto" | "enabled" | "addressed-only";
  machineAliases?: string[];
}

export interface AgentDelegationRelayConfig {
  enabled?: boolean;
  autonomy?: DelegationAutonomyLevel;
  trustedPeers?: TrustedDelegationPeer[];
  localCapabilities?: string[];
  taskExpiryMs?: number;
  runningTimeoutMs?: number;
  maxDepth?: number;
  maxVisibleSummaryChars?: number;
  maxHistory?: number;
  requireHumanApproval?: boolean;
}

export interface DiscordRelayConfig {
  enabled?: boolean;
  botToken?: string;
  applicationId?: string;
  clientId?: string;
  allowUserIds?: string[];
  allowGuildChannels?: boolean;
  allowGuildIds?: string[];
  sharedRoom?: SharedRoomRelayConfig;
  delegation?: AgentDelegationRelayConfig;
  maxTextChars?: number;
  maxFileBytes?: number;
  allowedImageMimeTypes?: string[];
}

export interface SlackRelayConfig {
  enabled?: boolean;
  botToken?: string;
  signingSecret?: string;
  appToken?: string;
  appId?: string;
  eventMode?: "socket" | "webhook";
  workspaceId?: string;
  botUserId?: string;
  allowUserIds?: string[];
  allowChannelMessages?: boolean;
  sharedRoom?: SharedRoomRelayConfig;
  delegation?: AgentDelegationRelayConfig;
  maxTextChars?: number;
  maxFileBytes?: number;
  allowedImageMimeTypes?: string[];
}

export interface TelegramTunnelConfig {
  botToken: string;
  configPath?: string;
  stateDir: string;
  machineId?: string;
  machineDisplayName?: string;
  machineAliases?: string[];
  machineCapabilities?: string[];
  delegation?: AgentDelegationRelayConfig;
  brokerNamespace?: string;
  pairingExpiryMs: number;
  busyDeliveryMode: DeliveryMode;
  allowUserIds: number[];
  summaryMode: SummaryMode;
  maxTelegramMessageChars: number;
  sendRetryCount: number;
  sendRetryBaseMs: number;
  pollingTimeoutSeconds: number;
  redactionPatterns: string[];
  maxInboundImageBytes: number;
  maxOutboundImageBytes: number;
  maxLatestImages: number;
  allowedImageMimeTypes: string[];
  progressMode?: ProgressMode;
  progressIntervalMs?: number;
  verboseProgressIntervalMs?: number;
  recentActivityLimit?: number;
  maxProgressMessageChars?: number;
  discord?: DiscordRelayConfig;
  discordInstances?: Record<string, DiscordRelayConfig>;
  slack?: SlackRelayConfig;
  slackInstances?: Record<string, SlackRelayConfig>;
}

export interface ConfigLoadResult {
  config: TelegramTunnelConfig;
  warnings: string[];
}

export interface TelegramUserSummary {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  isBot?: boolean;
}

export interface TelegramChatSummary {
  id: number;
  type: string;
  title?: string;
}

export interface TelegramBindingMetadata {
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  chatId: number;
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  boundAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  paused?: boolean;
  alias?: string;
  progressMode?: ProgressMode;
}

export interface PersistedBindingRecord extends TelegramBindingMetadata {
  status: "active" | "revoked";
}

export interface BindingEntryData {
  version: 1;
  binding?: TelegramBindingMetadata;
  revoked?: boolean;
  revokedAt?: string;
}

export interface PendingPairingRecord {
  nonceHash: string;
  codeKind?: "nonce" | "pin";
  channel?: "telegram" | "discord" | "slack";
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface SetupCache {
  botId: number;
  botUsername: string;
  botDisplayName: string;
  validatedAt: string;
}

export interface ChannelPersistedBindingRecord extends ChannelBinding {
  status: "active" | "revoked";
}

export interface ChannelActiveSelectionRecord {
  channel: ChannelBinding["channel"];
  conversationId: string;
  userId: string;
  sessionKey: string;
  updatedAt: string;
  machineId?: string;
  machineDisplayName?: string;
}

export interface TrustedRelayUserRecord {
  channel: ChannelBinding["channel"];
  instanceId: string;
  userId: string;
  displayName?: string;
  username?: string;
  trustedAt: string;
  trustedBySessionLabel?: string;
}

export interface TunnelStoreData {
  setup?: SetupCache;
  pendingPairings: Record<string, PendingPairingRecord>;
  bindings: Record<string, PersistedBindingRecord>;
  channelBindings: Record<string, ChannelPersistedBindingRecord>;
  activeChannelSelections: Record<string, ChannelActiveSelectionRecord>;
  trustedRelayUsers: Record<string, TrustedRelayUserRecord>;
  lifecycleNotifications: Record<string, RelayLifecycleNotificationRecord>;
  delegationTasks: Record<string, DelegationTaskRecord>;
  delegationAudit: DelegationTaskAuditEvent[];
  delegationHandledEvents: string[];
}

export interface ParsedTelegramCommand {
  command: string;
  args: string;
}

export interface SessionNotificationState {
  startedAt?: number;
  lastTurnId?: string;
  lastAssistantText?: string;
  lastSummary?: string;
  lastFailure?: string;
  lastStatus?: "idle" | "running" | "completed" | "failed" | "aborted";
  abortRequested?: boolean;
  structuredAnswer?: StructuredAnswerMetadata;
  latestImages?: LatestTurnImageMetadata;
  progressEvent?: ProgressActivityEntry;
  recentActivity?: ProgressActivityEntry[];
}

export type TelegramPromptContent = string | (TextContent | ImageContent)[];

export interface TelegramInboundImageReference {
  kind: "photo" | "document";
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType: string;
  fileSize?: number;
  width?: number;
  height?: number;
  supported: boolean;
  unsupportedReason?: string;
}

export interface TelegramDownloadedImage {
  image: ImageContent;
  fileName: string;
  fileSize: number;
  source: TelegramInboundImageReference;
}

export interface LatestTurnImage {
  id: string;
  turnId: string;
  fileName: string;
  mimeType: string;
  data: string;
  byteSize: number;
}

export interface LatestTurnImageFileCandidate {
  id: string;
  turnId: string;
  path: string;
}

export type ImageFileLoadResult =
  | { ok: true; image: LatestTurnImage }
  | { ok: false; error: string };

export interface LatestTurnImageMetadata {
  turnId: string;
  count: number;
  skipped: number;
  contentCount?: number;
  fileCount?: number;
}

export interface SessionRouteActions {
  /** @deprecated Prefer narrow lifetime-safe helpers on this object. */
  context: ExtensionContext;
  isIdle?(): boolean | undefined;
  getWorkspaceRoot?(): string | undefined;
  getModel(): Model<any> | undefined;
  summarizeText?(text: string, mode: SummaryMode): Promise<string>;
  sendUserMessage(content: TelegramPromptContent, options?: { deliverAs?: DeliveryMode }): void;
  getLatestImages(): Promise<LatestTurnImage[]>;
  getImageByPath(relativePath: string): Promise<ImageFileLoadResult>;
  appendAudit(message: string): void;
  notifyLocal?(message: string, level?: "info" | "warning" | "error"): void;
  setLocalStatus?(key: string, value: string): void;
  clearLocalStatus?(key: string): void;
  refreshLocalStatus?(): void;
  persistBinding(binding: TelegramBindingMetadata | null, revoked?: boolean): void;
  promptLocalConfirmation(identity: RelayPairingIdentity): Promise<PairingApprovalDecision | boolean>;
  abort(): void;
  compact(): Promise<void>;
}

export type PairingApprovalDecision = "allow" | "trust" | "deny";

export type RelayPairingIdentity =
  | (TelegramUserSummary & { channel?: "telegram"; userId?: string; displayName?: string; conversationKind?: string; instanceId?: string })
  | { channel: ChannelBinding["channel"]; userId: string; username?: string; displayName?: string; firstName?: string; lastName?: string; conversationKind?: string; instanceId?: string };

export interface SessionRoute {
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  binding?: TelegramBindingMetadata;
  actions: SessionRouteActions;
  notification: SessionNotificationState;
  lastActivityAt?: number;
  remoteRequester?: RelayFileDeliveryRequester;
  remoteRequesterPendingTurn?: boolean;
}

export interface SessionStatusSnapshot {
  sessionKey: string;
  sessionLabel: string;
  sessionId: string;
  sessionFile?: string;
  online: boolean;
  busy: boolean;
  modelId?: string;
  lastActivityAt?: number;
  binding?: TelegramBindingMetadata;
  notification: SessionNotificationState;
}

export interface TelegramInboundMessage {
  kind?: "message";
  updateId: number;
  messageId: number;
  text: string;
  images?: TelegramInboundImageReference[];
  chat: TelegramChatSummary;
  user: TelegramUserSummary;
}

export interface TelegramInboundCallback {
  kind: "callback";
  updateId: number;
  callbackQueryId: string;
  messageId?: number;
  data: string;
  chat: TelegramChatSummary;
  user: TelegramUserSummary;
}

export type TelegramInboundUpdate = TelegramInboundMessage | TelegramInboundCallback;

export interface TelegramInlineKeyboardButton {
  text: string;
  callbackData: string;
}

export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

export interface TelegramOutboundChunk {
  text: string;
  index: number;
  total: number;
}

export interface TunnelRuntime {
  readonly setup?: SetupCache;
  start(): Promise<void>;
  stop(): Promise<void>;
  ensureSetup(): Promise<SetupCache>;
  registerRoute(route: SessionRoute): Promise<void>;
  unregisterRoute(sessionKey: string): Promise<void>;
  getStatus(sessionKey: string): SessionStatusSnapshot | undefined;
  sendToBoundChat(sessionKey: string, text: string): Promise<void>;
}
