import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DiscordApiOperations, DiscordGatewayEvent, DiscordSendMessagePayload } from "../../extensions/relay/adapters/discord/adapter.js";
import { DiscordRuntime } from "../../extensions/relay/adapters/discord/runtime.js";
import type { SlackApiOperations, SlackEnvelope, SlackPostMessagePayload } from "../../extensions/relay/adapters/slack/adapter.js";
import { SlackRuntime } from "../../extensions/relay/adapters/slack/runtime.js";
import { formatDiscordSkillList, formatSlackSkillList } from "../../extensions/relay/adapters/skill-list-formatting.js";
import { routeUnavailableError } from "../../extensions/relay/core/route-actions.js";
import type { RemoteSkillSummary, SkillCommandMetadata } from "../../extensions/relay/core/skill-invocation.js";
import type { SessionRoute, TelegramTunnelConfig } from "../../extensions/relay/core/types.js";
import { TunnelStateStore } from "../../extensions/relay/state/tunnel-store.js";

const skills: RemoteSkillSummary[] = [
  { name: "github", description: "Use GitHub safely", source: "user", requiresConfirmation: false },
];

const skillCommands: SkillCommandMetadata[] = [
  { name: "github", description: "Use GitHub safely", sourceInfo: { scope: "user" } },
];
const STALE_EXTENSION_ERROR = "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().";

function configWithSkills(stateDir: string): TelegramTunnelConfig {
  return {
    botToken: "",
    stateDir,
    pairingExpiryMs: 60_000,
    busyDeliveryMode: "followUp",
    allowUserIds: [],
    summaryMode: "deterministic",
    maxTelegramMessageChars: 4096,
    sendRetryCount: 0,
    sendRetryBaseMs: 1,
    pollingTimeoutSeconds: 1,
    redactionPatterns: [],
    maxInboundImageBytes: 1_000_000,
    maxOutboundImageBytes: 1_000_000,
    maxLatestImages: 5,
    allowedImageMimeTypes: ["image/png"],
    skills: { enabled: true, allow: ["github"] },
  };
}

function route(idle = true): SessionRoute {
  return {
    sessionKey: "session:/tmp/session.jsonl",
    sessionId: "session",
    sessionLabel: "session",
    notification: {},
    actions: {
      context: {} as never,
      isIdle: () => idle,
      getModel: () => undefined,
      sendUserMessage: vi.fn(),
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "missing" }),
      getSkillCommands: () => skillCommands,
      appendAudit: () => undefined,
      persistBinding: () => undefined,
      promptLocalConfirmation: async () => true,
      abort: () => undefined,
      compact: async () => undefined,
    },
  } as SessionRoute;
}

async function setupBusyDiscordSkillRuntime(busyDeliveryMode: "followUp" | "steer" = "steer") {
  const stateDir = await mkdtemp(join(tmpdir(), "pirelay-discord-busy-skills-"));
  const session = route(false);
  await new TunnelStateStore(stateDir).upsertChannelBinding({
    channel: "discord",
    conversationId: "discord-conversation",
    userId: "discord-user",
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
    sessionLabel: session.sessionLabel,
    boundAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
  const sent: string[] = [];
  let handler: ((event: DiscordGatewayEvent) => Promise<void>) | undefined;
  const operations: DiscordApiOperations = {
    connect: async (nextHandler) => { handler = nextHandler; },
    sendMessage: async (payload: DiscordSendMessagePayload) => { sent.push(payload.content); },
    sendFile: async () => undefined,
    sendTyping: async () => undefined,
    answerInteraction: async () => undefined,
  };
  const runtime = new DiscordRuntime({ ...configWithSkills(stateDir), busyDeliveryMode, discord: { enabled: true, botToken: "discord-token", allowUserIds: ["discord-user"] } }, { operations });
  await runtime.registerRoute(session);
  await runtime.start();
  if (!handler) throw new Error("Discord handler was not registered");
  return { session, sent, runtime, handler };
}

async function setupBusySlackSkillRuntime(busyDeliveryMode: "followUp" | "steer" = "steer") {
  const stateDir = await mkdtemp(join(tmpdir(), "pirelay-slack-busy-skills-"));
  const session = route(false);
  await new TunnelStateStore(stateDir).upsertChannelBinding({
    channel: "slack",
    conversationId: "slack-conversation",
    userId: "slack-user",
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
    sessionLabel: session.sessionLabel,
    boundAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
  const sent: string[] = [];
  let handler: ((event: SlackEnvelope) => Promise<void>) | undefined;
  const operations: SlackApiOperations = {
    startSocketMode: async (nextHandler) => { handler = nextHandler; },
    postMessage: async (payload: SlackPostMessagePayload) => { sent.push(payload.text); },
    uploadFile: async () => undefined,
    postEphemeral: async (payload) => { sent.push(payload.text); },
  };
  const runtime = new SlackRuntime({ ...configWithSkills(stateDir), busyDeliveryMode, slack: { enabled: true, botToken: "xoxb-token", allowUserIds: ["slack-user"], botUserId: "slack-bot" } }, { operations });
  await runtime.registerRoute(session);
  await runtime.start();
  if (!handler) throw new Error("Slack handler was not registered");
  return { session, sent, runtime, handler };
}

describe("adapter skill list formatting", () => {
  it("formats Discord skill lists with relay-prefixed guidance", () => {
    const message = formatDiscordSkillList(skills);
    expect(message).toContain("Use relay skill <name> <input>, or relay skill <name> to send input as your next message.");
    expect(message).toContain("Use relay skills to list available skills.");
    expect(message).not.toContain("/skill");
  });

  it("formats Slack skill lists with relay-prefixed guidance", () => {
    const message = formatSlackSkillList(skills);
    expect(message).toContain("Use relay skill <name> <input>, or relay skill <name> to send input as your next message.");
    expect(message).toContain("Use relay skills to list available skills.");
    expect(message).not.toContain("/skill");
  });

  it("sends Discord runtime skill lists with relay-prefixed guidance through public inbound handling", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-discord-skill-list-"));
    const session = route();
    await new TunnelStateStore(stateDir).upsertChannelBinding({
      channel: "discord",
      conversationId: "discord-conversation",
      userId: "discord-user",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const sent: string[] = [];
    let handler: ((event: DiscordGatewayEvent) => Promise<void>) | undefined;
    const operations: DiscordApiOperations = {
      connect: async (nextHandler) => { handler = nextHandler; },
      sendMessage: async (payload: DiscordSendMessagePayload) => { sent.push(payload.content); },
      sendFile: async () => undefined,
      sendTyping: async () => undefined,
      answerInteraction: async () => undefined,
    };
    const runtime = new DiscordRuntime({ ...configWithSkills(stateDir), discord: { enabled: true, botToken: "discord-token", allowUserIds: ["discord-user"] } }, { operations });

    await runtime.registerRoute(session);
    await runtime.start();
    if (!handler) throw new Error("Discord handler was not registered");
    await handler({ type: "message", payload: { id: "discord-message", channel_id: "discord-conversation", author: { id: "discord-user" }, content: "relay skills" } });
    await runtime.stop();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Use relay skill <name> <input>, or relay skill <name> to send input as your next message.");
    expect(sent[0]).toContain("Use relay skills to list available skills.");
    expect(sent[0]).not.toContain("/skill");
  });

  it("does not fetch Discord skill metadata while remote skills are disabled", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-discord-disabled-skills-"));
    const session = route();
    session.actions.getSkillCommands = vi.fn(() => { throw new Error("should not fetch skill metadata while disabled"); });
    await new TunnelStateStore(stateDir).upsertChannelBinding({
      channel: "discord",
      conversationId: "discord-conversation",
      userId: "discord-user",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const sent: string[] = [];
    let handler: ((event: DiscordGatewayEvent) => Promise<void>) | undefined;
    const operations: DiscordApiOperations = {
      connect: async (nextHandler) => { handler = nextHandler; },
      sendMessage: async (payload: DiscordSendMessagePayload) => { sent.push(payload.content); },
      sendFile: async () => undefined,
      sendTyping: async () => undefined,
      answerInteraction: async () => undefined,
    };
    const runtime = new DiscordRuntime({ ...configWithSkills(stateDir), skills: { enabled: false }, discord: { enabled: true, botToken: "discord-token", allowUserIds: ["discord-user"] } }, { operations });

    await runtime.registerRoute(session);
    await runtime.start();
    if (!handler) throw new Error("Discord handler was not registered");
    await handler({ type: "message", payload: { id: "discord-disabled-skills", channel_id: "discord-conversation", author: { id: "discord-user" }, content: "relay skills" } });
    await handler({ type: "message", payload: { id: "discord-disabled-skill", channel_id: "discord-conversation", author: { id: "discord-user" }, content: "relay skill github inspect repo" } });
    await runtime.stop();

    expect(sent).toEqual(["Remote skill invocation is disabled.", "Remote skill invocation is disabled."]);
    expect(session.actions.getSkillCommands).not.toHaveBeenCalled();
    expect(session.actions.sendUserMessage).not.toHaveBeenCalled();
  });

  it("answers Discord stale skill metadata flows with no available skills", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-discord-stale-skills-"));
    const session = route();
    session.actions.getSkillCommands = vi.fn(() => { throw new Error(STALE_EXTENSION_ERROR); });
    await new TunnelStateStore(stateDir).upsertChannelBinding({
      channel: "discord",
      conversationId: "discord-conversation",
      userId: "discord-user",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const sent: string[] = [];
    let handler: ((event: DiscordGatewayEvent) => Promise<void>) | undefined;
    const operations: DiscordApiOperations = {
      connect: async (nextHandler) => { handler = nextHandler; },
      sendMessage: async (payload: DiscordSendMessagePayload) => { sent.push(payload.content); },
      sendFile: async () => undefined,
      sendTyping: async () => undefined,
      answerInteraction: async () => undefined,
    };
    const runtime = new DiscordRuntime({ ...configWithSkills(stateDir), discord: { enabled: true, botToken: "discord-token", allowUserIds: ["discord-user"] } }, { operations });

    await runtime.registerRoute(session);
    await runtime.start();
    if (!handler) throw new Error("Discord handler was not registered");
    await handler({ type: "message", payload: { id: "discord-message", channel_id: "discord-conversation", author: { id: "discord-user" }, content: "relay skills" } });
    await runtime.stop();

    expect(sent).toEqual(["No remote-invokable skills are available for this session."]);
    expect(session.actions.getSkillCommands).toHaveBeenCalledOnce();
    expect(session.actions.sendUserMessage).not.toHaveBeenCalled();
  });

  it("queues busy Discord direct skill invocations with the configured steer mode", async () => {
    const { session, sent, runtime, handler } = await setupBusyDiscordSkillRuntime("steer");
    await handler({ type: "message", payload: { id: "discord-direct-skill", channel_id: "discord-conversation", author: { id: "discord-user" }, content: "relay skill github inspect repo" } });
    await runtime.stop();

    expect(session.actions.sendUserMessage).toHaveBeenCalledWith("Use the local Pi skill /skill:github with this input:\n\ninspect repo", { deliverAs: "steer" });
    expect(sent).toEqual(["Skill \\`github\\` invocation accepted (steer)."]);
  });

  it("queues busy Discord pending skill input with the configured steer mode", async () => {
    const { session, sent, runtime, handler } = await setupBusyDiscordSkillRuntime("steer");
    await handler({ type: "message", payload: { id: "discord-pending-skill", channel_id: "discord-conversation", author: { id: "discord-user" }, content: "relay skill github" } });
    await handler({ type: "message", payload: { id: "discord-pending-input", channel_id: "discord-conversation", author: { id: "discord-user" }, content: "inspect later" } });
    await runtime.stop();

    expect(session.actions.sendUserMessage).toHaveBeenCalledWith("Use the local Pi skill /skill:github with this input:\n\ninspect later", { deliverAs: "steer" });
    expect(sent).toEqual([
      "Send input for skill github as your next message, or send relay skill cancel.",
      "Skill \\`github\\` invocation accepted (steer).",
    ]);
  });

  it("sends Slack runtime skill lists with relay-prefixed guidance through public inbound handling", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-slack-skill-list-"));
    const session = route();
    await new TunnelStateStore(stateDir).upsertChannelBinding({
      channel: "slack",
      conversationId: "slack-conversation",
      userId: "slack-user",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const sent: string[] = [];
    let handler: ((event: SlackEnvelope) => Promise<void>) | undefined;
    const operations: SlackApiOperations = {
      startSocketMode: async (nextHandler) => { handler = nextHandler; },
      postMessage: async (payload: SlackPostMessagePayload) => { sent.push(payload.text); },
      uploadFile: async () => undefined,
      postEphemeral: async (payload) => { sent.push(payload.text); },
    };
    const runtime = new SlackRuntime({ ...configWithSkills(stateDir), slack: { enabled: true, botToken: "xoxb-token", allowUserIds: ["slack-user"], botUserId: "slack-bot" } }, { operations });

    await runtime.registerRoute(session);
    await runtime.start();
    if (!handler) throw new Error("Slack handler was not registered");
    await handler({ type: "event_callback", eventId: "slack-event", event: { type: "message", channel_type: "im", channel: "slack-conversation", user: "slack-user", text: "relay skills", ts: "1", team: "T1" } });
    await runtime.stop();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Use relay skill <name> <input>, or relay skill <name> to send input as your next message.");
    expect(sent[0]).toContain("Use relay skills to list available skills.");
    expect(sent[0]).not.toContain("/skill");
  });

  it("does not fetch Slack skill metadata while remote skills are disabled", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-slack-disabled-skills-"));
    const session = route();
    session.actions.getSkillCommands = vi.fn(() => { throw new Error("should not fetch skill metadata while disabled"); });
    await new TunnelStateStore(stateDir).upsertChannelBinding({
      channel: "slack",
      conversationId: "slack-conversation",
      userId: "slack-user",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const sent: string[] = [];
    let handler: ((event: SlackEnvelope) => Promise<void>) | undefined;
    const operations: SlackApiOperations = {
      startSocketMode: async (nextHandler) => { handler = nextHandler; },
      postMessage: async (payload: SlackPostMessagePayload) => { sent.push(payload.text); },
      uploadFile: async () => undefined,
      postEphemeral: async (payload) => { sent.push(payload.text); },
    };
    const runtime = new SlackRuntime({ ...configWithSkills(stateDir), skills: { enabled: false }, slack: { enabled: true, botToken: "xoxb-token", allowUserIds: ["slack-user"], botUserId: "slack-bot" } }, { operations });

    await runtime.registerRoute(session);
    await runtime.start();
    if (!handler) throw new Error("Slack handler was not registered");
    await handler({ type: "event_callback", eventId: "slack-disabled-skills", event: { type: "message", channel_type: "im", channel: "slack-conversation", user: "slack-user", text: "relay skills", ts: "1", team: "T1" } });
    await handler({ type: "event_callback", eventId: "slack-disabled-skill", event: { type: "message", channel_type: "im", channel: "slack-conversation", user: "slack-user", text: "relay skill github inspect repo", ts: "2", team: "T1" } });
    await runtime.stop();

    expect(sent).toEqual(["Remote skill invocation is disabled.", "Remote skill invocation is disabled."]);
    expect(session.actions.getSkillCommands).not.toHaveBeenCalled();
    expect(session.actions.sendUserMessage).not.toHaveBeenCalled();
  });

  it("queues busy Slack direct skill invocations with the configured steer mode", async () => {
    const { session, sent, runtime, handler } = await setupBusySlackSkillRuntime("steer");
    await handler({ type: "event_callback", eventId: "slack-direct-skill", event: { type: "message", channel_type: "im", channel: "slack-conversation", user: "slack-user", text: "relay skill github inspect repo", ts: "1", team: "T1" } });
    await runtime.stop();

    expect(session.actions.sendUserMessage).toHaveBeenCalledWith("Use the local Pi skill /skill:github with this input:\n\ninspect repo", { deliverAs: "steer" });
    expect(sent).toEqual(["Skill `github` invocation accepted (steer)."]);
  });

  it("queues busy Slack pending skill input with the configured steer mode", async () => {
    const { session, sent, runtime, handler } = await setupBusySlackSkillRuntime("steer");
    await handler({ type: "event_callback", eventId: "slack-pending-skill", event: { type: "message", channel_type: "im", channel: "slack-conversation", user: "slack-user", text: "relay skill github", ts: "2", team: "T1" } });
    await handler({ type: "event_callback", eventId: "slack-pending-input", event: { type: "message", channel_type: "im", channel: "slack-conversation", user: "slack-user", text: "inspect later", ts: "3", team: "T1" } });
    await runtime.stop();

    expect(session.actions.sendUserMessage).toHaveBeenCalledWith("Use the local Pi skill /skill:github with this input:\n\ninspect later", { deliverAs: "steer" });
    expect(sent).toEqual([
      "Send input for skill github as your next message, or send relay skill cancel.",
      "Skill `github` invocation accepted (steer).",
    ]);
  });

  it("answers Slack unavailable skill invocation flows without delivering prompts", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-slack-unavailable-skills-"));
    const session = route();
    session.actions.getSkillCommands = vi.fn(() => { throw routeUnavailableError(); });
    await new TunnelStateStore(stateDir).upsertChannelBinding({
      channel: "slack",
      conversationId: "slack-conversation",
      userId: "slack-user",
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      boundAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const sent: string[] = [];
    let handler: ((event: SlackEnvelope) => Promise<void>) | undefined;
    const operations: SlackApiOperations = {
      startSocketMode: async (nextHandler) => { handler = nextHandler; },
      postMessage: async (payload: SlackPostMessagePayload) => { sent.push(payload.text); },
      uploadFile: async () => undefined,
      postEphemeral: async (payload) => { sent.push(payload.text); },
    };
    const runtime = new SlackRuntime({ ...configWithSkills(stateDir), slack: { enabled: true, botToken: "xoxb-token", allowUserIds: ["slack-user"], botUserId: "slack-bot" } }, { operations });

    await runtime.registerRoute(session);
    await runtime.start();
    if (!handler) throw new Error("Slack handler was not registered");
    await handler({ type: "event_callback", eventId: "slack-event", event: { type: "message", channel_type: "im", channel: "slack-conversation", user: "slack-user", text: "relay skill github input", ts: "1", team: "T1" } });
    await runtime.stop();

    expect(sent).toEqual(["Skill `github` is not available for remote invocation."]);
    expect(session.actions.getSkillCommands).toHaveBeenCalledOnce();
    expect(session.actions.sendUserMessage).not.toHaveBeenCalled();
  });
});
