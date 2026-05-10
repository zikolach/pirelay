import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  SlackApiError,
  SlackLiveObserver,
  SlackLivePiHarness,
  assertSlackFinalChannelState,
  assertSlackTargetedMessageFlow,
  readSlackLiveSuiteConfig,
  redactSlackLiveText,
  redactSlackLiveValue,
  runSlackLivePreflight,
  slackLivePiConfig,
  type SlackLiveApiClient,
  type SlackLiveSuiteConfig,
} from "../extensions/relay/testing/slack-live.js";

const config: SlackLiveSuiteConfig = {
  workspaceId: "T1",
  channelId: "C1",
  authorizedUserId: "U_DRIVER",
  driverToken: "xoxp-driver-secret",
  eventMode: "socket",
  timeoutMs: 5_000,
  apps: [
    {
      role: "a",
      instanceId: "slack-live-a",
      displayName: "Machine A",
      botToken: "xoxb-a-secret",
      signingSecret: "signing-a-secret",
      appLevelToken: "xapp-a-secret",
      expectedBotUserId: "U_A",
      piCommand: "node -e 'setTimeout(() => {}, 1000)'",
    },
    {
      role: "b",
      instanceId: "slack-live-b",
      displayName: "Machine B",
      botToken: "xoxb-b-secret",
      signingSecret: "signing-b-secret",
      appLevelToken: "xapp-b-secret",
      expectedBotUserId: "U_B",
      piCommand: "node -e 'setTimeout(() => {}, 1000)'",
    },
  ],
};

class FakeSlackClient implements SlackLiveApiClient {
  authTest = vi.fn(async (token: string) => {
    if (token === config.driverToken) return { teamId: "T1", userId: "U_DRIVER" };
    if (token === config.apps[0].botToken) return { teamId: "T1", userId: "U_A", botId: "BA" };
    if (token === config.apps[1].botToken) return { teamId: "T1", userId: "U_B", botId: "BB" };
    throw new SlackApiError("auth.test", "invalid_auth", "invalid_auth");
  });

  authScopes = vi.fn(async (token: string) => token === config.driverToken
    ? ["chat:write"]
    : ["chat:write", "app_mentions:read", "channels:read", "channels:history"]);

  conversationsInfo = vi.fn(async (_token: string, channelId: string) => ({ id: channelId, isMember: true }));
  appsConnectionsOpen = vi.fn(async (_token: string) => undefined);
  postMessage = vi.fn(async (_token: string, request: { channel: string; text: string }) => ({ ok: true as const, channel: request.channel, ts: "1.0" }));
  conversationsHistory = vi.fn(async () => []);
}

describe("Slack live suite configuration", () => {
  it("skips cleanly when live credentials are absent", () => {
    const parsed = readSlackLiveSuiteConfig({});

    expect(parsed.ready).toBe(false);
    if (!parsed.ready) {
      expect(parsed.skipReason).toContain("PI_RELAY_SLACK_LIVE_ENABLED");
      expect(parsed.missing).toContain("PI_RELAY_SLACK_LIVE_ENABLED");
    }
  });

  it("parses complete live environment without exposing values in skip metadata", () => {
    const parsed = readSlackLiveSuiteConfig({
      PI_RELAY_SLACK_LIVE_ENABLED: "true",
      PI_RELAY_SLACK_LIVE_WORKSPACE_ID: "T1",
      PI_RELAY_SLACK_LIVE_CHANNEL_ID: "C1",
      PI_RELAY_SLACK_LIVE_AUTHORIZED_USER_ID: "U_DRIVER",
      PI_RELAY_SLACK_LIVE_DRIVER_TOKEN: "xoxp-driver-secret",
      PI_RELAY_SLACK_LIVE_BOT_A_TOKEN: "xoxb-a-secret",
      PI_RELAY_SLACK_LIVE_BOT_A_SIGNING_SECRET: "signing-a-secret",
      PI_RELAY_SLACK_LIVE_BOT_A_APP_TOKEN: "xapp-a-secret",
      PI_RELAY_SLACK_LIVE_BOT_A_PI_COMMAND: "pi a",
      PI_RELAY_SLACK_LIVE_BOT_B_TOKEN: "xoxb-b-secret",
      PI_RELAY_SLACK_LIVE_BOT_B_SIGNING_SECRET: "signing-b-secret",
      PI_RELAY_SLACK_LIVE_BOT_B_APP_TOKEN: "xapp-b-secret",
      PI_RELAY_SLACK_LIVE_BOT_B_PI_COMMAND: "pi b",
      PI_RELAY_SLACK_LIVE_TIMEOUT_MS: "42",
    });

    expect(parsed.ready).toBe(true);
    if (parsed.ready) {
      expect(parsed.config.apps.map((app) => app.instanceId)).toEqual(["slack-live-a", "slack-live-b"]);
      expect(parsed.config.timeoutMs).toBe(42);
    }
  });
});

describe("Slack live preflight", () => {
  it("validates installed apps, scopes, channel membership, and event delivery", async () => {
    const client = new FakeSlackClient();

    const result = await runSlackLivePreflight(config, client);

    expect(result.ok).toBe(true);
    expect(result.appIdentities.map((identity) => identity.userId)).toEqual(["U_A", "U_B"]);
    expect(client.conversationsInfo).toHaveBeenCalledTimes(2);
    expect(client.appsConnectionsOpen).toHaveBeenCalledTimes(2);
  });

  it("reports missing scopes and membership with redacted secret output", async () => {
    const client = new FakeSlackClient();
    client.authScopes.mockImplementation(async (token: string) => token === config.driverToken ? ["chat:write"] : ["chat:write"]);
    client.conversationsInfo.mockResolvedValue({ id: "C1", isMember: false });
    client.appsConnectionsOpen.mockRejectedValue(new SlackApiError("apps.connections.open", "invalid_auth", "bad xapp-a-secret"));

    const result = await runSlackLivePreflight(config, client);
    const messages = result.findings.map((finding) => finding.message).join("\n");

    expect(result.ok).toBe(false);
    expect(messages).toContain("missing required scope");
    expect(messages).toContain("not a member");
    expect(messages).not.toContain("xapp-a-secret");
    expect(messages).not.toContain("xoxb-a-secret");
  });
});

describe("Slack live Pi harness planning", () => {
  it("writes distinct per-instance PiRelay configuration without embedding Slack secrets", () => {
    const first = slackLivePiConfig(config, config.apps[0], "/tmp/a");
    const second = slackLivePiConfig(config, config.apps[1], "/tmp/b");
    const serialized = JSON.stringify([first, second]);

    expect(first).toMatchObject({ relay: { machineId: "slack-live-a", stateDir: "/tmp/a" } });
    expect(second).toMatchObject({ relay: { machineId: "slack-live-b", stateDir: "/tmp/b" } });
    expect(serialized).toContain("PI_RELAY_SLACK_BOT_TOKEN");
    expect(serialized).not.toContain("xoxb-a-secret");
    expect(serialized).not.toContain("signing-a-secret");
  });

  it("launches two isolated child processes and tears down temporary state", async () => {
    const processConfig: SlackLiveSuiteConfig = {
      ...config,
      apps: [
        { ...config.apps[0], piCommand: `"${process.execPath}" -e "setTimeout(() => {}, 10000)"` },
        { ...config.apps[1], piCommand: `"${process.execPath}" -e "setTimeout(() => {}, 10000)"` },
      ],
    };
    const harness = new SlackLivePiHarness(processConfig);
    try {
      const processes = await harness.start();
      expect(processes.map((entry) => entry.instanceId)).toEqual(["slack-live-a", "slack-live-b"]);
      expect(processes[0].stateDir).not.toBe(processes[1].stateDir);
      await expect(readFile(processes[0].configPath, "utf8")).resolves.toContain("slack-live-a");
      await expect(readFile(processes[1].configPath, "utf8")).resolves.toContain("slack-live-b");
    } finally {
      await harness.stop();
    }
  });
});

describe("Slack live observer and assertions", () => {
  it("records events, API acknowledgements, posted messages, and redacts secrets", () => {
    const observer = new SlackLiveObserver(["xoxb-a-secret"]);

    observer.recordSlackEvent("slack-live-a", { token: "xoxb-a-secret", event: { text: "hello" } });
    observer.recordApiAcknowledgement("driver", "chat.postMessage", { ok: true, authorization: "Bearer xoxb-a-secret" });
    observer.recordPostedMessages([
      { ts: "1", user: "U_DRIVER", text: "run-1 prompt" },
      { ts: "2", user: "U_A", text: "run-1 completed" },
    ]);

    const snapshot = observer.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain("xoxb-a-secret");
    expect(snapshot).toHaveLength(4);
  });

  it("asserts targeted delivery, non-target silence, and final channel state", () => {
    const observer = new SlackLiveObserver();
    observer.recordPostedMessages([
      { ts: "1", user: "U_DRIVER", text: "run-42 prompt" },
      { ts: "2", user: "U_A", text: "run-42 completed for machine A", threadTs: "1" },
    ]);
    const snapshot = observer.snapshot();

    expect(assertSlackTargetedMessageFlow(snapshot, {
      runId: "run-42",
      targetBotUserId: "U_A",
      nonTargetBotUserId: "U_B",
      expectedReplyIncludes: "completed",
    })).toEqual({ ok: true, failures: [] });

    expect(assertSlackFinalChannelState(snapshot, {
      runId: "run-42",
      requiredText: ["completed for machine A"],
      forbiddenBotUserIds: ["U_B"],
    })).toEqual({ ok: true, failures: [] });
  });

  it("fails when the non-target bot emits a run-scoped reply", () => {
    const observer = new SlackLiveObserver();
    observer.recordPostedMessages([
      { ts: "1", user: "U_A", text: "run-99 completed" },
      { ts: "2", user: "U_B", text: "run-99 unexpected" },
    ]);

    const result = assertSlackTargetedMessageFlow(observer.snapshot(), {
      runId: "run-99",
      targetBotUserId: "U_A",
      nonTargetBotUserId: "U_B",
      expectedReplyIncludes: "completed",
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("Non-target Slack bot");
  });
});

describe("Slack live redaction", () => {
  it("redacts configured secrets and Slack token patterns", () => {
    expect(redactSlackLiveText("token xoxb-123-abc and xapp-456-def", ["custom-secret"])).not.toContain("xoxb-123-abc");
    expect(redactSlackLiveText("value custom-secret", ["custom-secret"])).toBe("value [redacted]");
  });

  it("redacts Slack app tokens, URLs, response URLs, pairing codes, and authorization headers", () => {
    const input = "Authorization: Bearer xoxb-123-abc socket wss://wss-primary.slack.com/link/?ticket=secret response https://hooks.slack.com/actions/T/B/secret code 123-456 signing slack-signing-secret-value";
    const redacted = redactSlackLiveText(input, ["xapp-local-secret"]);

    expect(redacted).not.toContain("xoxb-123-abc");
    expect(redacted).not.toContain("wss-primary.slack.com");
    expect(redacted).not.toContain("hooks.slack.com/actions");
    expect(redacted).not.toContain("123-456");
    expect(redacted).not.toContain("slack-signing-secret-value");
    expect(redactSlackLiveText("app xapp-local-secret", ["xapp-local-secret"])).toBe("app [redacted]");
  });

  it("redacts secret-shaped object keys", () => {
    expect(redactSlackLiveValue({ response_url: "https://hooks.slack.com/actions/T/B/secret", authorization: "Bearer abc", safe: "ok" })).toEqual({ response_url: "[redacted]", authorization: "[redacted]", safe: "ok" });
  });
});
