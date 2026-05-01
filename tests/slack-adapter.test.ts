import { describe, expect, it, vi } from "vitest";
import { SlackChannelAdapter, isSlackIdentityAllowed, slackCapabilities, slackEventToChannelEvent, slackPairingCommand, verifySlackSignature } from "../extensions/telegram-tunnel/slack-adapter.js";
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

    expect(event).toMatchObject({
      kind: "message",
      channel: "slack",
      messageId: "171.1",
      text: "hello pi",
      conversation: { id: "D1", kind: "private" },
      sender: { channel: "slack", userId: "U1", metadata: { teamId: "T1" } },
    });
    expect(event.attachments[0]).toMatchObject({ kind: "image", fileName: "screen.png", mimeType: "image/png", supported: true });
  });

  it("normalizes Slack channel events as channel conversations", () => {
    const event = slackEventToChannelEvent({ type: "message", channel_type: "channel", channel: "C1", user: "U1", text: "/status", ts: "171.2", team: "T1" }, config);
    expect(event.conversation.kind).toBe("channel");
  });

  it("chunks text, maps buttons, uploads files, and sends typing fallback", async () => {
    const postMessage = vi.fn(async (_payload: unknown) => undefined);
    const uploadFile = vi.fn(async (_payload: unknown) => undefined);
    const postEphemeral = vi.fn(async (_payload: unknown) => undefined);
    const adapter = new SlackChannelAdapter(config, { postMessage, uploadFile, postEphemeral });
    const address = { channel: "slack", conversationId: "D1", userId: "U1" } as const;

    await adapter.sendText(address, "x".repeat(95), { buttons: [[{ label: "Full", actionData: "full:t:chat", style: "primary" }]] });
    await adapter.sendDocument(address, { fileName: "out.md", mimeType: "text/markdown", data: new Uint8Array([1]), byteSize: 1 }, { caption: "Latest output" });
    await adapter.sendActivity(address, "typing");
    await adapter.answerAction("trigger-1", { text: "Done" });

    expect(postMessage).toHaveBeenCalledTimes(4);
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({ channel: "D1", text: "x".repeat(40) });
    expect((postMessage.mock.calls.at(-1)?.[0] as { blocks: Array<Array<unknown>> }).blocks[0]![0]).toMatchObject({ text: "Full", value: "full:t:chat" });
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ channel: "D1", fileName: "out.md", caption: "Latest output" }));
    expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({ channel: "D1", user: "U1", text: "Pi is working…" }));
  });

  it("checks allow-list/workspace authorization and pairing command text", () => {
    expect(isSlackIdentityAllowed({ channel: "slack", userId: "U1", metadata: { teamId: "T1" } }, config)).toBe(true);
    expect(isSlackIdentityAllowed({ channel: "slack", userId: "U2", metadata: { teamId: "T1" } }, config)).toBe(false);
    expect(isSlackIdentityAllowed({ channel: "slack", userId: "U1", metadata: { teamId: "T2" } }, config)).toBe(false);
    expect(slackPairingCommand("abc")).toBe("/pirelay abc");
  });

  it("declares conservative Slack DM capabilities", () => {
    expect(slackCapabilities(config)).toMatchObject({ inlineButtons: true, privateChats: true, groupChats: false, maxTextChars: 40, maxImageBytes: 1000 });
  });
});
