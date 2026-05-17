import { describe, expect, it, vi } from "vitest";
import { SlackChannelAdapter, buildSlackActionId, isSlackIdentityAllowed, parseSlackWebhookBody, slackCapabilities, slackEnvelopeToChannelEvent, slackEventToChannelEvent, slackMentionedUserIds, slackMessageSharedRoomAddressing, slackPairingCommand, verifySlackSignature } from "../extensions/relay/adapters/slack/adapter.js";
import { createHmac } from "node:crypto";

const config = {
  enabled: true,
  botToken: "xoxb-token",
  signingSecret: "secret",
  workspaceId: "T1",
  allowUserIds: ["U1"],
  allowChannelMessages: false,
  maxTextChars: 40,
  maxFileBytes: 1000,
  allowedImageMimeTypes: ["image/png"],
};

describe("SlackChannelAdapter", () => {
  it("validates Slack signatures", () => {
    const body = JSON.stringify({ type: "event_callback" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", config.signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

    expect(verifySlackSignature({ body, timestamp, signature, signingSecret: config.signingSecret, nowSeconds: Number(timestamp) })).toBe(true);
    expect(verifySlackSignature({ body, timestamp, signature: "v0=bad", signingSecret: config.signingSecret, nowSeconds: Number(timestamp) })).toBe(false);
    expect(verifySlackSignature({ body, timestamp: String(Number(timestamp) - 600), signature, signingSecret: config.signingSecret, nowSeconds: Number(timestamp) })).toBe(false);
  });

  it("normalizes Slack DM events and file attachments", () => {
    const event = slackEventToChannelEvent({
      type: "message",
      channel_type: "im",
      channel: "D1",
      user: "U1",
      text: "hello pi",
      ts: "171.1",
      team: "T1",
      files: [{ id: "F1", name: "screen.png", mimetype: "image/png", size: 123, url_private_download: "https://slack.test/file" }],
    }, config);

    expect(event).toBeDefined();
    expect(event!).toMatchObject({
      kind: "message",
      channel: "slack",
      messageId: "171.1",
      text: "hello pi",
      conversation: { id: "D1", kind: "private" },
      sender: { channel: "slack", userId: "U1", metadata: { teamId: "T1" } },
    });
    expect(event!.attachments[0]).toMatchObject({ kind: "image", fileName: "screen.png", mimeType: "image/png", supported: true });
  });

  it("normalizes Slack channel events as channel conversations", () => {
    const event = slackEventToChannelEvent({ type: "message", channel_type: "channel", channel: "C1", user: "U1", text: "/status", ts: "171.2", team: "T1" }, config);
    expect(event).toBeDefined();
    expect(event!.conversation.kind).toBe("channel");
  });

  it("keeps root Slack thread metadata unset for room matching", () => {
    const rootEvent = slackEventToChannelEvent({
      type: "message",
      channel_type: "channel",
      channel: "C1",
      user: "U1",
      text: "relay delegate laptop run tests",
      ts: "171.4",
      team: "T1",
      thread_ts: "171.4",
    }, config);
    expect(rootEvent).toMatchObject({ metadata: { teamId: "T1", threadTs: undefined } });

    const threadedEvent = slackEventToChannelEvent({
      type: "message",
      channel_type: "channel",
      channel: "C1",
      user: "U1",
      text: "relay task claim x",
      ts: "171.5",
      team: "T1",
      thread_ts: "171.4",
    }, config);
    expect(threadedEvent).toMatchObject({ metadata: { teamId: "T1", threadTs: "171.4" } });
  });

  it("keeps root Slack thread metadata unset for block actions", () => {
    const action = slackEnvelopeToChannelEvent({
      type: "block_actions",
      channel: { id: "C1" },
      user: { id: "U1", team_id: "T1" },
      actions: [{ value: "full:t:chat" }],
      message: { ts: "171.6", thread_ts: "171.6" },
      response_url: "https://hooks.slack.test/response",
    }, config);
    expect(action).toMatchObject({ metadata: { teamId: "T1", threadTs: undefined } });

    const threadedAction = slackEnvelopeToChannelEvent({
      type: "block_actions",
      channel: { id: "C1" },
      user: { id: "U1", team_id: "T1" },
      actions: [{ value: "full:t:chat" }],
      message: { ts: "171.7", thread_ts: "171.4" },
      response_url: "https://hooks.slack.test/response",
    }, config);
    expect(threadedAction).toMatchObject({ metadata: { teamId: "T1", threadTs: "171.4" } });
  });

  it("chunks text, maps buttons, uploads files, and sends typing fallback", async () => {
    const postMessage = vi.fn(async (_payload: unknown) => undefined);
    const uploadFile = vi.fn(async (_payload: unknown) => undefined);
    const postEphemeral = vi.fn(async (_payload: unknown) => undefined);
    const postResponse = vi.fn(async (_url: string, _payload: unknown) => undefined);
    const downloadFile = vi.fn(async (_url: string) => new Uint8Array([8]));
    const adapter = new SlackChannelAdapter(config, { postMessage, uploadFile, postEphemeral, postResponse, downloadFile });
    const address = { channel: "slack", conversationId: "D1", userId: "U1", threadTs: "thread-1" } as const;

    await adapter.sendText(address, "x".repeat(95), { buttons: [[{ label: "Full", actionData: "full:t:chat", style: "primary" }]] });
    await adapter.sendDocument(address, { fileName: "out.md", mimeType: "text/markdown", data: new Uint8Array([1]), byteSize: 1 }, { caption: "Latest output" });
    await adapter.sendActivity(address, "typing");
    await adapter.answerAction(buildSlackActionId({ channelId: "D1", userId: "U1", responseUrl: "https://hooks.slack.test/response" }), { text: "Done" });
    await expect(adapter.downloadFile({ id: "F1", kind: "image", metadata: { url: "https://slack.test/file" } })).resolves.toEqual(new Uint8Array([8]));

    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({ channel: "D1", text: "x".repeat(40) });
    expect((postMessage.mock.calls.at(-1)?.[0] as { blocks: Array<{ type: string; elements?: unknown[] }> }).blocks[0]).toMatchObject({ type: "section" });
    expect((postMessage.mock.calls.at(-1)?.[0] as { blocks: Array<{ type: string; elements?: unknown[] }> }).blocks[1]?.elements?.[0]).toMatchObject({ text: "Full", value: "full:t:chat", actionId: "full:t:chat" });
    expect(postMessage.mock.calls.at(-1)?.[0]).not.toMatchObject({ text: "Actions:" });
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ channel: "D1", fileName: "out.md", caption: "Latest output" }));
    expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({ channel: "D1", user: "U1", text: "Pi is working…", threadTs: "thread-1" }));
    expect(postResponse).toHaveBeenCalledWith("https://hooks.slack.test/response", { text: "Done", ephemeral: true });
    expect(downloadFile).toHaveBeenCalledWith("https://slack.test/file");
  });

  it("handles signed Slack slash-command form webhooks", async () => {
    const adapter = new SlackChannelAdapter(config, { postMessage: async () => undefined, uploadFile: async () => undefined, postEphemeral: async () => undefined });
    const raw = new URLSearchParams({ command: "/relay", text: "status", channel_id: "D1", user_id: "U1", team_id: "T1", trigger_id: "trig", response_url: "https://hooks.slack.test/response" }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", config.signingSecret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
    const events: unknown[] = [];

    await adapter.handleWebhook(raw, { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature }, async (event) => {
      events.push(event);
    });

    expect(events[0]).toMatchObject({ kind: "message", text: "relay status", conversation: { id: "D1" }, sender: { userId: "U1" }, metadata: { responseUrl: "https://hooks.slack.test/response" } });
    await expect(adapter.handleWebhook(raw, { "x-slack-request-timestamp": timestamp, "x-slack-signature": "v0=bad" }, async () => undefined)).rejects.toThrow("Invalid Slack signature");
  });

  it("handles signed Slack form webhooks and preserves channel kind for actions", async () => {
    const adapter = new SlackChannelAdapter(config, { postMessage: async () => undefined, uploadFile: async () => undefined, postEphemeral: async () => undefined });
    const envelope = { type: "block_actions", channel: { id: "C1" }, user: { id: "U1", team_id: "T1" }, actions: [{ value: "full:t:chat" }], response_url: "https://hooks.slack.test/response" };
    const raw = `payload=${encodeURIComponent(JSON.stringify(envelope))}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", config.signingSecret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
    const events: unknown[] = [];

    await adapter.handleWebhook(raw, { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature }, async (event) => {
      events.push(event);
    });

    expect(events[0]).toMatchObject({ kind: "action", conversation: { kind: "channel" }, sender: { userId: "U1" } });
    await expect(adapter.handleWebhook({ ...envelope }, { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature }, async () => undefined)).rejects.toThrow("Raw Slack request body");
  });

  it("treats Slack app_mention updates as deferred runtime-parity gaps", () => {
    const event = slackEventToChannelEvent({ type: "message", subtype: "app_mention", channel_type: "channel", channel: "C1", user: "U1", text: "<@U1> hi", ts: "171.3", team: "T1" }, config);

    expect(event).toBeUndefined();
  });

  it("falls back to an ephemeral Slack action response when no response URL is present", async () => {
    const postEphemeral = vi.fn(async (_payload: unknown) => undefined);
    const adapter = new SlackChannelAdapter(config, { postMessage: async () => undefined, uploadFile: async () => undefined, postEphemeral });

    await adapter.answerAction(buildSlackActionId({ channelId: "C1", userId: "U1" }), { text: "Done" });

    expect(postEphemeral).toHaveBeenCalledWith({ channel: "C1", user: "U1", text: "Done" });
  });

  it("parses real Slack form webhook bodies", () => {
    const envelope = { type: "block_actions", channel: { id: "C1" }, user: { id: "U1", team_id: "T1" }, actions: [{ value: "full:t:chat" }], response_url: "https://hooks.slack.test/response" };
    const raw = `payload=${encodeURIComponent(JSON.stringify(envelope))}`;
    expect(parseSlackWebhookBody(raw)).toMatchObject(envelope);
    const event = slackEnvelopeToChannelEvent(envelope as never, config);
    expect(event).toMatchObject({ kind: "action", conversation: { kind: "channel" }, sender: { userId: "U1" } });
  });

  it("rejects bot/system messages and only applies image MIME allow-list to images", () => {
    expect(slackEventToChannelEvent({ type: "message", channel_type: "im", channel: "D1", bot_id: "B1", text: "loop", ts: "1", team: "T1" }, config)).toBeUndefined();
    const docEvent = slackEventToChannelEvent({ type: "message", channel_type: "im", channel: "D1", user: "U1", text: "doc", ts: "2", team: "T1", files: [{ id: "F2", name: "notes.txt", mimetype: "text/plain", size: 10 }] }, config);
    expect(docEvent?.attachments[0]).toMatchObject({ kind: "document", supported: true });
  });

  it("sends a single Slack button prompt after file uploads", async () => {
    const postMessage = vi.fn(async (_payload: unknown) => undefined);
    const adapter = new SlackChannelAdapter(config, { postMessage, uploadFile: async () => undefined, postEphemeral: async () => undefined });
    const address = { channel: "slack", conversationId: "D1", userId: "U1" } as const;

    await adapter.sendDocument(address, { fileName: "out.txt", mimeType: "text/plain", data: new Uint8Array([1]), byteSize: 1 }, { buttons: [[{ label: "Full", actionData: "full:t:chat" }]] });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({ channel: "D1", text: "Actions:" });
  });

  it("rejects outbound files deterministically when limits or base64 encoding are invalid", async () => {
    const adapter = new SlackChannelAdapter(config, { postMessage: async () => undefined, uploadFile: async () => undefined, postEphemeral: async () => undefined });
    const address = { channel: "slack", conversationId: "D1", userId: "U1" } as const;

    await expect(adapter.sendImage(address, { fileName: "bad.gif", mimeType: "image/gif", data: new Uint8Array([1]), byteSize: 1 })).rejects.toThrow("MIME type");
    await expect(adapter.sendDocument(address, { fileName: "huge.txt", mimeType: "text/plain", data: new Uint8Array([1]), byteSize: 1001 })).rejects.toThrow("too large");
    await expect(adapter.sendDocument(address, { fileName: "bad.txt", mimeType: "text/plain", data: "plain text", byteSize: 10 })).rejects.toThrow("base64");
  });

  it("checks allow-list/workspace authorization and pairing command text", () => {
    expect(isSlackIdentityAllowed({ channel: "slack", userId: "U1", metadata: { teamId: "T1" } }, config)).toBe(true);
    expect(isSlackIdentityAllowed({ channel: "slack", userId: "U2", metadata: { teamId: "T1" } }, config)).toBe(false);
    expect(isSlackIdentityAllowed({ channel: "slack", userId: "U1", metadata: { teamId: "T2" } }, config)).toBe(false);
    expect(isSlackIdentityAllowed({ channel: "slack", userId: "U1" }, config)).toBe(false);
    expect(slackPairingCommand("abc")).toBe("relay pair abc");
  });

  it("normalizes Slack shared-room mentions", () => {
    expect(slackMentionedUserIds("hi <@U123> and <@U456>")).toEqual(["U123", "U456"]);
    expect(slackMessageSharedRoomAddressing("hi <@U123>", "U123")).toEqual({ kind: "local" });
    expect(slackMessageSharedRoomAddressing("hi <@U456>", "U123")).toEqual({ kind: "none" });
    expect(slackMessageSharedRoomAddressing("hi <@U456>", "U123", ["U456"])).toEqual({ kind: "remote", selector: "U456" });
    expect(slackMessageSharedRoomAddressing("hi <@U123> <@U456>", "U123", ["U456"])).toEqual({ kind: "ambiguous", reason: "multiple bot mentions" });
    expect(slackMessageSharedRoomAddressing("hi", "U123")).toEqual({ kind: "none" });
  });

  it("declares conservative Slack DM capabilities", () => {
    expect(slackCapabilities(config)).toMatchObject({ inlineButtons: true, privateChats: true, groupChats: false, maxTextChars: 40, maxImageBytes: 1000 });
  });
});
