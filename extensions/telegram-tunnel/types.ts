import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type DeliveryMode = "followUp" | "steer";
export type SummaryMode = "deterministic" | "llm";

export interface TelegramTunnelConfig {
  botToken: string;
  configPath?: string;
  stateDir: string;
  pairingExpiryMs: number;
  busyDeliveryMode: DeliveryMode;
  allowUserIds: number[];
  summaryMode: SummaryMode;
  maxTelegramMessageChars: number;
  sendRetryCount: number;
  sendRetryBaseMs: number;
  pollingTimeoutSeconds: number;
  redactionPatterns: string[];
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

export interface TunnelStoreData {
  setup?: SetupCache;
  pendingPairings: Record<string, PendingPairingRecord>;
  bindings: Record<string, PersistedBindingRecord>;
}

export interface ParsedTelegramCommand {
  command: string;
  args: string;
}

export interface SessionNotificationState {
  startedAt?: number;
  lastAssistantText?: string;
  lastSummary?: string;
  lastFailure?: string;
  lastStatus?: "idle" | "running" | "completed" | "failed" | "aborted";
  abortRequested?: boolean;
}

export interface SessionRouteActions {
  context: ExtensionContext;
  getModel(): Model<any> | undefined;
  sendUserMessage(text: string, options?: { deliverAs?: DeliveryMode }): void;
  appendAudit(message: string): void;
  persistBinding(binding: TelegramBindingMetadata | null, revoked?: boolean): void;
  promptLocalConfirmation(identity: TelegramUserSummary): Promise<boolean>;
  abort(): void;
  compact(): Promise<void>;
}

export interface SessionRoute {
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  binding?: TelegramBindingMetadata;
  actions: SessionRouteActions;
  notification: SessionNotificationState;
  lastActivityAt?: number;
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
  updateId: number;
  messageId: number;
  text: string;
  chat: TelegramChatSummary;
  user: TelegramUserSummary;
}

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
