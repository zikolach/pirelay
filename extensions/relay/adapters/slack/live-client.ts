import { appendFileSync } from "node:fs";
import type { SlackApiOperations, SlackEnvelope, SlackPostMessagePayload, SlackUploadFilePayload } from "./adapter.js";
import { redactSecrets } from "../../config/setup.js";
import type { SlackRelayConfig } from "../../core/types.js";

interface SlackSocketModeEnvelope {
  envelope_id?: string;
  type?: string;
  payload?: unknown;
}

export interface SlackMessageEventFromHistory {
  type: "message";
  channel: string;
  channel_type?: "channel" | "group";
  user?: string;
  username?: string;
  text?: string;
  ts: string;
  team?: string;
  bot_id?: string;
  subtype?: string;
}

interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "close", listener: () => void): void;
}

export interface SlackLiveOperationsOptions {
  botToken: string;
  appToken?: string;
  WebSocketCtor?: new (url: string) => MinimalWebSocket;
}

export class SlackLiveOperations implements SlackApiOperations {
  private readonly botToken: string;
  private readonly appToken?: string;
  private readonly WebSocketCtor?: new (url: string) => MinimalWebSocket;
  private socket?: MinimalWebSocket;

  constructor(options: SlackLiveOperationsOptions) {
    this.botToken = options.botToken;
    this.appToken = options.appToken;
    this.WebSocketCtor = options.WebSocketCtor ?? webSocketCtorFromGlobal();
  }

  async startSocketMode(handler: (event: SlackEnvelope) => Promise<void>): Promise<void> {
    if (!this.appToken) throw new Error("Slack Socket Mode app-level token is not configured.");
    const url = await this.openSocketModeConnection();
    this.debug("Slack Socket Mode connection URL obtained.");
    if (!this.WebSocketCtor) throw new Error("Slack Socket Mode requires a WebSocket implementation in this Node runtime.");
    const socket = new this.WebSocketCtor(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      void this.handleSocketMessage(event.data, handler);
    });
    socket.addEventListener("error", (event) => {
      const message = event instanceof Error ? event.message : inspectWebSocketError(event);
      this.debug(`Slack Socket Mode error: ${redactSecrets(message)}`);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = undefined;
    });
  }

  async stopSocketMode(): Promise<void> {
    this.socket?.close();
    this.socket = undefined;
  }

  async postMessage(payload: SlackPostMessagePayload): Promise<void> {
    await this.callSlackApi("chat.postMessage", this.botToken, { channel: payload.channel, text: payload.text, blocks: payload.blocks ? slackBlocks(payload.blocks) : undefined });
  }

  async uploadFile(payload: SlackUploadFilePayload): Promise<void> {
    // files.upload v2 needs an upload URL flow. The live stub does not need file
    // delivery, so use a clear limitation instead of pretending upload worked.
    throw new Error(`Slack live file upload is not implemented for ${payload.fileName}.`);
  }

  async postEphemeral(payload: { channel: string; user: string; text: string }): Promise<void> {
    await this.callSlackApi("chat.postEphemeral", this.botToken, payload);
  }

  async postResponse(responseUrl: string, payload: { text: string; replaceOriginal?: boolean; ephemeral?: boolean }): Promise<void> {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Slack response_url failed with HTTP ${response.status}.`);
  }

  async downloadFile(url: string): Promise<Uint8Array> {
    const response = await fetch(url, { headers: { authorization: `Bearer ${this.botToken}` } });
    if (!response.ok) throw new Error(`Slack file download failed: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async listChannelMessages(channel: string, oldest?: string): Promise<SlackMessageEventFromHistory[]> {
    const response = await this.callSlackApi("conversations.history", this.botToken, { channel, oldest, inclusive: false, limit: 20 });
    const messages = Array.isArray(response.messages) ? response.messages : [];
    return messages.map((message) => slackHistoryMessageToEvent(message, channel)).filter((message): message is SlackMessageEventFromHistory => Boolean(message));
  }

  private async openSocketModeConnection(): Promise<string> {
    const response = await this.callSlackApi("apps.connections.open", this.appToken!, {});
    const url = response.url;
    if (typeof url !== "string") throw new Error("Slack Socket Mode did not return a WebSocket URL.");
    return url;
  }

  private async handleSocketMessage(data: unknown, handler: (event: SlackEnvelope) => Promise<void>): Promise<void> {
    const text = typeof data === "string" ? data : data instanceof Buffer ? data.toString("utf8") : String(data);
    this.debug(text);
    const envelope = JSON.parse(text) as SlackSocketModeEnvelope;
    if (envelope.envelope_id) this.socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    const normalized = socketPayloadToSlackEnvelope(envelope.payload);
    if (normalized) await handler(normalized);
  }

  private debug(message: string): void {
    const path = process.env.PI_RELAY_SLACK_DEBUG_LOG;
    if (!path) return;
    appendFileSync(path, `${new Date().toISOString()} ${redactSlackDebugMessage(message)}\n`);
  }

  private async callSlackApi(method: string, token: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: formEncode(removeUndefined(body)),
    });
    if (!response.ok) throw new Error(`Slack API ${method} failed with HTTP ${response.status}.`);
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) throw new Error(`Slack API ${method} returned a non-object response.`);
    if (payload.ok === false) {
      const error = typeof payload.error === "string" ? payload.error : "unknown_error";
      throw new Error(`Slack API ${method} failed: ${error}.`);
    }
    return payload;
  }
}

export function createSlackLiveOperations(config: Pick<SlackRelayConfig, "botToken" | "eventMode">): SlackApiOperations | undefined {
  if (!config.botToken || config.eventMode === "webhook") return undefined;
  const appToken = process.env.PI_RELAY_SLACK_APP_TOKEN;
  if (!appToken) return undefined;
  return new SlackLiveOperations({ botToken: config.botToken, appToken });
}

function slackHistoryMessageToEvent(message: unknown, channel: string): SlackMessageEventFromHistory | undefined {
  if (!isRecord(message) || typeof message.ts !== "string") return undefined;
  return {
    type: "message",
    channel,
    channel_type: channel.startsWith("G") ? "group" : "channel",
    user: typeof message.user === "string" ? message.user : undefined,
    username: typeof message.username === "string" ? message.username : undefined,
    text: typeof message.text === "string" ? message.text : undefined,
    ts: message.ts,
    team: typeof message.team === "string" ? message.team : undefined,
    bot_id: typeof message.bot_id === "string" ? message.bot_id : undefined,
    subtype: typeof message.subtype === "string" ? message.subtype : undefined,
  };
}

function socketPayloadToSlackEnvelope(payload: unknown): SlackEnvelope | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.type === "event_callback") {
    return {
      type: "event_callback",
      event: isRecord(payload.event) ? { ...payload.event, team: typeof payload.team_id === "string" ? payload.team_id : payload.event.team } as unknown as SlackEnvelope["event"] : undefined,
      team: typeof payload.team_id === "string" ? { id: payload.team_id } : undefined,
    };
  }
  if (payload.type === "block_actions") return payload as unknown as SlackEnvelope;
  return undefined;
}

function slackBlocks(rows: SlackPostMessagePayload["blocks"]): unknown[] | undefined {
  return rows?.map((row) => ({
    type: "actions",
    elements: row.map((button) => ({
      type: "button",
      text: { type: "plain_text", text: button.text },
      value: button.value,
      style: button.style,
    })),
  }));
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function formEncode(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return params.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function webSocketCtorFromGlobal(): (new (url: string) => MinimalWebSocket) | undefined {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof candidate === "function" ? candidate as new (url: string) => MinimalWebSocket : undefined;
}

function redactSlackDebugMessage(message: string): string {
  return redactSecrets(message)
    .replace(/"token":"[^"]+"/g, '"token":"[redacted]"')
    .replace(/"url":"wss:\/\/[^"]+"/g, '"url":"[redacted]"');
}

function inspectWebSocketError(event: unknown): string {
  if (!isRecord(event)) return String(event);
  const fields: Record<string, unknown> = {};
  for (const key of ["type", "message", "error", "code", "reason"]) {
    if (key in event) fields[key] = event[key];
  }
  const error = event.error;
  if (error instanceof Error) fields.error = { name: error.name, message: error.message, stack: error.stack };
  return JSON.stringify(fields);
}
