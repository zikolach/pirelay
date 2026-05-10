import { appendFileSync } from "node:fs";
import type { ChannelInboundAction, ChannelInboundEvent, ChannelInboundMessage } from "../../core/channel-adapter.js";
import type { SessionRoute, TelegramTunnelConfig } from "../../core/types.js";
import { redactSecrets } from "../../config/setup.js";
import { SlackChannelAdapter, isSlackIdentityAllowed, slackEventToChannelEvent, type SlackApiOperations, type SlackEnvelope, type SlackMessageEvent } from "./adapter.js";
import { createSlackLiveOperations, type SlackMessageEventFromHistory } from "./live-client.js";

const SLACK_CHANNEL = "slack" as const;

export interface SlackRuntimeOptions {
  operations?: SlackApiOperations;
}

export interface SlackRuntimeStatus {
  enabled: boolean;
  started: boolean;
  error?: string;
}

export class SlackRuntime {
  private readonly adapter?: SlackChannelAdapter;
  private readonly operations?: SlackApiOperations;
  private readonly routes = new Map<string, SessionRoute>();
  private historyPollTimer?: ReturnType<typeof setInterval>;
  private latestHistoryTs = (Date.now() / 1_000).toFixed(6);
  private started = false;
  private startPromise?: Promise<void>;
  private lastError?: string;

  constructor(
    private readonly config: TelegramTunnelConfig,
    options: SlackRuntimeOptions = {},
    private readonly instanceId = "default",
  ) {
    const slackConfig = config.slackInstances?.[this.instanceId] ?? config.slack;
    const operations = options.operations ?? (slackConfig?.enabled && slackConfig.botToken ? createSlackLiveOperations(slackConfig) : undefined);
    this.operations = operations;
    if (slackConfig?.enabled && slackConfig.botToken && operations) {
      this.adapter = new SlackChannelAdapter(slackConfig, operations);
    }
  }

  getStatus(): SlackRuntimeStatus {
    const slackConfig = this.config.slackInstances?.[this.instanceId] ?? this.config.slack;
    return { enabled: Boolean(slackConfig?.enabled && slackConfig.botToken), started: this.started, error: this.lastError };
  }

  async start(): Promise<void> {
    if (!this.adapter || !this.operations?.startSocketMode || this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.operations.startSocketMode(async (envelope) => this.handleEnvelope(envelope))
      .then(() => {
        this.started = true;
        this.lastError = undefined;
        this.startHistoryPollingFallback();
      })
      .catch((error: unknown) => {
        this.started = false;
        this.lastError = safeSlackRuntimeError(error);
        throw new Error(this.lastError);
      })
      .finally(() => {
        this.startPromise = undefined;
      });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.historyPollTimer) clearInterval(this.historyPollTimer);
    this.historyPollTimer = undefined;
    await this.adapter?.stopPolling?.();
  }

  async registerRoute(route: SessionRoute): Promise<void> {
    this.routes.set(route.sessionKey, route);
  }

  async unregisterRoute(sessionKey: string): Promise<void> {
    this.routes.delete(sessionKey);
    if (this.routes.size === 0) await this.stop();
  }

  async notifyTurnCompleted(_route: SessionRoute, _status: "completed" | "failed" | "aborted"): Promise<void> {
    // Stub runtime only verifies live Slack event receipt; full turn delivery is
    // intentionally left for the non-stub Slack runtime implementation.
  }

  private async handleEnvelope(envelope: SlackEnvelope): Promise<void> {
    const event = this.normalizeEnvelope(envelope);
    if (!event) return;
    await this.handleEvent(event);
  }

  private startHistoryPollingFallback(): void {
    if (this.historyPollTimer) return;
    const slackConfig = this.configForInstance();
    const channelId = slackConfig?.sharedRoom?.roomHint;
    if (!channelId || !hasHistoryReader(this.operations)) return;
    debugSlackRuntime(`Starting Slack history polling fallback for ${channelId} (local bot ${process.env.PI_RELAY_SLACK_BOT_USER_ID ?? "unset"}).`);
    this.historyPollTimer = setInterval(() => {
      void this.pollHistory(channelId).catch((error: unknown) => {
        this.lastError = safeSlackRuntimeError(error);
      });
    }, 2_000);
    this.historyPollTimer.unref?.();
  }

  private async pollHistory(channelId: string): Promise<void> {
    if (!hasHistoryReader(this.operations)) return;
    const messages = await this.operations.listChannelMessages(channelId, this.latestHistoryTs);
    debugSlackRuntime(`Slack history polling saw ${messages.length} message(s) after ${this.latestHistoryTs}.`);
    const ordered = [...messages].sort((left, right) => Number(left.ts) - Number(right.ts));
    for (const message of ordered) {
      if (Number(message.ts) <= Number(this.latestHistoryTs)) continue;
      this.latestHistoryTs = message.ts;
      const slackConfig = this.configForInstance();
      if (!slackConfig) continue;
      const event = slackEventToChannelEventIncludingBotMessages(message, slackConfig);
      if (event) await this.handleEvent(event);
    }
  }

  private normalizeEnvelope(envelope: SlackEnvelope): ChannelInboundEvent | undefined {
    try {
      const normalized = this.adapterEvent(envelope);
      if (normalized) return normalized;
    } catch {
      // Fall back to stub bot-message handling below.
    }
    const slackConfig = this.configForInstance();
    if (envelope.type !== "event_callback" || !envelope.event || !slackConfig) return undefined;
    return slackEventToChannelEventIncludingBotMessages(envelope.event, slackConfig);
  }

  private adapterEvent(envelope: SlackEnvelope): ChannelInboundEvent | undefined {
    const slackConfig = this.configForInstance();
    const adapter = this.adapter;
    if (!adapter) return undefined;
    if (envelope.type === "event_callback" && envelope.event?.bot_id) return undefined;
    // Let the adapter keep normal user-message/action behavior identical to the
    // core Slack adapter. Bot-message fallback is only for the live driver app.
    return slackConfig ? (awaitlessSlackEnvelopeToEvent(envelope, slackConfig)) : undefined;
  }

  private async handleEvent(event: ChannelInboundEvent): Promise<void> {
    if (!this.adapter || event.channel !== SLACK_CHANNEL) return;
    try {
      if (event.kind === "action") {
        await this.handleAction(event);
        return;
      }
      await this.handleMessage(event);
    } catch (error) {
      this.lastError = safeSlackRuntimeError(error);
      if (event.kind === "message") {
        await this.adapter.sendText({ channel: SLACK_CHANNEL, conversationId: event.conversation.id, userId: event.sender.userId }, `PiRelay Slack stub error: ${this.lastError}`).catch(() => undefined);
      }
    }
  }

  private async handleAction(action: ChannelInboundAction): Promise<void> {
    await this.adapter?.answerAction(action.actionId, { text: "PiRelay Slack stub received the action." });
  }

  private async handleMessage(message: ChannelInboundMessage): Promise<void> {
    const slackConfig = this.configForInstance();
    if (!slackConfig || !isSlackIdentityAllowed(message.sender, slackConfig)) return;
    if (message.conversation.kind !== "private") {
      if (!slackConfig.allowChannelMessages) return;
      const localBotUserId = process.env.PI_RELAY_SLACK_BOT_USER_ID;
      if (localBotUserId && !message.text.includes(`<@${localBotUserId}>`)) return;
    }
    const route = [...this.routes.values()][0];
    const routeText = route ? ` for ${route.sessionLabel}` : "";
    await this.adapter!.sendText(
      { channel: SLACK_CHANNEL, conversationId: message.conversation.id, userId: message.sender.userId },
      `PiRelay Slack stub received${routeText}: ${message.text.trim() || "(empty message)"}`,
    );
  }

  private configForInstance() {
    return this.config.slackInstances?.[this.instanceId] ?? this.config.slack;
  }
}

export function getOrCreateSlackRuntime(config: TelegramTunnelConfig, options?: SlackRuntimeOptions, instanceId = "default"): SlackRuntime | undefined {
  const slackConfig = config.slackInstances?.[instanceId] ?? config.slack;
  if (!slackConfig?.enabled || !slackConfig.botToken) return undefined;
  return new SlackRuntime(config, options, instanceId);
}

function hasHistoryReader(operations: SlackApiOperations | undefined): operations is SlackApiOperations & { listChannelMessages(channel: string, oldest?: string): Promise<SlackMessageEventFromHistory[]> } {
  return Boolean(operations && "listChannelMessages" in operations && typeof operations.listChannelMessages === "function");
}

function slackEventToChannelEventIncludingBotMessages(event: SlackMessageEvent | SlackMessageEventFromHistory, config: Parameters<typeof slackEventToChannelEvent>[1]): ChannelInboundMessage | undefined {
  if (!event.bot_id) return slackEventToChannelEvent(event, config);
  const senderUser = event.user;
  if (!senderUser || event.subtype && event.subtype !== "bot_message") return undefined;
  return {
    kind: "message",
    channel: SLACK_CHANNEL,
    updateId: event.ts,
    messageId: event.ts,
    text: event.text ?? "",
    attachments: [],
    conversation: {
      channel: SLACK_CHANNEL,
      id: event.channel,
      kind: event.channel_type === "im" ? "private" : event.channel_type === "channel" || event.channel_type === "group" ? "channel" : event.channel_type === "mpim" ? "group" : "unknown",
    },
    sender: {
      channel: SLACK_CHANNEL,
      userId: senderUser,
      username: event.username,
      displayName: event.username,
      metadata: { teamId: event.team, botId: event.bot_id },
    },
    metadata: { teamId: event.team, botId: event.bot_id, liveStubBotMessage: true },
  };
}

function awaitlessSlackEnvelopeToEvent(envelope: SlackEnvelope, config: NonNullable<TelegramTunnelConfig["slack"]>): ChannelInboundEvent | undefined {
  // Avoid importing private adapter internals; use the public adapter path by
  // constructing a tiny no-op adapter operations object and invoking webhook-free
  // event normalization through the exported message helper where possible.
  if (envelope.type === "event_callback" && envelope.event) return slackEventToChannelEvent(envelope.event, config);
  return undefined;
}

function safeSlackRuntimeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

function debugSlackRuntime(message: string): void {
  const path = process.env.PI_RELAY_SLACK_DEBUG_LOG;
  if (!path) return;
  appendFileSync(path, `${new Date().toISOString()} ${redactSecrets(message)}\n`);
}
