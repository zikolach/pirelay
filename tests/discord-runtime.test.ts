import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordApiOperations, DiscordAttachmentPayload, DiscordGatewayEvent, DiscordMentionPayload, DiscordSendFilePayload, DiscordSendMessagePayload } from "../extensions/relay/adapters/discord/adapter.js";
import { createDiscordRuntime, DiscordRuntime, getOrCreateDiscordRuntime } from "../extensions/relay/adapters/discord/runtime.js";
import { TunnelStateStore } from "../extensions/relay/state/tunnel-store.js";
import type { SessionRoute, TelegramTunnelConfig } from "../extensions/relay/core/types.js";
import { formatSessionList } from "../extensions/relay/core/session-selection.js";

const tempDirs: string[] = [];

class FakeDiscordOperations implements DiscordApiOperations {
  handler?: (event: DiscordGatewayEvent) => Promise<void>;
  readonly messages: DiscordSendMessagePayload[] = [];
  readonly files: DiscordSendFilePayload[] = [];
  readonly typing: string[] = [];
  readonly answers: Array<{ interactionId: string; text?: string; alert?: boolean }> = [];

  constructor(private readonly connectError?: Error, private readonly typingError?: Error) {}

  async connect(handler: (event: DiscordGatewayEvent) => Promise<void>): Promise<void> {
    if (this.connectError) throw this.connectError;
    this.handler = handler;
  }

  async disconnect(): Promise<void> {
    this.handler = undefined;
  }

  async sendMessage(payload: DiscordSendMessagePayload): Promise<void> {
    this.messages.push(payload);
  }

  async sendFile(payload: DiscordSendFilePayload): Promise<void> {
    this.files.push(payload);
  }

  async sendTyping(channelId: string): Promise<void> {
    if (this.typingError) throw this.typingError;
    this.typing.push(channelId);
  }

  async answerInteraction(interactionId: string, _interactionToken: string | undefined, options?: { text?: string; alert?: boolean }): Promise<void> {
    this.answers.push({ interactionId, text: options?.text, alert: options?.alert });
  }
}

async function config(overrides: Partial<TelegramTunnelConfig["discord"]> = {}): Promise<TelegramTunnelConfig> {
  const stateDir = await mkdtemp(join(tmpdir(), "pirelay-discord-runtime-"));
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
    discord: { enabled: true, botToken: "discord-token-test", allowUserIds: ["u1"], ...overrides },
  };
}

function route(options: { idle?: boolean; promptLocalConfirmation?: SessionRoute["actions"]["promptLocalConfirmation"] } = {}): { route: SessionRoute; sendUserMessage: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> } {
  const sendUserMessage = vi.fn();
  const abort = vi.fn();
  return {
    route: {
      sessionKey: "session-id:memory",
      sessionId: "session-id",
      sessionLabel: "Docs",
      notification: { lastStatus: "idle" },
      actions: {
        context: { isIdle: () => options.idle ?? true } as never,
        getModel: () => undefined,
        sendUserMessage,
        getLatestImages: async () => [],
        getImageByPath: async () => ({ ok: false, error: "not-found" }),
        appendAudit: vi.fn(),
        persistBinding: vi.fn(),
        promptLocalConfirmation: options.promptLocalConfirmation ?? (async () => true),
        abort,
        compact: async () => undefined,
      },
    },
    sendUserMessage,
    abort,
  };
}

function discordMessage(content: string, options: { userId?: string; channelId?: string; guildId?: string; bot?: boolean; mentions?: DiscordMentionPayload[]; attachments?: DiscordAttachmentPayload[] } = {}): DiscordGatewayEvent {
  return {
    type: "message",
    payload: {
      id: `m-${Math.random()}`,
      channel_id: options.channelId ?? "dm1",
      guild_id: options.guildId,
      content,
      mentions: options.mentions,
      author: { id: options.userId ?? "u1", username: "nik", bot: options.bot ?? false },
      attachments: options.attachments ?? [],
    },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("DiscordRuntime", () => {
  it("does not create a runtime when Discord is disabled", async () => {
    const disabled = await config({ enabled: false, botToken: undefined });
    expect(createDiscordRuntime(disabled)).toBeUndefined();
  });

  it("reuses a process-wide Discord runtime per bot token", async () => {
    const cfg = await config({ botToken: `discord-token-${Date.now()}` });
    const first = getOrCreateDiscordRuntime(cfg, { operations: new FakeDiscordOperations() });
    const second = getOrCreateDiscordRuntime(cfg, { operations: new FakeDiscordOperations() });

    expect(first).toBe(second);
    await first?.stop();
  });

  it("creates live runtimes from non-default Discord messenger instances", async () => {
    const cfg = await config();
    cfg.discord = undefined;
    cfg.discordInstances = {
      work: { enabled: true, botToken: `discord-work-${cfg.stateDir}`, allowUserIds: ["u1"] },
    };
    const ops = new FakeDiscordOperations();

    const defaultRuntime = getOrCreateDiscordRuntime(cfg, { operations: ops });
    const workRuntime = getOrCreateDiscordRuntime(cfg, { operations: ops }, "work");

    expect(defaultRuntime).toBeUndefined();
    expect(workRuntime?.getStatus()).toMatchObject({ enabled: true, started: false });
    await workRuntime?.start();
    expect(ops.handler).toBeDefined();
    await workRuntime?.stop();
  });

  it("sends lifecycle notifications through the matching Discord instance", async () => {
    const cfg = await config();
    cfg.discordInstances = {
      beta: { ...cfg.discord!, enabled: true, botToken: "discord-beta", allowUserIds: ["u1"], allowGuildIds: ["g1"] },
    };
    const session = route().route;
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", instanceId: "beta", conversationId: "c-beta", userId: "u1", sessionKey: session.sessionKey, sessionId: session.sessionId, sessionLabel: session.sessionLabel, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), metadata: { guildId: "g1" } });
    const defaultOperations = new FakeDiscordOperations();
    const betaOperations = new FakeDiscordOperations();
    const defaultRuntime = new DiscordRuntime(cfg, { operations: defaultOperations });
    const betaRuntime = new DiscordRuntime(cfg, { operations: betaOperations }, "beta");

    await defaultRuntime.registerRoute(session);
    await betaRuntime.registerRoute(session);
    await defaultRuntime.start();
    await betaRuntime.start();

    await defaultRuntime.notifyLifecycle(session, "offline");
    await betaRuntime.notifyLifecycle(session, "offline");

    expect(defaultOperations.messages).toHaveLength(0);
    expect(betaOperations.messages).toContainEqual(expect.objectContaining({ channelId: "c-beta", content: expect.stringContaining("went offline locally") }));

    const messageCount = betaOperations.messages.length;
    await store.revokeChannelBinding("discord", session.sessionKey, undefined, "beta");
    await betaRuntime.notifyLifecycle(session, "online");
    expect(betaOperations.messages).toHaveLength(messageCount);
  });

  it("reports startup failures without exposing tokens", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations(new Error("bad discord-token-supersecret"));
    const runtime = new DiscordRuntime(cfg, { operations: ops });

    await runtime.registerRoute(route().route);
    await expect(runtime.start()).rejects.toThrow("[redacted]");
    expect(runtime.getStatus()).toMatchObject({ started: false, error: expect.stringContaining("[redacted]") });
    expect(runtime.getStatus().error).not.toContain("discord-token-supersecret");
  });

  it("pairs authorized Discord DMs with channel-scoped pending pairings", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const session = route().route;
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    const { nonce } = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000, codeKind: "pin" });

    expect(nonce).toMatch(/^\d{3}-\d{3}$/);
    await ops.handler?.(discordMessage(`relay pair ${nonce.replace("-", "")}`));

    expect(ops.messages.at(-1)?.content).toContain("Discord paired with Docs");
    const binding = await store.getChannelBinding("discord", "dm1", "u1");
    expect(binding).toMatchObject({ channel: "discord", sessionKey: "session-id:memory", conversationId: "dm1", userId: "u1" });
  });

  it("requires local approval for short Discord PINs and can trust users", async () => {
    const cfg = await config({ allowUserIds: [] });
    const ops = new FakeDiscordOperations();
    const promptLocalConfirmation = vi.fn(async () => "trust" as const);
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const session = route({ promptLocalConfirmation }).route;
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    const first = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000, codeKind: "pin" });

    await ops.handler?.(discordMessage(`relay pair ${first.nonce}`));

    expect(promptLocalConfirmation).toHaveBeenCalledWith(expect.objectContaining({ channel: "discord", userId: "u1", conversationKind: "private" }));
    expect(await store.getTrustedRelayUser("discord", "u1")).toMatchObject({ channel: "discord", userId: "u1", trustedBySessionLabel: "Docs" });

    const second = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000, codeKind: "pin" });
    await ops.handler?.(discordMessage(`relay pair ${second.nonce}`));

    expect(promptLocalConfirmation).toHaveBeenCalledTimes(1);
    expect(ops.messages.filter((message) => message.content.includes("Discord paired with Docs"))).toHaveLength(2);
  });

  it("denies short Discord PIN pairing when local approval is rejected", async () => {
    const cfg = await config({ allowUserIds: [] });
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const session = route({ promptLocalConfirmation: async () => "deny" }).route;
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    const { nonce } = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000, codeKind: "pin" });

    await ops.handler?.(discordMessage(`relay pair ${nonce}`));

    expect(ops.messages.at(-1)?.content).toContain("declined locally");
    expect(await store.getChannelBinding("discord", "dm1", "u1")).toBeUndefined();
    expect(await store.inspectPendingPairing(nonce, { channel: "discord" })).toMatchObject({ status: "consumed" });
  });

  it("bounds invalid Discord PIN guesses", async () => {
    const cfg = await config({ allowUserIds: [] });
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    await runtime.registerRoute(route().route);
    await runtime.start();

    for (let index = 0; index < 6; index += 1) {
      await ops.handler?.(discordMessage("relay pair 000-000"));
    }

    expect(ops.messages.at(-1)?.content).toContain("Too many invalid Discord pairing attempts");
  });

  it("rejects wrong-channel, unauthorized, and guild pairing attempts", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const session = route().route;
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    const wrong = await store.createPendingPairing({ channel: "telegram", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000 });
    await ops.handler?.(discordMessage(`/start ${wrong.nonce}`));
    const unauthorized = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000 });
    await ops.handler?.(discordMessage(`/start ${unauthorized.nonce}`, { userId: "u2" }));
    const guild = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000 });
    await ops.handler?.(discordMessage(`/start ${guild.nonce}`, { guildId: "g1" }));

    expect(ops.messages.map((message) => message.content).join("\n")).toContain("invalid or expired");
    expect(ops.messages.map((message) => message.content).join("\n")).toContain("not authorized");
    expect(ops.messages.map((message) => message.content).join("\n")).toContain("must happen in a bot DM");
    expect(await store.getChannelBinding("discord", "dm1", "u2")).toBeUndefined();
  });

  it("ignores Discord pairing codes for routes owned by another runtime without consuming them", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    await runtime.start();
    const session = route().route;
    const store = new TunnelStateStore(cfg.stateDir);
    const { nonce } = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000 });

    await ops.handler?.(discordMessage(`/start ${nonce}`));

    expect(ops.messages).toHaveLength(0);
    expect(await store.inspectPendingPairing(nonce, { channel: "discord" })).toMatchObject({ status: "active" });

    await runtime.registerRoute(session);
    await ops.handler?.(discordMessage(`/start ${nonce}`));

    expect(ops.messages.at(-1)?.content).toContain("Discord paired with Docs");
  });

  it("suppresses duplicate Discord pairing events after the code is consumed", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const session = route().route;
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    const { nonce } = await store.createPendingPairing({ channel: "discord", sessionId: session.sessionId, sessionLabel: session.sessionLabel, expiryMs: 60_000 });

    await ops.handler?.(discordMessage(`/start ${nonce}`));
    await ops.handler?.(discordMessage(`/start ${nonce}`));

    expect(ops.messages).toHaveLength(1);
    expect(ops.messages[0]?.content).toContain("Discord paired with Docs");
    expect(await store.inspectPendingPairing(nonce, { channel: "discord" })).toMatchObject({ status: "consumed" });
  });

  it("does not send stale offline replies from a runtime that does not own the Discord binding", async () => {
    const cfg = await config();
    const ownerOps = new FakeDiscordOperations();
    const staleOps = new FakeDiscordOperations();
    const ownerRuntime = new DiscordRuntime(cfg, { operations: ownerOps });
    const staleRuntime = new DiscordRuntime(cfg, { operations: staleOps });
    const { route: ownerRoute, sendUserMessage } = route();
    const { route: staleRoute } = route();
    staleRoute.sessionKey = "other-session:memory";
    staleRoute.sessionId = "other-session";
    staleRoute.sessionLabel = "Other";
    await ownerRuntime.registerRoute(ownerRoute);
    await staleRuntime.registerRoute(staleRoute);
    await ownerRuntime.start();
    await staleRuntime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    const { nonce } = await store.createPendingPairing({ channel: "discord", sessionId: ownerRoute.sessionId, sessionLabel: ownerRoute.sessionLabel, expiryMs: 60_000 });

    await ownerOps.handler?.(discordMessage(`/start ${nonce}`));
    await staleOps.handler?.(discordMessage("hello"));
    await ownerOps.handler?.(discordMessage("hello"));

    expect(staleOps.messages).toHaveLength(0);
    expect(sendUserMessage).toHaveBeenCalledWith("hello", undefined);
    expect(ownerOps.messages.at(-1)?.content).toContain("Prompt delivered to Pi.");
  });

  it("does not send stale offline replies from a route-less runtime that does not own the Discord binding", async () => {
    const cfg = await config();
    const ownerOps = new FakeDiscordOperations();
    const staleOps = new FakeDiscordOperations();
    const ownerRuntime = new DiscordRuntime(cfg, { operations: ownerOps });
    const staleRuntime = new DiscordRuntime(cfg, { operations: staleOps });
    const { route: ownerRoute, sendUserMessage } = route();
    await ownerRuntime.registerRoute(ownerRoute);
    await ownerRuntime.start();
    await staleRuntime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    const { nonce } = await store.createPendingPairing({ channel: "discord", sessionId: ownerRoute.sessionId, sessionLabel: ownerRoute.sessionLabel, expiryMs: 60_000 });

    await ownerOps.handler?.(discordMessage(`/start ${nonce}`));
    await staleOps.handler?.(discordMessage("hello"));
    await ownerOps.handler?.(discordMessage("hello"));

    expect(staleOps.messages).toHaveLength(0);
    expect(sendUserMessage).toHaveBeenCalledWith("hello", undefined);
    expect(ownerOps.messages.at(-1)?.content).toContain("Prompt delivered to Pi.");
  });

  it("routes a duplicated Discord ingress event to only the shared active session", async () => {
    const cfg = await config();
    const firstOps = new FakeDiscordOperations();
    const secondOps = new FakeDiscordOperations();
    const firstRuntime = new DiscordRuntime(cfg, { operations: firstOps });
    const secondRuntime = new DiscordRuntime(cfg, { operations: secondOps });
    const { route: firstRoute, sendUserMessage: firstSend } = route();
    const { route: secondRoute, sendUserMessage: secondSend } = route();
    secondRoute.sessionKey = "second-session:memory";
    secondRoute.sessionId = "second-session";
    secondRoute.sessionLabel = "Second";
    await firstRuntime.registerRoute(firstRoute);
    await secondRuntime.registerRoute(secondRoute);
    await firstRuntime.start();
    await secondRuntime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: firstRoute.sessionKey,
      sessionId: firstRoute.sessionId,
      sessionLabel: firstRoute.sessionLabel,
      boundAt: "2026-05-02T10:00:00.000Z",
      lastSeenAt: "2026-05-02T10:00:00.000Z",
    });
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: secondRoute.sessionKey,
      sessionId: secondRoute.sessionId,
      sessionLabel: secondRoute.sessionLabel,
      boundAt: "2026-05-02T11:00:00.000Z",
      lastSeenAt: "2026-05-02T11:00:00.000Z",
    });
    await store.setActiveChannelSelection("discord", "dm1", "u1", secondRoute.sessionKey);

    await firstOps.handler?.(discordMessage("only second should receive this"));
    await secondOps.handler?.(discordMessage("only second should receive this"));

    expect(firstSend).not.toHaveBeenCalled();
    expect(firstOps.messages).toHaveLength(0);
    expect(secondSend).toHaveBeenCalledOnce();
    expect(secondSend).toHaveBeenCalledWith("only second should receive this", undefined);
    expect(secondOps.messages.at(-1)?.content).toContain("Prompt delivered to Pi.");
  });

  it("routes duplicated Discord /to ingress to the explicitly targeted session only", async () => {
    const cfg = await config();
    const firstOps = new FakeDiscordOperations();
    const secondOps = new FakeDiscordOperations();
    const firstRuntime = new DiscordRuntime(cfg, { operations: firstOps });
    const secondRuntime = new DiscordRuntime(cfg, { operations: secondOps });
    const { route: firstRoute, sendUserMessage: firstSend } = route();
    const { route: secondRoute, sendUserMessage: secondSend } = route();
    secondRoute.sessionKey = "second-session:memory";
    secondRoute.sessionId = "second-session";
    secondRoute.sessionLabel = "Second";
    await firstRuntime.registerRoute(firstRoute);
    await secondRuntime.registerRoute(secondRoute);
    await firstRuntime.start();
    await secondRuntime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: firstRoute.sessionKey,
      sessionId: firstRoute.sessionId,
      sessionLabel: firstRoute.sessionLabel,
      metadata: { alias: "first" },
      boundAt: "2026-05-02T10:00:00.000Z",
      lastSeenAt: "2026-05-02T10:00:00.000Z",
    });
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: secondRoute.sessionKey,
      sessionId: secondRoute.sessionId,
      sessionLabel: secondRoute.sessionLabel,
      metadata: { alias: "second" },
      boundAt: "2026-05-02T11:00:00.000Z",
      lastSeenAt: "2026-05-02T11:00:00.000Z",
    });
    await store.setActiveChannelSelection("discord", "dm1", "u1", firstRoute.sessionKey);

    await firstOps.handler?.(discordMessage("relay to second targeted prompt"));
    await secondOps.handler?.(discordMessage("relay to second targeted prompt"));

    expect(firstSend).not.toHaveBeenCalled();
    expect(firstOps.messages).toHaveLength(0);
    expect(secondSend).toHaveBeenCalledOnce();
    expect(secondSend).toHaveBeenCalledWith("targeted prompt", undefined);
    expect(secondOps.messages.at(-1)?.content).toContain("Prompt delivered to Pi.");
    expect(await store.getActiveChannelSelection("discord", "dm1", "u1")).toMatchObject({ sessionKey: firstRoute.sessionKey });
  });

  it("persists Discord /use selection so a restarted runtime honors it", async () => {
    const cfg = await config();
    const firstOps = new FakeDiscordOperations();
    const firstRuntime = new DiscordRuntime(cfg, { operations: firstOps });
    const { route: firstRoute } = route();
    const { route: secondRoute } = route();
    secondRoute.sessionKey = "second-session:memory";
    secondRoute.sessionId = "second-session";
    secondRoute.sessionLabel = "Second";
    await firstRuntime.registerRoute(firstRoute);
    await firstRuntime.registerRoute(secondRoute);
    await firstRuntime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "dm1", userId: "u1", sessionKey: firstRoute.sessionKey, sessionId: firstRoute.sessionId, sessionLabel: firstRoute.sessionLabel, metadata: { alias: "first" }, boundAt: "2026-05-02T10:00:00.000Z", lastSeenAt: "2026-05-02T10:00:00.000Z" });
    await store.upsertChannelBinding({ channel: "discord", conversationId: "dm1", userId: "u1", sessionKey: secondRoute.sessionKey, sessionId: secondRoute.sessionId, sessionLabel: secondRoute.sessionLabel, metadata: { alias: "second" }, boundAt: "2026-05-02T11:00:00.000Z", lastSeenAt: "2026-05-02T11:00:00.000Z" });

    await firstOps.handler?.(discordMessage("relay use first"));
    expect(await store.getActiveChannelSelection("discord", "dm1", "u1")).toMatchObject({ sessionKey: firstRoute.sessionKey });

    const restartedOps = new FakeDiscordOperations();
    const restartedRuntime = new DiscordRuntime(cfg, { operations: restartedOps });
    const { route: restoredFirstRoute, sendUserMessage } = route();
    await restartedRuntime.registerRoute(restoredFirstRoute);
    await restartedRuntime.start();

    await restartedOps.handler?.(discordMessage("after restart"));

    expect(sendUserMessage).toHaveBeenCalledOnce();
    expect(sendUserMessage).toHaveBeenCalledWith("after restart", undefined);
  });

  it("keeps shared-room active selections independent across messenger conversations", async () => {
    const laptopCfg = await config({ allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    laptopCfg.machineId = "laptop";
    laptopCfg.machineDisplayName = "Laptop";
    laptopCfg.machineAliases = ["lap"];
    const laptopOps = new FakeDiscordOperations();
    const laptopRuntime = new DiscordRuntime(laptopCfg, { operations: laptopOps });
    const { route: laptopRoute, sendUserMessage: laptopSend } = route();
    await laptopRuntime.registerRoute(laptopRoute);
    await laptopRuntime.start();
    const store = new TunnelStateStore(laptopCfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room-discord", userId: "u1", sessionKey: laptopRoute.sessionKey, sessionId: laptopRoute.sessionId, sessionLabel: laptopRoute.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room-telegram", userId: "u1", sessionKey: laptopRoute.sessionKey, sessionId: laptopRoute.sessionId, sessionLabel: laptopRoute.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });

    await laptopOps.handler?.(discordMessage("relay use lap docs", { channelId: "room-discord", guildId: "g1" }));
    await store.setActiveChannelSelection("discord", "room-telegram", "u1", "remote:desktop:api", { machineId: "desktop", machineDisplayName: "desktop" });
    await laptopOps.handler?.(discordMessage("go from discord room", { channelId: "room-discord", guildId: "g1" }));
    await laptopOps.handler?.(discordMessage("telegram room should be remote", { channelId: "room-telegram", guildId: "g1" }));

    expect(laptopSend).toHaveBeenCalledOnce();
    expect(laptopSend).toHaveBeenCalledWith("go from discord room", undefined);
    expect(await store.getActiveChannelSelection("discord", "room-discord", "u1")).toMatchObject({ machineId: "laptop", sessionKey: laptopRoute.sessionKey });
    expect(await store.getActiveChannelSelection("discord", "room-telegram", "u1")).toMatchObject({ machineId: "desktop" });
  });

  it("keeps non-target shared-room machine brokers silent", async () => {
    const cfg = await config({ allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    cfg.machineId = "laptop";
    cfg.machineAliases = ["lap"];
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: session.sessionKey, sessionId: session.sessionId, sessionLabel: session.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });

    await ops.handler?.(discordMessage("unselected plain text", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("relay use desktop api", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("remote active plain text", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("relay to desktop api run tests", { channelId: "room1", guildId: "g1" }));

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(ops.messages).toHaveLength(0);
    expect(await store.getActiveChannelSelection("discord", "room1", "u1")).toMatchObject({ machineId: "desktop" });
  });

  it("does not treat arbitrary Discord user mentions as remote bot targeting", async () => {
    const cfg = await config({ applicationId: "123", allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    cfg.machineId = "laptop";
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: session.sessionKey, sessionId: session.sessionId, sessionLabel: session.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    await store.setActiveChannelSelection("discord", "room1", "u1", session.sessionKey, { machineId: "laptop" });

    await ops.handler?.(discordMessage("ask <@456> about docs", { channelId: "room1", guildId: "g1" }));

    expect(sendUserMessage).toHaveBeenCalledOnce();
    expect(sendUserMessage).toHaveBeenCalledWith("ask <@456> about docs", undefined);
  });

  it("keeps legacy shared-room use/to commands silent unless this bot is mentioned", async () => {
    const cfg = await config({ applicationId: "123", allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    cfg.machineId = "laptop";
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: session.sessionKey, sessionId: session.sessionId, sessionLabel: session.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });

    await ops.handler?.(discordMessage("relay use docs", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("relay to docs run tests", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("<@123> relay use docs", { channelId: "room1", guildId: "g1" }));

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(ops.messages.length).toBeGreaterThan(0);
    expect(await store.getActiveChannelSelection("discord", "room1", "u1")).toMatchObject({ sessionKey: session.sessionKey, machineId: "laptop" });
  });

  it("routes shared-room prompts addressed by Discord bot mention", async () => {
    const cfg = await config({ applicationId: "123", allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    cfg.machineId = "laptop";
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: session.sessionKey, sessionId: session.sessionId, sessionLabel: session.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });

    await ops.handler?.(discordMessage("<@456> remote should stay silent", { channelId: "room1", guildId: "g1", mentions: [{ id: "456", bot: true }] }));
    await ops.handler?.(discordMessage("<@123> local should route", { channelId: "room1", guildId: "g1", mentions: [{ id: "123", bot: true }] }));
    await ops.handler?.(discordMessage("<@123> and <@456> ambiguous", { channelId: "room1", guildId: "g1", mentions: [{ id: "123", bot: true }, { id: "456", bot: true }] }));

    expect(sendUserMessage).toHaveBeenCalledOnce();
    expect(sendUserMessage).toHaveBeenCalledWith("<@123> local should route", undefined);
    expect(ops.messages.some((message) => message.content.includes("could not determine"))).toBe(true);
  });

  it("routes shared-room prompts only to explicitly selected local machine bot", async () => {
    const cfg = await config({ allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    cfg.machineId = "laptop";
    cfg.machineAliases = ["lap"];
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: session.sessionKey, sessionId: session.sessionId, sessionLabel: session.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });

    await ops.handler?.(discordMessage("relay use lap docs", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("plain prompt", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("relay to lap docs targeted prompt", { channelId: "room1", guildId: "g1" }));

    expect(sendUserMessage).toHaveBeenCalledTimes(2);
    expect(sendUserMessage).toHaveBeenNthCalledWith(1, "plain prompt", undefined);
    expect(sendUserMessage).toHaveBeenNthCalledWith(2, "targeted prompt", undefined);
    expect(ops.messages.some((message) => message.content.includes("Prompt delivered to Pi."))).toBe(true);
  });

  it("coordinates two independent shared-room machine brokers through visible Discord commands", async () => {
    const laptopCfg = await config({ allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    laptopCfg.machineId = "laptop";
    laptopCfg.machineDisplayName = "Laptop";
    laptopCfg.machineAliases = ["lap"];
    const desktopCfg = await config({ allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    desktopCfg.machineId = "desktop";
    desktopCfg.machineDisplayName = "Desktop";
    desktopCfg.machineAliases = ["desk"];
    const laptopOps = new FakeDiscordOperations();
    const desktopOps = new FakeDiscordOperations();
    const laptopRuntime = new DiscordRuntime(laptopCfg, { operations: laptopOps });
    const desktopRuntime = new DiscordRuntime(desktopCfg, { operations: desktopOps });
    const { route: laptopRoute, sendUserMessage: laptopSend } = route();
    const { route: desktopRoute, sendUserMessage: desktopSend } = route();
    desktopRoute.sessionKey = "desktop-session:memory";
    desktopRoute.sessionId = "desktop-session";
    desktopRoute.sessionLabel = "API";
    await laptopRuntime.registerRoute(laptopRoute);
    await desktopRuntime.registerRoute(desktopRoute);
    await laptopRuntime.start();
    await desktopRuntime.start();
    const now = new Date().toISOString();
    await new TunnelStateStore(laptopCfg.stateDir).upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: laptopRoute.sessionKey, sessionId: laptopRoute.sessionId, sessionLabel: laptopRoute.sessionLabel, metadata: { alias: "docs" }, boundAt: now, lastSeenAt: now });
    await new TunnelStateStore(desktopCfg.stateDir).upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: desktopRoute.sessionKey, sessionId: desktopRoute.sessionId, sessionLabel: desktopRoute.sessionLabel, metadata: { alias: "api" }, boundAt: now, lastSeenAt: now });

    const selectLaptop = discordMessage("relay use lap docs", { channelId: "room1", guildId: "g1" });
    await laptopOps.handler?.(selectLaptop);
    await desktopOps.handler?.(selectLaptop);
    const laptopPrompt = discordMessage("run docs tests", { channelId: "room1", guildId: "g1" });
    await laptopOps.handler?.(laptopPrompt);
    await desktopOps.handler?.(laptopPrompt);
    const desktopOneShot = discordMessage("relay to desk api deploy preview", { channelId: "room1", guildId: "g1" });
    await laptopOps.handler?.(desktopOneShot);
    await desktopOps.handler?.(desktopOneShot);

    expect(laptopSend).toHaveBeenCalledOnce();
    expect(laptopSend).toHaveBeenCalledWith("run docs tests", undefined);
    expect(desktopSend).toHaveBeenCalledOnce();
    expect(desktopSend).toHaveBeenCalledWith("deploy preview", undefined);
    expect(laptopOps.messages.filter((message) => message.content.includes("Prompt delivered to Pi."))).toHaveLength(1);
    expect(desktopOps.messages.filter((message) => message.content.includes("Prompt delivered to Pi."))).toHaveLength(1);
  });

  it("reports shared-room sessions only for the addressed local machine", async () => {
    const cfg = await config({ allowGuildChannels: true, allowGuildIds: ["g1"], sharedRoom: { enabled: true } });
    cfg.machineId = "laptop";
    cfg.machineDisplayName = "Laptop";
    cfg.machineAliases = ["lap"];
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({ channel: "discord", conversationId: "room1", userId: "u1", sessionKey: session.sessionKey, sessionId: session.sessionId, sessionLabel: session.sessionLabel, metadata: { alias: "docs" }, boundAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });

    await ops.handler?.(discordMessage("relay sessions", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("relay sessions desktop", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("relay sessions lap", { channelId: "room1", guildId: "g1" }));
    await ops.handler?.(discordMessage("relay sessions all", { channelId: "room1", guildId: "g1" }));

    expect(ops.messages).toHaveLength(2);
    expect(ops.messages[0]?.content).toContain("Machine: Laptop (laptop)");
    expect(ops.messages[0]?.content).toContain("Aliases: lap");
    expect(ops.messages[0]?.content).toContain("Pi sessions");
    expect(ops.messages[1]?.content).toContain("Machine: Laptop (laptop)");
  });

  it("routes authorized Discord prompts and busy delivery", async () => {
    const cfg = await config({ maxFileBytes: 1 });
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: busyRoute, sendUserMessage } = route({ idle: false });
    await runtime.registerRoute(busyRoute);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: busyRoute.sessionKey,
      sessionId: busyRoute.sessionId,
      sessionLabel: busyRoute.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("run tests"));
    await ops.handler?.(discordMessage("file", { attachments: [{ id: "a1", filename: "huge.png", content_type: "image/png", size: 2 }] }));

    expect(ops.typing).toEqual(["dm1"]);
    expect(sendUserMessage).toHaveBeenCalledWith("run tests", { deliverAs: "followUp" });
    expect(ops.messages.some((message) => message.content.includes("queued as followUp"))).toBe(true);
    expect(ops.messages.at(-1)?.content).toContain("File is too large");
  });

  it("routes Discord prompts to the online route when stale bindings exist for the same DM", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const stale = route().route;
    stale.sessionKey = "stale-session:memory";
    stale.sessionId = "stale-session";
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: stale.sessionKey,
      sessionId: stale.sessionId,
      sessionLabel: "Stale",
      boundAt: "2026-05-02T10:00:00.000Z",
      lastSeenAt: "2026-05-02T10:00:00.000Z",
    });
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: "2026-05-02T11:00:00.000Z",
      lastSeenAt: "2026-05-02T11:00:00.000Z",
    });

    await ops.handler?.(discordMessage("hello online route"));

    expect(sendUserMessage).toHaveBeenCalledWith("hello online route", undefined);
    expect(ops.messages.at(-1)?.content).toContain("Prompt delivered to Pi.");
  });

  it("recovers authorized Discord prompts when a DM conversation id changes", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "old-dm",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("hello from moved dm", { channelId: "new-dm" }));

    expect(sendUserMessage).toHaveBeenCalledWith("hello from moved dm", undefined);
    expect(await store.getChannelBinding("discord", "new-dm", "u1")).toMatchObject({ sessionKey: session.sessionKey });
  });

  it("refreshes Discord typing while a turn is running and stops on terminal state", async () => {
    vi.useFakeTimers();
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("hello while typing"));
    expect(sendUserMessage).toHaveBeenCalledWith("hello while typing", undefined);
    expect(ops.typing).toEqual(["dm1"]);

    session.notification.lastStatus = "running";
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.waitFor(() => expect(ops.typing).toEqual(["dm1", "dm1"]));

    session.notification.lastAssistantText = "done";
    await runtime.notifyTurnCompleted(session, "completed");
    await vi.advanceTimersByTimeAsync(14_000);
    expect(ops.typing).toEqual(["dm1", "dm1"]);
  });

  it("stops Discord typing refresh when the active binding moves conversations", async () => {
    vi.useFakeTimers();
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session } = route();
    session.notification.lastStatus = "running";
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("relay followup keep typing"));
    expect(ops.typing).toEqual(["dm1"]);

    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm2",
      userId: "u2",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(14_000);

    expect(ops.typing).toEqual(["dm1"]);
  });

  it("stops Discord typing refresh on pause, disconnect, route unregister, and runtime stop", async () => {
    vi.useFakeTimers();
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session } = route();
    session.notification.lastStatus = "running";
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("relay followup keep typing"));
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.waitFor(() => expect(ops.typing).toEqual(["dm1", "dm1"]));

    await ops.handler?.(discordMessage("relay pause"));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(ops.typing).toEqual(["dm1", "dm1"]);

    await ops.handler?.(discordMessage("relay resume"));
    await ops.handler?.(discordMessage("relay followup after resume"));
    await ops.handler?.(discordMessage("relay disconnect"));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(ops.typing).toEqual(["dm1", "dm1", "dm1"]);

    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    await ops.handler?.(discordMessage("relay followup before unregister"));
    await runtime.unregisterRoute(session.sessionKey);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(ops.typing).toEqual(["dm1", "dm1", "dm1", "dm1"]);

    await runtime.registerRoute(session);
    await runtime.start();
    await ops.handler?.(discordMessage("relay followup before stop"));
    await runtime.stop();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(ops.typing).toEqual(["dm1", "dm1", "dm1", "dm1", "dm1"]);
  });

  it("routes Discord prompts even when typing activity fails", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations(undefined, new Error("typing unavailable"));
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("hello despite typing"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendUserMessage).toHaveBeenCalledWith("hello despite typing", undefined);
    expect(ops.messages.at(-1)?.content).toContain("Prompt delivered to Pi.");
    expect(runtime.getStatus().error).toBe("typing unavailable");
  });

  it("reports unavailable Discord prompt delivery without marking runtime unhealthy", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    sendUserMessage.mockImplementation(() => {
      throw new Error("The Pi session is unavailable. Resume it locally, then try again.");
    });
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("hello"));

    expect(ops.messages.at(-1)?.content).toContain("The Pi session is unavailable");
    expect(runtime.getStatus().error).toBeUndefined();
  });

  it("reports Discord prompt delivery failures to the chat", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    sendUserMessage.mockImplementation(() => {
      throw new Error("Pi route unavailable discord-token-supersecret");
    });
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("hello"));

    expect(ops.messages.at(-1)?.content).toContain("Could not deliver the Discord prompt to Pi");
    expect(ops.messages.at(-1)?.content).toContain("[redacted]");
    expect(ops.messages.at(-1)?.content).not.toContain("discord-token-supersecret");
  });

  it("sends Discord completion notifications for paired routes", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    session.notification.lastAssistantText = "The answer is ready. Here are the results.";

    await runtime.notifyTurnCompleted(session, "completed");

    expect(ops.messages.at(-1)).toMatchObject({ channelId: "dm1", content: expect.stringContaining("The answer is ready") });
  });

  it("suppresses Discord completion fan-out after persisted revocation", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("hello from discord"));
    await store.revokeChannelBinding("discord", session.sessionKey);
    session.notification.lastAssistantText = "Completion after Discord prompt.";

    await runtime.notifyTurnCompleted(session, "completed");

    expect(ops.messages.some((message) => message.content.includes("Prompt delivered to Pi."))).toBe(true);
    expect(ops.messages.some((message) => message.content.includes("Completion after Discord prompt"))).toBe(false);
  });

  it("does not keep accepting a recently active Discord chat after persisted revocation", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, sendUserMessage } = route();
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("first discord prompt"));
    await store.revokeChannelBinding("discord", session.sessionKey);
    await ops.handler?.(discordMessage("second discord prompt"));

    expect(sendUserMessage.mock.calls.map(([content]) => content)).toEqual(["first discord prompt"]);
    expect(ops.messages.at(-1)?.content).toContain("not paired");
  });

  it("supports canonical Discord commands without falling through to generic unsupported help", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const root = await mkdtemp(join(tmpdir(), "pirelay-discord-remote-file-"));
    tempDirs.push(root);
    await writeFile(join(root, "report.md"), "# Report\n");
    const { route: session, sendUserMessage } = route();
    (session.actions.context as { cwd: string }).cwd = root;
    session.sessionKey = "session-id:/Users/example/.pi/agent/sessions/raw.jsonl";
    session.sessionFile = "/Users/example/.pi/agent/sessions/raw.jsonl";
    session.notification.lastAssistantText = "Full assistant output from Pi.";
    session.notification.lastSummary = "Short Pi summary.";
    session.notification.recentActivity = [{ id: "p1", kind: "tool", text: "Ran tests", at: Date.now() }];
    session.notification.latestImages = { turnId: "turn-1", count: 1, skipped: 0, contentCount: 1 };
    session.actions.getLatestImages = async () => [{ id: "img1", turnId: "turn-1", fileName: "render.png", mimeType: "image/png", data: Buffer.from([1, 2, 3]).toString("base64"), byteSize: 3 }];
    session.actions.getImageByPath = async (path) => path === "outputs/render.png"
      ? { ok: true, image: { id: "img2", turnId: "turn-2", fileName: "render-path.png", mimeType: "image/png", data: Buffer.from([4, 5, 6]).toString("base64"), byteSize: 3 } }
      : { ok: false, error: "Image file not found." };
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      identity: { displayName: "zikolach" },
    });

    for (const command of ["relay help", "relay status", "relay sessions", "relay full", "relay summary", "relay recent", "relay progress", "relay alias phone", "relay progress verbose", "relay images", "relay send-image outputs/render.png", "relay send-file report.md Report", "relay steer go", "relay followup next", "relay to phone one shot", "relay use phone", "relay forget missing", "relay abort", "relay compact", "relay pause", "relay resume", "relay disconnect"] as const) {
      await ops.handler?.(discordMessage(command));
    }

    const text = ops.messages.map((message) => message.content).join("\n");
    expect(text).toContain("PiRelay Discord commands:");
    expect(text).toContain("relay status - session and relay dashboard");
    expect(text).toContain("Session: Docs");
    expect(text).toContain("Online: yes");
    expect(text).toContain("Progress mode: normal");
    expect(text).toContain("Pi sessions");
    expect(text).toContain("Full assistant output from Pi.");
    expect(text).toContain("Short Pi summary.");
    expect(text).toContain("Recent Pi activity");
    expect(text).toContain("Progress notifications set to verbose.");
    expect(text).toContain("Session alias set to phone.");
    expect(text).toContain("prefer \\`relay <command>\\` in Discord DMs");
    expect(text).not.toContain("Supported Discord commands: /status, /abort, /disconnect");
    expect(text).not.toContain("/Users/example/.pi/agent/sessions/raw.jsonl");
    expect(sendUserMessage).toHaveBeenCalledWith("go", undefined);
    expect(sendUserMessage).toHaveBeenCalledWith("next", undefined);
    expect(sendUserMessage).toHaveBeenCalledWith("one shot", undefined);
    expect(ops.files.map((file) => file.fileName)).toEqual(["render.png", "render-path.png", "report.md"]);
    expect(ops.files.at(-1)).toMatchObject({ caption: "Report", mimeType: "text/markdown" });
  });

  it("reports Discord compact becoming unavailable after the idle check", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const session = route().route;
    session.actions.compact = vi.fn(async () => { throw new Error("The Pi session is unavailable. Resume it locally, then try again."); });
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("relay compact"));

    expect(ops.messages.at(-1)?.content).toContain("The Pi session is unavailable");
  });

  it("marks unavailable Discord routes offline in session lists", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const first = route().route;
    first.actions.isIdle = () => undefined;
    await runtime.registerRoute(first);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: first.sessionKey,
      sessionId: first.sessionId,
      sessionLabel: first.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("relay sessions"));

    expect(ops.messages.at(-1)?.content).toContain("offline");
    expect(ops.messages.at(-1)?.content).not.toContain("busy");
  });

  it("renders Discord session lists through the same formatter as Telegram, including color markers", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const first = route().route;
    first.sessionKey = "session-a:/tmp/a.jsonl";
    first.sessionId = "session-a";
    first.sessionLabel = "pirelay";
    first.lastActivityAt = Date.UTC(2026, 4, 3, 9, 56, 32);
    await runtime.registerRoute(first);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: first.sessionKey,
      sessionId: first.sessionId,
      sessionLabel: first.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date(first.lastActivityAt).toISOString(),
    });
    await store.setActiveChannelSelection("discord", "dm1", "u1", first.sessionKey);

    await ops.handler?.(discordMessage("relay sessions"));

    const expected = formatSessionList([{
      sessionKey: first.sessionKey,
      sessionId: first.sessionId,
      sessionFile: first.sessionFile,
      sessionLabel: first.sessionLabel,
      online: true,
      busy: false,
      paused: false,
      lastActivityAt: first.lastActivityAt,
    }], first.sessionKey);
    expect(ops.messages.at(-1)?.content).toBe(expected);
    expect(ops.messages.at(-1)?.content).toMatch(/[🔵🟢🟠🟣🟡🔴⚪⚫]/u);
    expect(ops.messages.at(-1)?.content).toContain("— active");
  });

  it("handles status, abort, disconnect, bot ignores, and interactions", async () => {
    const cfg = await config();
    const ops = new FakeDiscordOperations();
    const runtime = new DiscordRuntime(cfg, { operations: ops });
    const { route: session, abort } = route({ idle: false });
    await runtime.registerRoute(session);
    await runtime.start();
    const store = new TunnelStateStore(cfg.stateDir);
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm1",
      userId: "u1",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await ops.handler?.(discordMessage("/status"));
    await ops.handler?.(discordMessage("/abort"));
    await ops.handler?.({ type: "interaction", payload: { id: "i1", token: "t1", channel_id: "dm1", user: { id: "u1" }, data: { custom_id: "x" } } });
    await ops.handler?.({ type: "interaction", payload: { id: "i2", token: "t2", channel_id: "dm1", user: { id: "u2" }, data: { custom_id: "x" } } });
    await store.upsertChannelBinding({
      channel: "discord",
      conversationId: "dm2",
      userId: "u1",
      sessionKey: "missing-session",
      sessionId: "missing-session",
      sessionLabel: "Missing",
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    await ops.handler?.({ type: "interaction", payload: { id: "i3", token: "t3", channel_id: "dm2", user: { id: "u1" }, data: { custom_id: "x" } } });
    await ops.handler?.(discordMessage("ignored", { bot: true }));
    await ops.handler?.(discordMessage("/disconnect"));

    expect(ops.messages.some((message) => message.content.includes("Session: Docs"))).toBe(true);
    expect(abort).toHaveBeenCalled();
    expect(ops.answers).toContainEqual({ interactionId: "i1", text: "Action received.", alert: undefined });
    expect(ops.answers).toContainEqual({ interactionId: "i2", text: "This Discord action is not authorized.", alert: true });
    expect(ops.answers).toContainEqual({ interactionId: "i3", text: "This Discord action is no longer current.", alert: true });
    expect(await store.getChannelBinding("discord", "dm1", "u1")).toBeUndefined();
    expect(ops.messages.at(-1)?.content).toContain("disconnected");
  });
});
