import type { ChannelInboundEvent } from "./channel-adapter.js";
import { telegramCapabilities, telegramUpdateToChannelEvent } from "./telegram-adapter.js";
import { parseTelegramActionCallbackData, type TelegramActionCallback } from "./telegram-actions.js";
import type { TelegramInboundCallback, TelegramInboundMessage, TelegramInboundUpdate, TelegramTunnelConfig } from "./types.js";
import { parseTelegramCommand } from "./utils.js";
import {
  createRelayPipeline,
  type RelayMediaReference,
  type RelayMiddleware,
  type RelayPipelineEvent,
  type RelayPipelineResult,
} from "./relay-middleware.js";

const DEFAULT_TELEGRAM_CAPABILITIES = {
  inlineButtons: true,
  textMessages: true,
  documents: true,
  images: true,
  activityIndicators: true,
  callbacks: true,
  privateChats: true,
  groupChats: false,
  maxTextChars: 3900,
  supportedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

export interface TelegramRelayEventOptions {
  authorized: boolean;
  config?: TelegramTunnelConfig;
  route?: {
    sessionKey: string;
    sessionLabel: string;
    online: boolean;
    busy: boolean;
    paused?: boolean;
  };
}

export interface TelegramIngressPipelineResult {
  event: RelayPipelineEvent;
  result: RelayPipelineResult;
}

export function createTelegramRelayEvent(update: TelegramInboundUpdate, options: TelegramRelayEventOptions): RelayPipelineEvent {
  const inbound = telegramUpdateToChannelEvent(update);
  return {
    id: `telegram:${update.updateId}`,
    channel: "telegram",
    phase: "inbound",
    inbound,
    identity: {
      userId: inbound.sender.userId,
      username: inbound.sender.username,
      displayName: inbound.sender.displayName,
    },
    route: options.route,
    authorized: options.authorized,
    adapter: {
      channel: "telegram",
      capabilities: options.config ? telegramCapabilities(options.config) : DEFAULT_TELEGRAM_CAPABILITIES,
    },
    metadata: { telegramUpdateId: update.updateId },
  };
}

export function telegramCommandMiddleware(): RelayMiddleware {
  return {
    id: "telegram-command-intent",
    phases: ["intent"],
    order: 10,
    run: async (event) => {
      if (!isMessageEvent(event.inbound)) return { kind: "continue", event };
      const command = parseTelegramCommand(event.inbound.text);
      if (!command) return { kind: "continue", event };
      return {
        kind: "continue",
        event,
        intent: {
          type: "command",
          command: command.command,
          args: command.args,
          safety: "safe",
          metadata: { source: "telegram" },
        },
      };
    },
  };
}

export function telegramActionMiddleware(): RelayMiddleware {
  return {
    id: "telegram-action-intent",
    phases: ["intent"],
    order: 20,
    run: async (event) => {
      if (!isActionEvent(event.inbound)) return { kind: "continue", event };
      const action = parseTelegramActionCallbackData(event.inbound.actionData);
      if (!action) return { kind: "continue", event };
      return {
        kind: "internal-action",
        event,
        action: {
          type: "custom",
          safety: "safe",
          metadata: { source: "telegram", telegramAction: action },
        },
      };
    },
  };
}

export function telegramMediaMiddleware(): RelayMiddleware {
  return {
    id: "telegram-media-metadata",
    phases: ["inbound"],
    order: 10,
    run: async (event) => {
      if (!isMessageEvent(event.inbound) || event.inbound.attachments.length === 0) return { kind: "continue", event };
      const media: RelayMediaReference[] = event.inbound.attachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        safety: "media-download",
        metadata: attachment.metadata,
      }));
      return { kind: "continue", event: { ...event, media: [...(event.media ?? []), ...media] } };
    },
  };
}

const telegramIngressPipeline = createRelayPipeline([
  telegramMediaMiddleware(),
  telegramCommandMiddleware(),
  telegramActionMiddleware(),
]);

export async function runTelegramIngressPipeline(update: TelegramInboundUpdate, options: TelegramRelayEventOptions): Promise<TelegramIngressPipelineResult> {
  const event = createTelegramRelayEvent(update, options);
  const result = await telegramIngressPipeline.run(event);
  return { event: result.event ?? event, result };
}

export function commandIntentFromPipeline(result: RelayPipelineResult): { command: string; args: string } | undefined {
  return result.kind === "continue" && result.intent?.type === "command" && result.intent.command
    ? { command: result.intent.command, args: result.intent.args ?? "" }
    : undefined;
}

export function telegramActionFromPipelineResult(result: RelayPipelineResult): TelegramActionCallback | undefined {
  if (result.kind !== "internal-action") return undefined;
  const candidate = result.action.metadata?.telegramAction;
  return isTelegramActionCallback(candidate) ? candidate : undefined;
}

function isTelegramActionCallback(value: unknown): value is TelegramActionCallback {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.kind !== "string" || typeof candidate.turnId !== "string") return false;
  switch (candidate.kind) {
    case "answer-option":
      return typeof candidate.optionId === "string";
    case "answer-custom":
    case "full-chat":
    case "full-markdown":
    case "latest-images":
      return true;
    case "answer-ambiguity":
      return typeof candidate.token === "string"
        && (candidate.resolution === "prompt" || candidate.resolution === "answer" || candidate.resolution === "cancel");
    default:
      return false;
  }
}

function isMessageEvent(event: ChannelInboundEvent | undefined): event is Extract<ChannelInboundEvent, { kind: "message" }> {
  return event?.kind === "message";
}

function isActionEvent(event: ChannelInboundEvent | undefined): event is Extract<ChannelInboundEvent, { kind: "action" }> {
  return event?.kind === "action";
}

export type { TelegramInboundMessage, TelegramInboundCallback };
