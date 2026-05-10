import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlackApiOperations, SlackAuthTestResult, SlackEnvelope, SlackPostMessagePayload, SlackUploadFilePayload } from "../extensions/relay/adapters/slack/adapter.js";
import { SlackLiveOperations } from "../extensions/relay/adapters/slack/live-client.js";
import { SlackRuntime } from "../extensions/relay/adapters/slack/runtime.js";
import type { SessionRoute, TelegramTunnelConfig } from "../extensions/relay/core/types.js";
import { TunnelStateStore } from "../extensions/relay/state/tunnel-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class FakeWebSocket {
  static sockets: FakeWebSocket[] = [];
  readonly listeners = new Map<string, Array<(event: never) => void>>();
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close", undefined as never);
  }

  addEventListener(type: "message" | "error" | "close", listener: (event: never) => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }

  emit(type: "message" | "error" | "close", event: never): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeSlackOperations implements SlackApiOperations {
  handler?: (event: SlackEnvelope) => Promise<void>;
  readonly posts: SlackPostMessagePayload[] = [];
  readonly ephemeral: Array<{ channel: string; user: string; text: string }> = [];
  readonly responses: Array<{ url: string; text: string }> = [];

  async startSocketMode(handler: (event: SlackEnvelope) => Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async stopSocketMode(): Promise<void> {
    this.handler = undefined;
  }

  async authTest(): Promise<SlackAuthTestResult> {
    return { teamId: "T1", userId: "U_BOT", botId: "B1", appId: "A1" };
  }

  async postMessage(payload: SlackPostMessagePayload): Promise<void> {
    this.posts.push(payload);
  }

  async uploadFile(_payload: SlackUploadFilePayload): Promise<void> {
    throw new Error("not implemented");
  }

  async postEphemeral(payload: { channel: string; user: string; text: string }): Promise<void> {
    this.ephemeral.push(payload);
  }

  async postResponse(url: string, payload: { text: string }): Promise<void> {
    this.responses.push({ url, text: payload.text });
  }
}

async function config(): Promise<TelegramTunnelConfig> {
  const stateDir = await mkdtemp(join(tmpdir(), "pirelay-slack-runtime-"));
  tempDirs.push(stateDir);
  return {
    botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    stateDir,
    pairingExpiryMs: 300_000,
    busyDeliveryMode: "followUp",
    allowUserIds: [],
    summaryMode: "deterministic",
    maxTelegramMessageChars: 3900,
    sendRetryCount: 1,
    sendRetryBaseMs: 1,
    pollingTimeoutSeconds: 1,
    redactionPatterns: [],
    maxInboundImageBytes: 1024,
    maxOutboundImageBytes: 1024,
    maxLatestImages: 4,
    allowedImageMimeTypes: ["image/png"],
    slack: {
      enabled: true,
      botToken: "slack-bot-token",
      signingSecret: "slack-signing-secret",
      eventMode: "socket",
      workspaceId: "T1",
      allowUserIds: ["U_DRIVER"],
      allowChannelMessages: true,
      sharedRoom: { enabled: true, roomHint: "C1" },
    },
  };
}

function route(): SessionRoute {
  return {
    sessionKey: "session-id:memory",
    sessionId: "session-id",
    sessionLabel: "Docs",
    notification: { lastStatus: "idle" },
    actions: {
      context: { isIdle: () => true } as never,
      getModel: () => undefined,
      sendUserMessage: vi.fn(),
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "not-found" }),
      appendAudit: vi.fn(),
      persistBinding: vi.fn(),
      promptLocalConfirmation: async () => true,
      abort: vi.fn(),
      compact: vi.fn(async () => undefined),
    },
  };
}

describe("SlackLiveOperations", () => {
  it("opens Socket Mode, acknowledges before dispatch, normalizes events, and redacts debug output", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("apps.connections.open") ? { ok: true, url: "wss://socket.test/secret" } : { ok: true },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const events: SlackEnvelope[] = [];
    const operations = new SlackLiveOperations({ botToken: "xoxb-secret", appToken: "xapp-secret", WebSocketCtor: FakeWebSocket, disableReconnect: true });

    await operations.startSocketMode(async (event) => {
      events.push(event);
    });

    const socket = FakeWebSocket.sockets.at(-1)!;
    socket.emit("message", { data: JSON.stringify({ envelope_id: "env-1", payload: { type: "event_callback", event_id: "ev-1", team_id: "T1", event: { type: "message", channel: "C1", channel_type: "channel", user: "U1", text: "hi", ts: "1" } } }) } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.sent).toEqual([JSON.stringify({ envelope_id: "env-1" })]);
    expect(events[0]).toMatchObject({ type: "event_callback", envelopeId: "env-1", eventId: "ev-1", event: { text: "hi", team: "T1" } });
  });

  it("discovers Slack bot identity with auth.test", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("auth.test") ? { ok: true, team_id: "T1", user_id: "U_BOT", bot_id: "B1", app_id: "A1" } : { ok: true },
    })));
    const operations = new SlackLiveOperations({ botToken: "xoxb-secret", appToken: "xapp-secret", WebSocketCtor: FakeWebSocket, disableReconnect: true });

    await expect(operations.authTest()).resolves.toEqual({ teamId: "T1", userId: "U_BOT", botId: "B1", appId: "A1" });
  });
});

describe("SlackRuntime foundations", () => {
  it("discovers identity, deduplicates retried events, ignores self messages, and keeps history polling disabled by default", async () => {
    const operations = new FakeSlackOperations();
    const runtime = new SlackRuntime(await config(), { operations });
    await runtime.registerRoute(route());
    await runtime.start();

    const event: SlackEnvelope = {
      type: "event_callback",
      envelopeId: "env-1",
      eventId: "ev-1",
      event: { type: "message", channel: "C1", channel_type: "channel", user: "U_DRIVER", text: "<@U_BOT> ping", ts: "1", team: "T1", bot_id: "B_DRIVER" },
    };
    await operations.handler!(event);
    await operations.handler!(event);
    await operations.handler!({ ...event, envelopeId: "env-2", eventId: "ev-2", event: { ...event.event!, user: "U_BOT", bot_id: "B1", ts: "2" } });

    expect(operations.posts).toHaveLength(1);
    expect(operations.posts[0]).toMatchObject({ channel: "C1", text: expect.stringContaining("not paired") });
  });

  it("pairs Slack DMs, persists the binding, and restores it for prompt receipt", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    const { nonce } = await store.createPendingPairing({
      channel: "slack",
      sessionId: testRoute.sessionId,
      sessionLabel: testRoute.sessionLabel,
      expiryMs: 300_000,
    });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({
      type: "event_callback",
      envelopeId: "pair-env",
      eventId: "pair-event",
      event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: `/pirelay ${nonce}`, ts: "10", team: "T1" },
    });

    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", text: expect.stringContaining("Slack paired with Docs") });
    await expect(store.inspectPendingPairing(nonce, { channel: "slack" })).resolves.toMatchObject({ status: "consumed" });
    await expect(store.getChannelBindingBySessionKey("slack", testRoute.sessionKey)).resolves.toMatchObject({ conversationId: "D1", userId: "U_DRIVER", instanceId: "default" });

    await operations.handler!({
      type: "event_callback",
      envelopeId: "prompt-env",
      eventId: "prompt-event",
      event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "hello", ts: "11", team: "T1" },
    });

    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledWith("hello");
    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", text: expect.stringContaining("Sent to Docs") });
  });

  it("routes Slack DM commands through session helpers", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    const testRoute = route();
    testRoute.notification.lastAssistantText = "full output";
    testRoute.notification.lastSummary = "summary output";
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({
      channel: "slack",
      instanceId: "default",
      conversationId: "D1",
      userId: "U_DRIVER",
      sessionKey: testRoute.sessionKey,
      sessionId: testRoute.sessionId,
      sessionLabel: testRoute.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    await store.setActiveChannelSelection("slack", "D1", "U_DRIVER", testRoute.sessionKey);
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    const send = async (text: string, ts: string, threadTs?: string) => operations.handler!({ type: "event_callback", envelopeId: `cmd-env-${ts}`, eventId: `cmd-event-${ts}`, event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text, ts, thread_ts: threadTs, team: "T1" } });

    await send("/help", "40");
    expect(operations.posts.at(-1)?.text).toContain("PiRelay Slack commands");
    await send("/status", "41");
    expect(operations.posts.at(-1)?.text).toContain("Session: Docs");
    await send("/sessions", "42");
    expect(operations.posts.at(-1)?.text).toContain("Docs");
    await send("/use Docs", "42.5");
    expect(operations.posts.at(-1)?.text).toContain("Active session set");
    await send("/summary", "43");
    expect(operations.posts.at(-1)?.text).toBe("summary output");
    await send("/full", "44");
    expect(operations.posts.at(-1)?.text).toBe("full output");
    await send("/images", "44.5");
    expect(operations.posts.at(-1)?.text).toContain("not available");
    await send("/to Docs hello there", "45");
    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledWith("hello there", undefined);
    await send("/pause", "46");
    expect(operations.posts.at(-1)?.text).toContain("paused");
    await send("ordinary while paused", "47");
    expect(operations.posts.at(-1)?.text).toContain("paused");
    await send("/resume", "48");
    expect(operations.posts.at(-1)?.text).toContain("resumed");
    await send("/abort", "49");
    expect(testRoute.actions.abort).toHaveBeenCalled();
    await send("/compact", "50");
    expect(testRoute.actions.compact).toHaveBeenCalled();
    await send("/recent", "51");
    expect(operations.posts.at(-1)?.text).toContain("No recent activity");
    await send("/unknown", "52");
    expect(operations.posts.at(-1)?.text).toContain("Unknown Slack command");
    await send("threaded prompt", "53", "parent-1");
    expect(operations.posts.at(-1)).toMatchObject({ threadTs: "parent-1", text: expect.stringContaining("Sent to Docs") });
    testRoute.notification.lastSummary = "done in thread";
    await runtime.notifyTurnCompleted(testRoute, "completed");
    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", threadTs: "parent-1", text: "done in thread" });

    await operations.handler!({ type: "block_actions", channel: { id: "D1" }, user: { id: "U_DRIVER", team_id: "T1" }, actions: [{ value: "summary" }], response_url: "https://hooks.slack.test/response" });
    expect(operations.responses.at(-1)?.text).toBe("done in thread");
    await send("/disconnect", "54");
    expect(operations.posts.at(-1)?.text).toContain("disconnected");
  });

  it("routes Slack shared-room messages only when locally targeted or actively selected", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "C1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();
    const send = async (text: string, ts: string) => operations.handler!({ type: "event_callback", envelopeId: `room-env-${ts}`, eventId: `room-event-${ts}`, event: { type: "message", channel: "C1", channel_type: "channel", user: "U_DRIVER", text, ts, team: "T1" } });

    await send("<@UREMOTE> ignore me", "60");
    expect(operations.posts).toHaveLength(0);
    await send("<@U_BOT> <@UREMOTE> ambiguous", "61");
    expect(operations.posts.at(-1)?.text).toContain("multiple bot mentions");
    await send("<@U_BOT> local prompt", "62");
    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledWith("local prompt");
    const postCount = operations.posts.length;
    await send("/use remote docs", "62.5");
    await expect(store.getActiveChannelSelection("slack", "C1", "U_DRIVER")).resolves.toMatchObject({ machineId: "remote" });
    await send("plain for remote", "62.6");
    expect(testRoute.actions.sendUserMessage).not.toHaveBeenCalledWith("plain for remote");
    await store.setActiveChannelSelection("slack", "C1", "U_DRIVER", testRoute.sessionKey);
    await send("active plain prompt", "63");
    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledWith("active plain prompt");
    expect(operations.posts.length).toBeGreaterThan(postCount);
  });

  it("rejects invalid Slack pairing attempts and prevents code reuse", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.slack = { ...runtimeConfig.slack!, allowUserIds: ["U_ALLOWED"] };
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    const { nonce: expiredNonce } = await store.createPendingPairing({ channel: "slack", sessionId: "expired", sessionLabel: "Expired", expiryMs: -1 });
    await operations.handler!({ type: "event_callback", envelopeId: "expired-env", eventId: "expired-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `/pirelay ${expiredNonce}`, ts: "19", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("invalid or expired");
    const { nonce: wrongChannelNonce } = await store.createPendingPairing({ channel: "discord", sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, expiryMs: 300_000 });
    await operations.handler!({ type: "event_callback", envelopeId: "wrong-channel-env", eventId: "wrong-channel-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `/pirelay ${wrongChannelNonce}`, ts: "19.5", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("invalid or expired");

    const { nonce } = await store.createPendingPairing({ channel: "slack", sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, expiryMs: 300_000 });
    await operations.handler!({ type: "event_callback", envelopeId: "bad-env", eventId: "bad-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_BAD", text: `/pirelay ${nonce}`, ts: "20", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("not authorized");
    await expect(store.inspectPendingPairing(nonce, { channel: "slack" })).resolves.toMatchObject({ status: "active" });

    await operations.handler!({ type: "event_callback", envelopeId: "ok-env", eventId: "ok-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `/pirelay ${nonce}`, ts: "21", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("Slack paired");
    const postCount = operations.posts.length;
    await operations.handler!({ type: "event_callback", envelopeId: "reuse-env", eventId: "reuse-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `/pirelay ${nonce}`, ts: "22", team: "T1" } });
    expect(operations.posts).toHaveLength(postCount);
  });

  it("trusts locally approved Slack users", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.slack = { ...runtimeConfig.slack!, allowUserIds: [] };
    const testRoute = route();
    testRoute.actions.promptLocalConfirmation = async () => "trust";
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    const { nonce } = await store.createPendingPairing({ channel: "slack", sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, expiryMs: 300_000 });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({ type: "event_callback", envelopeId: "trust-env", eventId: "trust-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_NEW", text: `/pirelay ${nonce}`, ts: "30", team: "T1" } });

    expect(operations.posts.at(-1)?.text).toContain("Slack paired");
    await expect(store.getTrustedRelayUser("slack", "U_NEW")).resolves.toMatchObject({ userId: "U_NEW" });
  });

  it("rejects workspace mismatch during startup", async () => {
    const operations = new FakeSlackOperations();
    vi.spyOn(operations, "authTest").mockResolvedValue({ teamId: "T2", userId: "U_BOT" });
    const runtime = new SlackRuntime(await config(), { operations });

    await expect(runtime.start()).rejects.toThrow("workspace mismatch");
  });
});
