import { afterEach, describe, expect, it } from "vitest";
import {
  SlackLiveObserver,
  SlackLivePiHarness,
  SlackWebApiClient,
  assertSlackFinalChannelState,
  assertSlackTargetedMessageFlow,
  readSlackLiveSuiteConfig,
  runSlackLivePreflight,
  slackLiveSecrets,
  slackLiveSkipReason,
} from "../extensions/relay/testing/slack-live.js";

const parsed = readSlackLiveSuiteConfig();
const describeLive = parsed.ready ? describe : describe.skip;
let harness: SlackLivePiHarness | undefined;

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
});

describe("Slack live integration opt-in", () => {
  it("skips cleanly when live Slack credentials are not configured", () => {
    const reason = slackLiveSkipReason({});
    expect(reason).toContain("PI_RELAY_SLACK_LIVE_ENABLED");
  });
});

const liveTestTimeoutMs = parsed.ready ? parsed.config.timeoutMs + 30_000 : 5_000;

describeLive("Slack live integration suite", () => {
  it("routes a targeted prompt to one Pi instance and keeps the other silent", async () => {
    if (!parsed.ready) throw new Error("Slack live config unexpectedly unavailable.");
    const config = parsed.config;
    const client = new SlackWebApiClient();
    const observer = new SlackLiveObserver(slackLiveSecrets(config));

    const preflight = await runSlackLivePreflight(config, client);
    expect(preflight.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(preflight.ok).toBe(true);

    harness = new SlackLivePiHarness(config);
    await harness.start();

    const target = preflight.appIdentities[0];
    const nonTarget = preflight.appIdentities[1];
    const runId = `pirelay-slack-live-${Date.now()}`;
    const oldest = slackTimestampFromMillis(Date.now() - 1_000);
    const prompt = `<@${target.userId}> Please reply exactly with ${runId}.`;

    const ack = await client.postMessage(config.driverToken, { channel: config.channelId, text: prompt });
    observer.recordApiAcknowledgement("driver", "chat.postMessage", ack);

    const messages = await pollUntil(async () => {
      const history = await observer.pollChannelHistory(client, config.driverToken, config.channelId, { oldest, limit: 100 });
      return history.some((message) => message.user === target.userId && (message.text ?? "").includes(runId)) ? history : undefined;
    }, config.timeoutMs);

    const snapshot = observer.snapshot();
    const flow = assertSlackTargetedMessageFlow(snapshot, {
      runId,
      targetBotUserId: target.userId,
      nonTargetBotUserId: nonTarget.userId,
      expectedReplyIncludes: runId,
    });
    const finalState = assertSlackFinalChannelState(snapshot, {
      runId,
      requiredText: [runId],
      forbiddenBotUserIds: [nonTarget.userId],
    });

    expect(messages.length).toBeGreaterThan(0);
    expect([...flow.failures, ...finalState.failures]).toEqual([]);
  }, liveTestTimeoutMs);
});

async function pollUntil<T>(operation: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await operation();
    if (lastValue !== undefined) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for Slack live integration observation.");
}

function slackTimestampFromMillis(ms: number): string {
  return (ms / 1_000).toFixed(6);
}
