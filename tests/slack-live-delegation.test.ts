import { afterEach, describe, expect, it } from "vitest";
import {
  SlackLiveObserver,
  SlackLivePiHarness,
  assertSlackFinalChannelState,
  readSlackLiveSuiteConfig,
  runSlackLivePreflight,
  slackLiveSecrets,
  SlackWebApiClient,
  type SlackHistoryMessage,
  type SlackLiveSuiteConfig,
  type SlackPreflightAppIdentity,
} from "../extensions/relay/testing/slack-live.js";

function envTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

const parsed = readSlackLiveSuiteConfig();
const describeLive = parsed.ready && parsed.config.delegation?.enabled ? describe : describe.skip;
const useManualDelegationTrigger = envTruthy(process.env.PI_RELAY_SLACK_LIVE_DELEGATION_MANUAL);
let harness: SlackLivePiHarness | undefined;

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
});

const liveDelegationTimeoutMs = parsed.ready ? parsed.config.timeoutMs + 30_000 : 330_000;

describeLive("Slack live delegation integration", () => {
  it("creates and claims delegation tasks in a shared room", async () => {
    if (!parsed.ready || !parsed.config.delegation) {
      throw new Error("Live delegation Slack config is not enabled.");
    }

    const config = parsed.config;
    const client = new SlackWebApiClient();
    const observer = new SlackLiveObserver(slackLiveSecrets(config));

    const preflight = await runSlackLivePreflight(config, client);
    expect(preflight.ok).toBe(true);
    expect(preflight.appIdentities).toHaveLength(2);

    const delegatedConfig = withDelegationFriendlyMachineNames(config, preflight.appIdentities);
    harness = new SlackLivePiHarness(delegatedConfig);
    await harness.start();

    const [targetBot, nonTargetBot] = preflight.appIdentities;
    expect(targetBot).toBeDefined();
    expect(nonTargetBot).toBeDefined();

    const runId = process.env.PI_RELAY_SLACK_LIVE_DELEGATION_RUN_ID?.trim() || `pirelay-slack-live-delegation-${Date.now()}`;
    const commandTargetCandidates = delegationMachineTargets(targetBot);
    const commandTextTarget = commandTargetCandidates[0] ?? targetBot.instanceId;
    const commandTargetLabel = `${commandTextTarget} (${targetBot.displayName || targetBot.userId})`;
    const delegationCommands = commandTextTarget ? buildDelegationCreateCommands(commandTextTarget, runId) : [];
    const oldest = slackTimestampFromMillis(Date.now() - 1_500);

    if (useManualDelegationTrigger) {
      console.log("\n[Slack live delegation manual mode]\n");
      console.log(`Target bot for delegation: ${commandTargetLabel}`);
      console.log(`Target bot user ID: ${targetBot.userId}`);
      console.log(`Channel: ${config.channelId}`);
      console.log("Send one of these command forms as a user message:");
      for (const command of delegationCommands) {
        console.log(`  ${command}`);
      }
      const createdByManualTrigger = await pollUntil(async () => {
        const history = await observer.pollChannelHistory(client, config.driverToken, config.channelId, {
          oldest,
          limit: 200,
        });
        return findDelegationCreateCommand(history, delegationCommands, runId) ? history : undefined;
      }, config.timeoutMs, "manual delegation create command");
      expect(createdByManualTrigger.length).toBeGreaterThan(0);
    } else {
      await client.postMessage(config.driverToken, {
        channel: config.channelId,
        text: delegationCommands[0] ?? `relay delegate ${commandTextTarget} run delegation smoke check ${runId}`,
      });
    }

    const createHistory = await pollUntil(async () => {
      const history = await observer.pollChannelHistory(client, config.driverToken, config.channelId, {
        oldest,
        limit: 120,
      });
      const taskId = findDelegationTaskId(history, targetBot.userId, runId);
      return taskId ? history : undefined;
    }, config.timeoutMs, "delegation task card");

    const taskMessage = findDelegationTaskMessage(createHistory, targetBot.userId, runId);
    const taskId = taskMessage?.id;
    const taskCardTs = taskMessage?.ts;
    expect(taskId).toBeDefined();
    expect(taskCardTs).toBeDefined();

    if (useManualDelegationTrigger) {
      console.log("\n[Slack live delegation manual mode]\n");
      console.log(`Target task id: ${taskId}`);
      console.log("Once the task card appears, either click the Slack Claim button or send this fallback command as a normal message:");
      console.log("  relay task claim <task-id>");
      console.log(`  (use the task id from the card: ${taskId}; do not use a leading slash in Slack)`);
    }

    const claimCommand = `relay task claim ${taskId}`;
    let claimTs: string | undefined;
    if (useManualDelegationTrigger) {
      console.log(`  ${claimCommand}`);
      const claimObserved = await pollUntil(async () => {
        const history = await observer.pollChannelHistory(client, config.driverToken, config.channelId, {
          oldest,
          limit: 240,
        });
        const commandTs = findDelegationClaimCommandTs(history, claimCommand);
        if (commandTs) return { history, observedAfterTs: commandTs };
        const targetMessages = extractMessages(history, targetBot.userId);
        const buttonDrivenUpdate = targetMessages.find((message) =>
          messageTextIncludes(message, taskId!)
          && isExpectedPostClaimDelegationStatus(message, taskCardTs, false, runId)
        );
        return buttonDrivenUpdate ? { history, observedAfterTs: taskCardTs } : undefined;
      }, config.timeoutMs, "manual delegation claim command or Slack Claim button action");
      expect(claimObserved.history.length).toBeGreaterThan(0);
      claimTs = claimObserved.observedAfterTs;
    } else {
      const ack = await client.postMessage(config.driverToken, {
        channel: config.channelId,
        text: claimCommand,
      });
      claimTs = ack.ts;
    }

    const claimedHistory = await pollUntil(async () => {
      const history = await observer.pollChannelHistory(client, config.driverToken, config.channelId, {
        oldest: claimTs ?? oldest,
        limit: 200,
      });
      const targetMessages = extractMessages(history, targetBot.userId);
      const matched = targetMessages.some((message) =>
        messageTextIncludes(message, taskId!)
        && isExpectedPostClaimDelegationStatus(message, claimTs, config.realAgent, runId)
      );
      return matched ? history : undefined;
    }, config.timeoutMs, config.realAgent ? "delegation completed task update with result after claim command" : "delegation claimed/running task update after claim command");

    const snapshot = observer.snapshot();
    const nonTargetMessages = snapshot.flatMap((entry) => {
      if (entry.kind !== "message") return [] as SlackHistoryMessage[];
      if (!isSlackHistoryMessage(entry.payload)) return [] as SlackHistoryMessage[];
      return entry.payload.user === nonTargetBot.userId ? [entry.payload] : [];
    });
    expect(nonTargetMessages.some((message) => messageTextIncludes(message, taskId!))).toBe(false);

    const finalState = assertSlackFinalChannelState(snapshot, {
      runId: taskId!,
      requiredText: [taskId!],
      forbiddenBotUserIds: [nonTargetBot.userId],
      forbiddenText: config.realAgent ? ["PiRelay Slack stub received"] : undefined,
    });

    expect(claimedHistory.at(-1)).toBeDefined();
    expect(finalState).toEqual({ ok: true, failures: [] });
  }, liveDelegationTimeoutMs);
});

async function pollUntil<T>(operation: () => Promise<T | undefined>, timeoutMs: number, description: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await operation();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for Slack live delegation observation: ${description}.`);
}

function withDelegationFriendlyMachineNames(config: SlackLiveSuiteConfig, appIdentities: readonly SlackPreflightAppIdentity[]): SlackLiveSuiteConfig {
  const [firstApp, secondApp] = config.apps;
  return {
    ...config,
    apps: [
      withDelegationFriendlyDisplayName(firstApp, appIdentities),
      withDelegationFriendlyDisplayName(secondApp, appIdentities),
    ],
  };
}

function withDelegationFriendlyDisplayName(app: SlackLiveSuiteConfig["apps"][number], appIdentities: readonly SlackPreflightAppIdentity[]): SlackLiveSuiteConfig["apps"][number] {
  const appIdentity = appIdentities.find((identity) => identity.instanceId === app.instanceId);
  if (!appIdentity || appIdentity.displayName === app.displayName) return app;
  return { ...app, displayName: appIdentity.displayName };
}

function delegationMachineTargets(identity: SlackPreflightAppIdentity): string[] {
  return [...new Set([identity.displayName, identity.userName, identity.userId, identity.instanceId]
    .map((value) => normalizeMachineTarget(value ?? ""))
    .filter((value): value is string => value.length > 0))];
}

function buildDelegationCreateCommands(machineTarget: string, runId: string): string[] {
  const normalizedTarget = normalizeMachineTarget(machineTarget);
  if (!normalizedTarget) return [];
  const targets = [
    normalizedTarget,
    `machine:${normalizedTarget}`,
    `@${normalizedTarget}`,
    `machine:@${normalizedTarget}`,
  ];
  return [...new Set(targets)].map((target) => `relay delegate ${target} run delegation smoke check ${runId}`);
}

function normalizeMachineTarget(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

function normalizeSlackCommandTextForMatch(text: string): string {
  const withMentionsUnpacked = text.replace(/<@([A-Z0-9_]+)>/g, "@$1");
  return withMentionsUnpacked.trim().toLowerCase();
}

function extractMessages(history: readonly SlackHistoryMessage[], userId: string): SlackHistoryMessage[] {
  return history.filter((message) => message.user === userId);
}

function findDelegationCreateCommand(history: readonly SlackHistoryMessage[], expectedTexts: string[], expectedRunId?: string): boolean {
  const normalizedRunId = expectedRunId ? normalizeSlackCommandTextForMatch(expectedRunId) : undefined;
  return history.some((message) => {
    if (message.user === undefined || message.botId !== undefined) return false;
    const text = message.text ?? "";
    const normalized = normalizeSlackCommandTextForMatch(text);
    const withoutSlash = normalized.replace(/^\//, "");
    if (normalizedRunId && normalizedRunId.length > 0 && normalized.includes(normalizedRunId)) return true;
    return expectedTexts.some((expectedText) => {
      const expected = normalizeSlackCommandTextForMatch(expectedText);
      return withoutSlash.includes(expected) || normalized.includes(expected) || withoutSlash.includes(`relay delegate ${expected}`);
    });
  });
}

function findDelegationClaimCommandTs(history: readonly SlackHistoryMessage[], expectedPrefix: string): string | undefined {
  const normalizedPrefix = normalizeSlackCommandTextForMatch(expectedPrefix);
  const expectedTaskPrefix = expectedPrefix.replace(/^relay\s+/i, "");
  const normalizedTaskPrefix = normalizeSlackCommandTextForMatch(expectedTaskPrefix);
  return history.find((message) => {
    if (message.user === undefined || message.botId !== undefined) return false;
    const normalized = normalizeSlackCommandTextForMatch(message.text ?? "");
    const normalizedWithoutSlash = normalized.replace(/^\//, "");
    return normalized.includes(normalizedPrefix)
      || normalizedWithoutSlash.includes(normalizedPrefix)
      || normalized.includes(`task claim ${normalizedTaskPrefix}`)
      || normalizedWithoutSlash.includes(`task claim ${normalizedTaskPrefix}`);
  })?.ts;
}

function findDelegationTaskId(history: readonly SlackHistoryMessage[], botUserId: string, marker: string): string | undefined {
  return findDelegationTaskMessage(history, botUserId, marker)?.id;
}

function findDelegationTaskMessage(history: readonly SlackHistoryMessage[], botUserId: string, marker: string): { id: string; ts: string } | undefined {
  return extractMessages(history, botUserId)
    .filter((message) => messageTextIncludes(message, marker))
    .flatMap((message) => {
      const taskId = message.text?.match(/relay task claim ([a-z0-9_-]+)/i)?.[1];
      return taskId ? [{ id: taskId, ts: message.ts }] : [];
    })[0];
}

function isExpectedPostClaimDelegationStatus(message: SlackHistoryMessage, claimTs: string | undefined, requireCompletedResult: boolean, runId: string): boolean {
  if (claimTs && Number(message.ts) <= Number(claimTs)) return false;
  const text = message.text ?? "";
  if (requireCompletedResult) return /Status:\s*completed/i.test(text) && /Latest:/i.test(text) && text.includes(runId);
  return /Status:\s*(claimed|running|completed|blocked|failed)/i.test(text) || /Claimed by:/i.test(text);
}

function messageTextIncludes(message: SlackHistoryMessage, fragment: string): boolean {
  return typeof message.text === "string" && message.text.includes(fragment);
}

function isSlackHistoryMessage(value: unknown): value is SlackHistoryMessage {
  return typeof value === "object" && value !== null && typeof (value as SlackHistoryMessage).ts === "string";
}

function slackTimestampFromMillis(ms: number): string {
  return (ms / 1_000).toFixed(6);
}
