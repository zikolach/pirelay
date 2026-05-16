import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlackApiOperations, SlackAuthTestResult, SlackEnvelope, SlackPostEphemeralPayload, SlackPostMessagePayload, SlackReactionPayload, SlackUploadFilePayload } from "../extensions/relay/adapters/slack/adapter.js";
import { SlackLiveOperations } from "../extensions/relay/adapters/slack/live-client.js";
import { SlackRuntime } from "../extensions/relay/adapters/slack/runtime.js";
import { routeUnavailableError } from "../extensions/relay/core/route-actions.js";
import type { SessionRoute, TelegramTunnelConfig } from "../extensions/relay/core/types.js";
import { TunnelStateStore } from "../extensions/relay/state/tunnel-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
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
  readonly ephemeral: SlackPostEphemeralPayload[] = [];
  readonly responses: Array<{ url: string; text: string }> = [];
  responseError?: Error;
  addReaction?: (payload: SlackReactionPayload) => Promise<void>;
  removeReaction?: (payload: SlackReactionPayload) => Promise<void>;

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

  readonly uploads: SlackUploadFilePayload[] = [];
  uploadError?: Error;

  async uploadFile(payload: SlackUploadFilePayload): Promise<void> {
    if (this.uploadError) throw this.uploadError;
    this.uploads.push(payload);
  }

  async postEphemeral(payload: SlackPostEphemeralPayload): Promise<void> {
    this.ephemeral.push(payload);
  }

  async postResponse(url: string, payload: { text: string }): Promise<void> {
    if (this.responseError) throw this.responseError;
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

async function waitForSlackRuntimeCondition(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for Slack runtime side effect.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
    const logDir = await mkdtemp(join(tmpdir(), "pirelay-slack-debug-"));
    tempDirs.push(logDir);
    const logPath = join(logDir, "debug.log");
    vi.stubEnv("PI_RELAY_SLACK_DEBUG_LOG", logPath);
    const events: SlackEnvelope[] = [];
    const operations = new SlackLiveOperations({ botToken: "xoxb-secret", appToken: "xapp-secret", WebSocketCtor: FakeWebSocket, disableReconnect: true });

    await operations.startSocketMode(async (event) => {
      events.push(event);
    });

    const socket = FakeWebSocket.sockets.at(-1)!;
    socket.emit("message", { data: "not-json" } as never);
    socket.emit("message", { data: JSON.stringify({ envelope_id: "env-1", payload: { type: "event_callback", event_id: "ev-1", team_id: "T1", event: { type: "message", channel: "C1", channel_type: "channel", user: "U1", text: "hi", ts: "1" } } }) } as never);
    socket.emit("message", { data: JSON.stringify({ envelope_id: "env-2", type: "slash_commands", payload: { command: "/relay", text: "status", channel_id: "C1", channel_name: "general", user_id: "U1", user_name: "alice", team_id: "T1", trigger_id: "trigger-1", response_url: "https://hooks.slack.com/commands/T1/B1/response" } }) } as never);
    socket.emit("message", { data: JSON.stringify({ envelope_id: "env-3", payload: { type: "block_actions", response_url: "https://hooks.slack.com/actions/T/B/secret", state: { values: "xapp-secret-token" }, token: "xoxb-secret-token", user: { id: "U1" }, channel: { id: "C1" }, actions: [{ value: "summary" }] } }) } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.sent).toEqual([JSON.stringify({ envelope_id: "env-1" }), JSON.stringify({ envelope_id: "env-2" }), JSON.stringify({ envelope_id: "env-3" })]);
    expect(events[0]).toMatchObject({ type: "event_callback", envelopeId: "env-1", eventId: "ev-1", event: { text: "hi", team: "T1" } });
    expect(events[1]).toMatchObject({ type: "slash_command", envelopeId: "env-2", command: "/relay", text: "status", channel_id: "C1", user_id: "U1", team_id: "T1", trigger_id: "trigger-1", response_url: "https://hooks.slack.com/commands/T1/B1/response" });
    const debugLog = await readFile(logPath, "utf8");
    expect(debugLog).not.toContain("hooks.slack.com");
    expect(debugLog).not.toContain("xapp-secret-token");
    expect(debugLog).not.toContain("xoxb-secret-token");
    expect(debugLog).not.toContain("wss://socket.test/secret");
  });

  it("discovers Slack bot identity with auth.test", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("auth.test") ? { ok: true, team_id: "T1", user_id: "U_BOT", bot_id: "B1", app_id: "A1" } : { ok: true },
    })));
    const operations = new SlackLiveOperations({ botToken: "xoxb-secret", appToken: "xapp-secret", WebSocketCtor: FakeWebSocket, disableReconnect: true });

    await expect(operations.authTest()).resolves.toEqual({ teamId: "T1", userId: "U_BOT", botId: "B1", appId: "A1" });
  });

  it("uploads Slack files through the external upload flow", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("files.getUploadURLExternal")) return { ok: true, json: async () => ({ ok: true, upload_url: "https://upload.slack.test/secret", file_id: "F1" }) };
      if (url === "https://upload.slack.test/secret") return { ok: true, text: async () => "ok" };
      if (url.endsWith("files.completeUploadExternal")) return { ok: true, json: async () => ({ ok: true }) };
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const operations = new SlackLiveOperations({ botToken: "xoxb-secret", appToken: "xapp-secret", WebSocketCtor: FakeWebSocket, disableReconnect: true });

    await operations.uploadFile({ channel: "C1", fileName: "out.png", mimeType: "image/png", data: new Uint8Array([1, 2]), caption: "Latest", threadTs: "123.45" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("filename=out.png");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("length=2");
    expect(fetchMock.mock.calls[1]).toMatchObject(["https://upload.slack.test/secret", { method: "POST", headers: { "content-type": "image/png" } }]);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain("channel_id=C1");
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain("thread_ts=123.45");
    expect(decodeURIComponent(String(fetchMock.mock.calls[2]?.[1]?.body))).toContain('"id":"F1"');
  });

  it("reports Slack upload API and byte upload failures", async () => {
    const operations = new SlackLiveOperations({ botToken: "xoxb-secret", appToken: "xapp-secret", WebSocketCtor: FakeWebSocket, disableReconnect: true });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("files.getUploadURLExternal") ? { ok: false, error: "missing_scope" } : { ok: true },
    })));
    await expect(operations.uploadFile({ channel: "C1", fileName: "out.png", mimeType: "image/png", data: new Uint8Array([1]) })).rejects.toThrow("missing_scope");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("files.getUploadURLExternal")) return { ok: true, json: async () => ({ ok: true, upload_url: "https://upload.slack.test/secret", file_id: "F1" }) };
      if (url === "https://upload.slack.test/secret") return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ ok: true }) };
    }));
    await expect(operations.uploadFile({ channel: "C1", fileName: "out.png", mimeType: "image/png", data: new Uint8Array([1]) })).rejects.toThrow("HTTP 503");
  });

  it("rejects malformed Slack upload URL responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, upload_url: "https://upload.slack.test/secret" }) })));
    const operations = new SlackLiveOperations({ botToken: "xoxb-secret", appToken: "xapp-secret", WebSocketCtor: FakeWebSocket, disableReconnect: true });

    await expect(operations.uploadFile({ channel: "C1", fileName: "out.png", mimeType: "image/png", data: new Uint8Array([1]) })).rejects.toThrow("upload URL and file id");
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

  it("prevents overlapping Slack history fallback polls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PI_RELAY_SLACK_HISTORY_FALLBACK", "true");
    const operations = new FakeSlackOperations() as FakeSlackOperations & { listChannelMessages: ReturnType<typeof vi.fn> };
    let finishFirstPoll: (() => void) | undefined;
    operations.listChannelMessages = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishFirstPoll = resolve;
      });
      return [];
    });
    const runtime = new SlackRuntime(await config(), { operations });
    await runtime.registerRoute(route());
    await runtime.start();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(operations.listChannelMessages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(operations.listChannelMessages).toHaveBeenCalledTimes(1);

    finishFirstPoll?.();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(operations.listChannelMessages).toHaveBeenCalledTimes(2);
    await runtime.stop();
    vi.useRealTimers();
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
      event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: `relay pair ${nonce}`, ts: "10", team: "T1" },
    });

    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", text: expect.stringContaining("Slack paired with Docs") });
    expect(operations.posts.at(-1)?.text).toContain("relay status");
    expect(testRoute.actions.appendAudit).toHaveBeenCalledWith("Slack paired with U_DRIVER.");
    await expect(store.inspectPendingPairing(nonce, { channel: "slack" })).resolves.toMatchObject({ status: "consumed" });
    await expect(store.getChannelBindingBySessionKey("slack", testRoute.sessionKey)).resolves.toMatchObject({ conversationId: "D1", userId: "U_DRIVER", instanceId: "default" });

    await operations.handler!({
      type: "event_callback",
      envelopeId: "prompt-env",
      eventId: "prompt-event",
      event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "hello", ts: "11", team: "T1" },
    });

    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledWith("hello");
    expect(operations.ephemeral.at(-1)).toMatchObject({ channel: "D1", user: "U_DRIVER", text: "Pi is working…", threadTs: "11" });
    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", text: expect.stringContaining("Sent to Docs") });

    await operations.handler!({
      type: "event_callback",
      envelopeId: "status-env",
      eventId: "status-event",
      event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "relay status", ts: "12", team: "T1" },
    });

    expect(operations.posts.at(-1)?.text).not.toContain("pairing code is invalid");
    expect(operations.posts.at(-1)?.text).toContain("Docs");
  });

  it("sends lifecycle notifications through the matching Slack instance", async () => {
    const runtimeConfig = await config();
    runtimeConfig.slackInstances = {
      beta: { ...runtimeConfig.slack!, enabled: true, botToken: "slack-beta", signingSecret: "secret", eventMode: "socket", appToken: "xapp-beta", allowUserIds: ["U_DRIVER"], allowChannelMessages: true },
    };
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "beta", conversationId: "C_BETA", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { conversationKind: "channel" } });
    const defaultOperations = new FakeSlackOperations();
    const betaOperations = new FakeSlackOperations();
    const defaultRuntime = new SlackRuntime(runtimeConfig, { operations: defaultOperations });
    const betaRuntime = new SlackRuntime(runtimeConfig, { operations: betaOperations }, "beta");

    await defaultRuntime.registerRoute(testRoute);
    await betaRuntime.registerRoute(testRoute);
    await defaultRuntime.start();
    await betaRuntime.start();

    await defaultRuntime.notifyLifecycle(testRoute, "offline");
    await betaRuntime.notifyLifecycle(testRoute, "offline");

    expect(defaultOperations.posts).toHaveLength(0);
    expect(betaOperations.posts).toContainEqual(expect.objectContaining({ channel: "C_BETA", text: expect.stringContaining("went offline locally") }));

    const postCount = betaOperations.posts.length;
    await store.revokeChannelBinding("slack", testRoute.sessionKey, undefined, "beta");
    await betaRuntime.notifyLifecycle(testRoute, "online");
    expect(betaOperations.posts).toHaveLength(postCount);
  });

  it("reports missing Socket Mode operations instead of silently succeeding", async () => {
    vi.stubEnv("PI_RELAY_SLACK_APP_TOKEN", "");
    const runtimeConfig = await config();
    runtimeConfig.slack = { ...runtimeConfig.slack!, appToken: undefined, eventMode: "socket" };
    const runtime = new SlackRuntime(runtimeConfig);

    await expect(runtime.start()).rejects.toThrow("app-level token");
    expect(runtime.getStatus()).toMatchObject({ enabled: true, started: false, error: expect.stringContaining("app-level token") });
  });

  it("adds and removes Slack thinking reactions for accepted prompts", async () => {
    const operations = new FakeSlackOperations();
    const addReaction = vi.fn(async (_payload: SlackReactionPayload) => undefined);
    const removeReaction = vi.fn(async (_payload: SlackReactionPayload) => undefined);
    operations.addReaction = addReaction;
    operations.removeReaction = removeReaction;
    const runtimeConfig = await config();
    const testRoute = route();
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
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({ type: "event_callback", envelopeId: "react-env", eventId: "react-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "hello", ts: "31", team: "T1" } });

    expect(addReaction).toHaveBeenCalledWith({ channel: "D1", timestamp: "31", name: "thinking_face" });
    expect(operations.ephemeral).toHaveLength(0);
    await runtime.notifyTurnCompleted(testRoute, "completed");
    expect(removeReaction).toHaveBeenCalledWith({ channel: "D1", timestamp: "31", name: "thinking_face" });
  });

  it("cleans Slack thinking reactions on stop and route unregister", async () => {
    const startRuntime = async (ts: string) => {
      const operations = new FakeSlackOperations();
      operations.addReaction = vi.fn(async (_payload: SlackReactionPayload) => undefined);
      operations.removeReaction = vi.fn(async (_payload: SlackReactionPayload) => undefined);
      const runtimeConfig = await config();
      const testRoute = route();
      const store = new TunnelStateStore(runtimeConfig.stateDir);
      await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
      const runtime = new SlackRuntime(runtimeConfig, { operations });
      await runtime.registerRoute(testRoute);
      await runtime.start();
      await operations.handler!({ type: "event_callback", envelopeId: `cleanup-env-${ts}`, eventId: `cleanup-event-${ts}`, event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "hello", ts, team: "T1" } });
      return { operations, runtime, testRoute };
    };

    const stopped = await startRuntime("32");
    await stopped.runtime.stop();
    expect(stopped.operations.removeReaction).toHaveBeenCalledWith({ channel: "D1", timestamp: "32", name: "thinking_face" });

    const unregistered = await startRuntime("33");
    await unregistered.runtime.unregisterRoute(unregistered.testRoute.sessionKey);
    expect(unregistered.operations.removeReaction).toHaveBeenCalledWith({ channel: "D1", timestamp: "33", name: "thinking_face" });
  });

  it("falls back to ephemeral Slack activity when thinking reactions fail", async () => {
    const operations = new FakeSlackOperations();
    operations.addReaction = vi.fn(async () => {
      throw new Error("missing_scope");
    });
    const runtimeConfig = await config();
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({ type: "event_callback", envelopeId: "react-fallback-env", eventId: "react-fallback-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "hello", ts: "34", thread_ts: "parent-34", team: "T1" } });

    expect(operations.addReaction).toHaveBeenCalledWith({ channel: "D1", timestamp: "34", name: "thinking_face" });
    expect(operations.ephemeral.at(-1)).toMatchObject({ channel: "D1", user: "U_DRIVER", text: "Pi is working…", threadTs: "parent-34" });
    expect(runtime.getStatus().error).toBeUndefined();
  });

  it("keeps best-effort Slack activity failures out of runtime health", async () => {
    const operations = new FakeSlackOperations();
    operations.postEphemeral = vi.fn(async () => {
      throw new Error("ephemeral_not_allowed");
    });
    const runtimeConfig = await config();
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({ type: "event_callback", envelopeId: "activity-fallback-env", eventId: "activity-fallback-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "hello", ts: "35", thread_ts: "parent-35", team: "T1" } });
    await waitForSlackRuntimeCondition(() => vi.mocked(operations.postEphemeral).mock.calls.length > 0);

    expect(operations.postEphemeral).toHaveBeenCalled();
    expect(runtime.getStatus().error).toBeUndefined();
  });

  it("contains failed Slack progress sends from timer callbacks", async () => {
    const operations = new FakeSlackOperations();
    operations.postMessage = vi.fn(async () => {
      throw new Error("slack_unavailable");
    });
    const runtimeConfig = await config();
    runtimeConfig.verboseProgressIntervalMs = 1;
    const testRoute = route();
    testRoute.notification.lastStatus = "running";
    testRoute.notification.progressEvent = { id: "progress-fail", kind: "tool", text: "Running tests", at: Date.now() };
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { progressMode: "verbose" } });
    const runtime = new SlackRuntime(runtimeConfig, { operations });

    await runtime.registerRoute(testRoute);
    await waitForSlackRuntimeCondition(() => vi.mocked(operations.postMessage).mock.calls.length > 0);

    expect(operations.postMessage).toHaveBeenCalled();
    expect(runtime.getStatus().error).toBeUndefined();
  });

  it("preserves Slack thread context for runtime error responses", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    const testRoute = route();
    testRoute.actions.sendUserMessage = vi.fn(() => {
      throw new Error("boom");
    });
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

    await operations.handler!({ type: "event_callback", envelopeId: "error-env", eventId: "error-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "explode", ts: "35", thread_ts: "parent-35", team: "T1" } });

    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", threadTs: "parent-35", text: expect.stringContaining("PiRelay Slack error") });
  });

  it("does not retarget current-turn completion notifications to busy follow-up threads", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    const testRoute = route();
    testRoute.actions.context = { isIdle: () => false } as never;
    testRoute.notification.lastSummary = "current turn done";
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
      metadata: { threadTs: "old-parent" },
    });
    await store.setActiveChannelSelection("slack", "D1", "U_DRIVER", testRoute.sessionKey);
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({ type: "event_callback", envelopeId: "busy-thread-env", eventId: "busy-thread-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "What is the current openspec status?", ts: "36", thread_ts: "new-parent", team: "T1" } });

    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledWith("What is the current openspec status?", { deliverAs: "followUp" });
    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", threadTs: "new-parent", text: expect.stringContaining("queued") });
    await runtime.notifyTurnCompleted(testRoute, "completed");
    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", threadTs: "old-parent", text: "current turn done" });
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
    expect(operations.posts.at(-1)?.text).toContain("relay status - session and relay dashboard");
    expect(operations.posts.at(-1)?.text).not.toContain("/status - session and relay dashboard");
    expect(operations.posts.at(-1)?.text).toContain("do not prefix commands with `/`");
    await send("/status", "41");
    expect(operations.posts.at(-1)?.text).toContain("Session: Docs");
    await operations.handler!({ type: "slash_command", command: "/relay", text: "status", channel_id: "D1", user_id: "U_DRIVER", user_name: "driver", team_id: "T1", trigger_id: "slash-status", response_url: "https://hooks.slack.test/slash" });
    expect(operations.responses.at(-1)).toMatchObject({ url: "https://hooks.slack.test/slash", text: expect.stringContaining("Session: Docs") });
    await operations.handler!({ type: "slash_command", command: "/relay", text: "help", channel_id: "D1", user_id: "U_DRIVER", user_name: "driver", team_id: "T1", trigger_id: "slash-help", response_url: "https://hooks.slack.test/help" });
    expect(operations.responses.at(-1)).toMatchObject({ url: "https://hooks.slack.test/help", text: expect.stringContaining("PiRelay Slack commands") });
    expect(operations.responses.filter((response) => response.url === "https://hooks.slack.test/help")).toHaveLength(1);
    operations.responseError = new Error("expired response url");
    await operations.handler!({ type: "slash_command", command: "/relay", text: "status", channel_id: "D1", user_id: "U_DRIVER", user_name: "driver", team_id: "T1", trigger_id: "slash-fallback", response_url: "https://hooks.slack.test/expired" });
    expect(operations.posts.at(-1)?.text).toContain("Session: Docs");
    operations.responseError = undefined;
    await operations.handler!({ type: "slash_command", command: "/relay", text: "status", channel_id: "D1", user_id: "U_BAD", user_name: "bad", team_id: "T1", trigger_id: "slash-bad", response_url: "https://hooks.slack.test/bad" });
    expect(operations.responses.some((response) => response.url === "https://hooks.slack.test/bad")).toBe(false);
    await send("/progress", "41.1");
    expect(operations.posts.at(-1)?.text).toContain("Progress mode: normal");
    expect(operations.posts.at(-1)?.text).toContain("Usage: relay progress <quiet|normal|verbose|completion-only>");
    await send("/progress verbose", "41.2");
    expect(operations.posts.at(-1)?.text).toContain("Progress notifications set to verbose");
    await send("/progress", "41.3");
    expect(operations.posts.at(-1)?.text).toContain("Progress mode: verbose");
    await send("/sessions", "42");
    expect(operations.posts.at(-1)?.text).toContain("Docs");
    await send("/use Docs", "42.5");
    expect(operations.posts.at(-1)?.text).toContain("Active session set");
    await send("/summary", "43");
    expect(operations.posts.at(-1)?.text).toBe("summary output");
    await send("/full", "44");
    expect(operations.posts.at(-1)?.text).toBe("full output");
    await send("/images", "44.5");
    expect(operations.posts.at(-1)?.text).toContain("No image outputs");
    expect(operations.posts.at(-1)?.text).toContain("relay send-image");
    await send("/to Docs hello there", "45");
    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledWith("hello there", undefined);
    expect(operations.ephemeral.at(-1)).toMatchObject({ channel: "D1", user: "U_DRIVER", text: "Pi is working…", threadTs: "45" });
    await send("/pause", "46");
    expect(operations.posts.at(-1)?.text).toContain("paused");
    await send("ordinary while paused", "47");
    expect(operations.posts.at(-1)?.text).toContain("relay resume");
    await send("/resume", "48");
    expect(operations.posts.at(-1)?.text).toContain("resumed");
    await send("/abort", "49");
    expect(operations.posts.at(-1)?.text).toContain("already idle");
    expect(testRoute.actions.abort).not.toHaveBeenCalled();
    await send("/compact", "50");
    expect(testRoute.actions.compact).toHaveBeenCalled();
    vi.mocked(testRoute.actions.compact).mockRejectedValueOnce(routeUnavailableError());
    await send("/compact", "50.5");
    expect(operations.posts.at(-1)?.text).toContain("The Pi session is unavailable");
    await send("/recent", "51");
    expect(operations.posts.at(-1)?.text).toContain("No recent activity");
    await send("/unknown", "52");
    expect(operations.posts.at(-1)?.text).toContain("Unknown Slack command");
    expect(operations.posts.at(-1)?.text).toContain("relay help");
    await send("threaded prompt", "53", "parent-1");
    expect(operations.posts.at(-1)).toMatchObject({ threadTs: "parent-1", text: expect.stringContaining("Sent to Docs") });
    testRoute.notification.lastSummary = "done in thread";
    await runtime.notifyTurnCompleted(testRoute, "completed");
    expect(operations.posts.at(-2)).toMatchObject({ channel: "D1", threadTs: "parent-1", text: expect.stringContaining("Final output") });
    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", threadTs: "parent-1", text: "full output" });

    await operations.handler!({ type: "block_actions", channel: { id: "D1" }, user: { id: "U_DRIVER", team_id: "T1" }, actions: [{ value: "summary" }], response_url: "https://hooks.slack.test/response" });
    expect(operations.responses.at(-1)?.text).toBe("done in thread");
    await send("/disconnect", "54");
    expect(operations.posts.at(-1)?.text).toContain("disconnected");
  });

  it("delivers Slack progress updates when route state changes", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.verboseProgressIntervalMs = 1;
    const testRoute = route();
    testRoute.notification.lastStatus = "running";
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
      metadata: { progressMode: "verbose", threadTs: "parent-progress" },
    });
    const runtime = new SlackRuntime(runtimeConfig, { operations });

    testRoute.notification.progressEvent = { id: "progress-1", kind: "tool", text: "Running tests", at: Date.now() };
    await runtime.registerRoute(testRoute);
    await waitForSlackRuntimeCondition(() => operations.posts.length > 0);

    expect(operations.posts.at(-1)).toMatchObject({ channel: "D1", threadTs: "parent-progress", text: expect.stringContaining("Pi progress") });
    expect(operations.posts.at(-1)?.text).toContain("Running tests");
  });

  it("uploads latest, explicit images, and requester-scoped Slack files", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    const root = await mkdtemp(join(tmpdir(), "pirelay-slack-remote-file-"));
    tempDirs.push(root);
    await writeFile(join(root, "report.md"), "# Report\n");
    const testRoute = route();
    (testRoute.actions.context as { cwd: string }).cwd = root;
    testRoute.actions.getLatestImages = vi.fn(async () => [
      { id: "img-1", turnId: "turn-1", fileName: "latest.png", mimeType: "image/png", data: Buffer.from([1, 2]).toString("base64"), byteSize: 2 },
    ]);
    testRoute.actions.getImageByPath = vi.fn(async () => ({ ok: true as const, image: { id: "img-2", turnId: "turn-1", fileName: "path.png", mimeType: "image/png", data: Buffer.from([3]).toString("base64"), byteSize: 1 } }));
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();
    const send = async (text: string, ts: string, threadTs?: string) => operations.handler!({ type: "event_callback", envelopeId: `image-env-${ts}`, eventId: `image-event-${ts}`, event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text, ts, thread_ts: threadTs, team: "T1" } });

    await send("relay images", "55", "thread-55");
    await send("relay send-image outputs/path.png", "56");
    await send("relay send-file report.md Report", "56.5", "thread-56");
    const assistantResult = await runtime.sendFileToRequester(testRoute, testRoute.remoteRequester!, "report.md", "Tool report");

    expect(assistantResult).toContain("Delivered report.md");
    expect(operations.uploads).toContainEqual(expect.objectContaining({ channel: "D1", fileName: "latest.png", mimeType: "image/png", caption: "Latest Pi image output", threadTs: "thread-55" }));
    expect(operations.uploads).toContainEqual(expect.objectContaining({ channel: "D1", fileName: "path.png", mimeType: "image/png", caption: "Pi image file" }));
    expect(operations.uploads).toContainEqual(expect.objectContaining({ channel: "D1", fileName: "report.md", mimeType: "text/markdown", caption: "Report", threadTs: "thread-56" }));
    expect(operations.uploads).toContainEqual(expect.objectContaining({ channel: "D1", fileName: "report.md", mimeType: "text/markdown", caption: "Tool report", threadTs: "thread-56" }));
    expect(testRoute.actions.getImageByPath).toHaveBeenCalledWith("outputs/path.png");
  });

  it("reports Slack image upload failures without marking runtime health failed", async () => {
    const operations = new FakeSlackOperations();
    operations.uploadError = new Error("Slack API files.getUploadURLExternal failed: missing_scope.");
    const runtimeConfig = await config();
    const testRoute = route();
    testRoute.actions.getLatestImages = vi.fn(async () => [
      { id: "img-1", turnId: "turn-1", fileName: "latest.png", mimeType: "image/png", data: Buffer.from([1]).toString("base64"), byteSize: 1 },
    ]);
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({ type: "event_callback", envelopeId: "image-fail-env", eventId: "image-fail-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_DRIVER", text: "relay images", ts: "57", team: "T1" } });

    expect(operations.posts.at(-1)?.text).toContain("files:write");
    expect(runtime.getStatus().error).toBeUndefined();
  });

  it("fails Slack image delivery when the adapter is unavailable", async () => {
    const runtimeConfig = await config();
    runtimeConfig.slack = { enabled: true, signingSecret: "slack-signing-secret" };
    const runtime = new SlackRuntime(runtimeConfig, { operations: new FakeSlackOperations() });
    const latestImage = { id: "img-1", turnId: "turn-1", fileName: "latest.png", mimeType: "image/png", data: Buffer.from([1]).toString("base64"), byteSize: 1 };
    const imageSender = runtime as unknown as { sendSlackImage(message: unknown, image: typeof latestImage, caption: string): Promise<void> };

    await expect(imageSender.sendSlackImage({}, latestImage, "Latest Pi image output")).rejects.toThrow("Slack file delivery is not configured");
  });

  it("suppresses Slack progress updates for quiet bindings", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.verboseProgressIntervalMs = 1;
    const testRoute = route();
    testRoute.notification.lastStatus = "running";
    testRoute.notification.progressEvent = { id: "progress-quiet", kind: "tool", text: "Running tests", at: Date.now() };
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { progressMode: "quiet" } });
    const runtime = new SlackRuntime(runtimeConfig, { operations });

    await runtime.registerRoute(testRoute);

    expect(operations.posts).toHaveLength(0);
  });

  it("clears pending Slack progress when the binding is revoked before flush", async () => {
    vi.useFakeTimers();
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.verboseProgressIntervalMs = 50;
    const testRoute = route();
    testRoute.notification.lastStatus = "running";
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    const baseBinding = { channel: "slack" as const, instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { progressMode: "verbose" } };
    await store.upsertChannelBinding(baseBinding);
    const runtime = new SlackRuntime(runtimeConfig, { operations });

    testRoute.notification.progressEvent = { id: "progress-before-revoke", kind: "tool", text: "Should not send", at: Date.now() };
    await runtime.registerRoute(testRoute);
    await store.revokeChannelBinding("slack", testRoute.sessionKey);
    await vi.advanceTimersByTimeAsync(50);

    expect(operations.posts).toHaveLength(0);
    await vi.waitFor(() => expect((runtime as unknown as { progressStates: Map<string, unknown> }).progressStates.size).toBe(0));
  });

  it("cancels pending Slack progress when mode changes to quiet", async () => {
    vi.useFakeTimers();
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.verboseProgressIntervalMs = 50;
    const testRoute = route();
    testRoute.notification.lastStatus = "running";
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    const baseBinding = { channel: "slack" as const, instanceId: "default", conversationId: "D1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
    await store.upsertChannelBinding({ ...baseBinding, metadata: { progressMode: "verbose" } });
    const runtime = new SlackRuntime(runtimeConfig, { operations });

    testRoute.notification.progressEvent = { id: "progress-before-quiet", kind: "tool", text: "First update", at: Date.now() };
    await runtime.registerRoute(testRoute);
    await vi.runOnlyPendingTimersAsync();
    await vi.waitFor(() => expect(operations.posts).toHaveLength(1));

    testRoute.notification.progressEvent = { id: "progress-after-quiet", kind: "tool", text: "Should not send", at: Date.now() };
    await runtime.registerRoute(testRoute);
    await store.upsertChannelBinding({ ...baseBinding, metadata: { progressMode: "quiet" } });
    await runtime.registerRoute(testRoute);
    await vi.advanceTimersByTimeAsync(70);

    expect(operations.posts).toHaveLength(1);
  });

  it("routes Slack channel prompts after pairing, use, and one-shot targeting", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.slack = { ...runtimeConfig.slack!, allowChannelMessages: true, allowUserIds: ["U_DRIVER", "U_OTHER"], delegation: { enabled: true, autonomy: "auto-claim-targeted", requireHumanApproval: false } };
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    const { nonce } = await store.createPendingPairing({
      channel: "slack",
      sessionId: testRoute.sessionId,
      sessionLabel: testRoute.sessionLabel,
      expiryMs: 300_000,
      codeKind: "pin",
    });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();
    const sendChannelMessage = async (text: string, ts: string, user = "U_DRIVER", threadTs?: string) => operations.handler!({ type: "event_callback", envelopeId: `channel-env-${ts}`, eventId: `channel-event-${ts}`, event: { type: "message", channel: "C1", channel_type: "channel", user, text, ts, thread_ts: threadTs, team: "T1" } });

    await sendChannelMessage("relay delegate local should wait for pairing", "69");
    expect(await store.listDelegationTasks({ roomConversationId: "C1" })).toHaveLength(0);

    await sendChannelMessage(`relay pair ${nonce}`, "70");
    expect(operations.posts.at(-1)).toMatchObject({ channel: "C1", text: expect.stringContaining("Slack paired") });
    await expect(store.getActiveChannelSelection("slack", "C1", "U_DRIVER")).resolves.toMatchObject({ sessionKey: testRoute.sessionKey });

    await sendChannelMessage("ordinary channel prompt after pairing", "70.1");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith("ordinary channel prompt after pairing");

    await sendChannelMessage("relay delegate local run channel task", "70.2", "U_DRIVER", "thread-70");
    const [delegationTask] = await store.listDelegationTasks({ roomConversationId: "C1" });
    expect(delegationTask).toMatchObject({ status: "claimable", room: { threadId: "thread-70" } });
    await sendChannelMessage(`relay task claim ${delegationTask!.id}`, "70.3", "U_DRIVER", "thread-70");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith(expect.stringContaining(`delegated task ${delegationTask!.id}`));
    testRoute.notification.lastAssistantText = "Channel task done.";
    await runtime.notifyTurnCompleted(testRoute, "completed");
    expect(operations.posts.at(-1)).toMatchObject({ channel: "C1", threadTs: "thread-70", text: expect.stringContaining("Status: completed") });

    await store.clearActiveChannelSelection("slack", "C1", "U_DRIVER");
    const sendCount = vi.mocked(testRoute.actions.sendUserMessage).mock.calls.length;
    const postCount = operations.posts.length;
    await sendChannelMessage("ordinary channel chatter", "70.5", "U_OTHER");
    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledTimes(sendCount);
    expect(operations.posts).toHaveLength(postCount);

    await sendChannelMessage("ordinary channel prompt with in-memory active selection", "70.6");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith("ordinary channel prompt with in-memory active selection");

    await sendChannelMessage("relay status", "71");
    expect(operations.posts.at(-1)).toMatchObject({ channel: "C1", text: expect.stringContaining("Session: Docs") });
    expect(operations.posts.at(-1)?.text).not.toContain("pairing code is invalid");
    await expect(store.getActiveChannelSelection("slack", "C1", "U_DRIVER")).resolves.toMatchObject({ sessionKey: testRoute.sessionKey });

    await sendChannelMessage("relay use Docs", "72");
    expect(operations.posts.at(-1)?.text).toContain("Active session set to Docs");
    await expect(store.getActiveChannelSelection("slack", "C1", "U_DRIVER")).resolves.toMatchObject({ sessionKey: testRoute.sessionKey });
    await sendChannelMessage("ordinary channel prompt after use", "73");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith("ordinary channel prompt after use");

    await store.clearActiveChannelSelection("slack", "C1", "U_DRIVER");
    await sendChannelMessage("relay to local Docs machine-qualified prompt", "74");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith("machine-qualified prompt", undefined);
    await expect(store.getActiveChannelSelection("slack", "C1", "U_DRIVER")).resolves.toBeUndefined();

    await sendChannelMessage("relay to Docs session-only prompt", "75");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith("session-only prompt", undefined);
    await expect(store.getActiveChannelSelection("slack", "C1", "U_DRIVER")).resolves.toBeUndefined();

    testRoute.remoteRequester = undefined;
    testRoute.actions.isIdle = () => undefined;
    const callsBeforeUnavailableTarget = vi.mocked(testRoute.actions.sendUserMessage).mock.calls.length;
    await sendChannelMessage("relay to Docs unavailable target", "75.5");
    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledTimes(callsBeforeUnavailableTarget);
    expect(testRoute.remoteRequester).toBeUndefined();
    expect(operations.posts.at(-1)?.text).toContain("offline");

    const callsBeforeRemoteTarget = vi.mocked(testRoute.actions.sendUserMessage).mock.calls.length;
    await sendChannelMessage("relay to remote Docs should not route", "76");
    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledTimes(callsBeforeRemoteTarget);
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

  it("keeps shared-room plain text silent after Slack disconnect clears active selection", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.slack = { ...runtimeConfig.slack!, allowChannelMessages: true };
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "C1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();
    const send = async (text: string, ts: string) => operations.handler!({ type: "event_callback", envelopeId: `disconnect-env-${ts}`, eventId: `disconnect-event-${ts}`, event: { type: "message", channel: "C1", channel_type: "channel", user: "U_DRIVER", text, ts, team: "T1" } });

    await send("relay use Docs", "80");
    expect(operations.posts.at(-1)?.text).toContain("Active session set");
    await send("active prompt before disconnect", "81");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith("active prompt before disconnect");
    await send("relay disconnect", "82");
    expect(operations.posts.at(-1)?.text).toContain("disconnected");

    const sendCount = vi.mocked(testRoute.actions.sendUserMessage).mock.calls.length;
    const postCount = operations.posts.length;
    await send("ordinary chatter after disconnect", "83");

    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledTimes(sendCount);
    expect(operations.posts).toHaveLength(postCount);
  });

  it("clears in-memory Slack active selections on runtime stop", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.slack = { ...runtimeConfig.slack!, allowChannelMessages: true };
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({ channel: "slack", instanceId: "default", conversationId: "C1", userId: "U_DRIVER", sessionKey: testRoute.sessionKey, sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();
    const send = async (text: string, ts: string) => operations.handler!({ type: "event_callback", envelopeId: `stop-env-${ts}`, eventId: `stop-event-${ts}`, event: { type: "message", channel: "C1", channel_type: "channel", user: "U_DRIVER", text, ts, team: "T1" } });

    await send("relay use Docs", "90");
    await store.clearActiveChannelSelection("slack", "C1", "U_DRIVER");
    await send("in-memory prompt before stop", "91");
    expect(testRoute.actions.sendUserMessage).toHaveBeenLastCalledWith("in-memory prompt before stop");

    await store.clearActiveChannelSelection("slack", "C1", "U_DRIVER");
    await runtime.stop();
    await runtime.start();
    const sendCount = vi.mocked(testRoute.actions.sendUserMessage).mock.calls.length;
    const postCount = operations.posts.length;
    await send("ordinary chatter after stop", "92");

    expect(testRoute.actions.sendUserMessage).toHaveBeenCalledTimes(sendCount);
    expect(operations.posts).toHaveLength(postCount);
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
    await operations.handler!({ type: "event_callback", envelopeId: "expired-env", eventId: "expired-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `relay pair ${expiredNonce}`, ts: "19", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("invalid or expired");
    const { nonce: wrongChannelNonce } = await store.createPendingPairing({ channel: "discord", sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, expiryMs: 300_000 });
    await operations.handler!({ type: "event_callback", envelopeId: "wrong-channel-env", eventId: "wrong-channel-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `relay pair ${wrongChannelNonce}`, ts: "19.5", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("invalid or expired");

    const { nonce } = await store.createPendingPairing({ channel: "slack", sessionId: testRoute.sessionId, sessionLabel: testRoute.sessionLabel, expiryMs: 300_000 });
    await operations.handler!({ type: "event_callback", envelopeId: "bad-env", eventId: "bad-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_BAD", text: `relay pair ${nonce}`, ts: "20", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("not authorized");
    await expect(store.inspectPendingPairing(nonce, { channel: "slack" })).resolves.toMatchObject({ status: "active" });

    await operations.handler!({ type: "event_callback", envelopeId: "ok-env", eventId: "ok-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `relay pair ${nonce}`, ts: "21", team: "T1" } });
    expect(operations.posts.at(-1)?.text).toContain("Slack paired");
    const postCount = operations.posts.length;
    await operations.handler!({ type: "event_callback", envelopeId: "reuse-env", eventId: "reuse-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_ALLOWED", text: `relay pair ${nonce}`, ts: "22", team: "T1" } });
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

    await operations.handler!({ type: "event_callback", envelopeId: "trust-env", eventId: "trust-event", event: { type: "message", channel: "D1", channel_type: "im", user: "U_NEW", text: `relay pair ${nonce}`, ts: "30", team: "T1" } });

    expect(operations.posts.at(-1)?.text).toContain("Slack paired");
    await expect(store.getTrustedRelayUser("slack", "U_NEW")).resolves.toMatchObject({ userId: "U_NEW" });
  });

  it("does not route Slack slash commands from channels when channel control is disabled", async () => {
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    runtimeConfig.slack = { ...runtimeConfig.slack!, allowChannelMessages: false };
    const testRoute = route();
    const store = new TunnelStateStore(runtimeConfig.stateDir);
    await store.upsertChannelBinding({
      channel: "slack",
      instanceId: "default",
      conversationId: "C1",
      userId: "U_DRIVER",
      sessionKey: testRoute.sessionKey,
      sessionId: testRoute.sessionId,
      sessionLabel: testRoute.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    await operations.handler!({ type: "slash_command", command: "/relay", text: "status", channel_id: "C1", user_id: "U_DRIVER", user_name: "driver", team_id: "T1", trigger_id: "slash-channel", response_url: "https://hooks.slack.test/channel" });

    expect(operations.responses).toEqual([]);
    expect(operations.posts).toEqual([]);
  });

  it("only uses a Slack response_url once and reuses it after TTL expiry", async () => {
    vi.useFakeTimers();
    const operations = new FakeSlackOperations();
    const runtimeConfig = await config();
    const testRoute = route();
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
    const runtime = new SlackRuntime(runtimeConfig, { operations });
    await runtime.registerRoute(testRoute);
    await runtime.start();

    const send = async (responseUrl: string, ts: string, text = "status") => operations.handler!({
      type: "slash_command",
      command: "/relay",
      text,
      channel_id: "D1",
      user_id: "U_DRIVER",
      user_name: "driver",
      team_id: "T1",
      trigger_id: "slash-expiring",
      response_url: responseUrl,
    });

    try {
      await send("https://hooks.slack.test/repeat", "60");
      expect(operations.responses).toEqual([expect.objectContaining({ url: "https://hooks.slack.test/repeat" })]);

      await send("https://hooks.slack.test/repeat", "61");
      expect(operations.responses).toHaveLength(1);

      vi.advanceTimersByTime(31 * 60 * 1000);

      await send("https://hooks.slack.test/repeat", "62");
      expect(operations.responses).toHaveLength(2);
      expect(operations.responses.at(-1)?.url).toBe("https://hooks.slack.test/repeat");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects workspace mismatch during startup", async () => {
    const operations = new FakeSlackOperations();
    vi.spyOn(operations, "authTest").mockResolvedValue({ teamId: "T2", userId: "U_BOT" });
    const runtime = new SlackRuntime(await config(), { operations });

    await expect(runtime.start()).rejects.toThrow("workspace mismatch");
  });
});
