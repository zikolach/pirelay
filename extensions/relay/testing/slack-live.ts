import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SlackLiveEventMode = "socket" | "webhook";
export type SlackLiveAppRole = "a" | "b";

export interface SlackLiveAppConfig {
  role: SlackLiveAppRole;
  instanceId: string;
  displayName: string;
  botToken: string;
  signingSecret: string;
  appLevelToken?: string;
  expectedBotUserId?: string;
  piCommand: string;
}

export interface SlackLiveSuiteConfig {
  workspaceId: string;
  channelId: string;
  authorizedUserId: string;
  driverToken: string;
  eventMode: SlackLiveEventMode;
  realAgent: boolean;
  timeoutMs: number;
  apps: [SlackLiveAppConfig, SlackLiveAppConfig];
}

export type SlackLiveConfigReadResult =
  | { ready: true; config: SlackLiveSuiteConfig }
  | { ready: false; missing: string[]; skipReason: string };

export interface SlackAuthIdentity {
  teamId: string;
  userId: string;
  botId?: string;
}

export interface SlackConversationInfo {
  id: string;
  isMember?: boolean;
}

export interface SlackPostMessageRequest {
  channel: string;
  text: string;
  threadTs?: string;
}

export interface SlackPostMessageResponse {
  ok: true;
  channel: string;
  ts: string;
  message?: SlackHistoryMessage;
}

export interface SlackHistoryMessage {
  type?: string;
  subtype?: string;
  user?: string;
  botId?: string;
  appId?: string;
  text?: string;
  ts: string;
  threadTs?: string;
}

export interface SlackLiveApiClient {
  authTest(token: string): Promise<SlackAuthIdentity>;
  authScopes(token: string): Promise<string[] | undefined>;
  conversationsInfo(token: string, channelId: string): Promise<SlackConversationInfo>;
  appsConnectionsOpen(token: string): Promise<void>;
  postMessage(token: string, request: SlackPostMessageRequest): Promise<SlackPostMessageResponse>;
  conversationsHistory(token: string, channelId: string, options?: { oldest?: string; latest?: string; limit?: number }): Promise<SlackHistoryMessage[]>;
}

export type SlackPreflightSeverity = "ok" | "warning" | "error";

export interface SlackPreflightFinding {
  severity: SlackPreflightSeverity;
  code: string;
  appInstanceId?: string;
  message: string;
}

export interface SlackPreflightAppIdentity extends SlackAuthIdentity {
  instanceId: string;
  displayName: string;
}

export interface SlackPreflightResult {
  ok: boolean;
  findings: SlackPreflightFinding[];
  appIdentities: SlackPreflightAppIdentity[];
}

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly slackCode: string,
    message: string,
    readonly needed?: string,
    readonly provided?: string,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

const LIVE_ENABLE_ENV = "PI_RELAY_SLACK_LIVE_ENABLED";
const REDACTION = "[redacted]";
const SLACK_SECRET_PATTERNS = [
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /xapp-[A-Za-z0-9-]+/g,
  /slack-signing-secret-[A-Za-z0-9_-]+/gi,
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /wss:\/\/wss-[^\s"'<>]+/gi,
  /https:\/\/hooks\.slack(?:-gov)?\.com\/[^\s"'<>]+/gi,
  /\b(?:pairing\s+code|pin|code)\s*[:=]?\s*\d{3}-\d{3}\b/gi,
];

export function readSlackLiveSuiteConfig(env: NodeJS.ProcessEnv = process.env): SlackLiveConfigReadResult {
  if (!truthy(env[LIVE_ENABLE_ENV])) {
    return { ready: false, missing: [LIVE_ENABLE_ENV], skipReason: `Set ${LIVE_ENABLE_ENV}=true to run the live Slack suite.` };
  }

  const eventMode = env.PI_RELAY_SLACK_LIVE_EVENT_MODE === "webhook" ? "webhook" : "socket";
  const realAgent = truthy(env.PI_RELAY_SLACK_LIVE_REAL_AGENT);
  const required = [
    "PI_RELAY_SLACK_LIVE_WORKSPACE_ID",
    "PI_RELAY_SLACK_LIVE_CHANNEL_ID",
    "PI_RELAY_SLACK_LIVE_AUTHORIZED_USER_ID",
    "PI_RELAY_SLACK_LIVE_DRIVER_TOKEN",
    "PI_RELAY_SLACK_LIVE_BOT_A_TOKEN",
    "PI_RELAY_SLACK_LIVE_BOT_A_SIGNING_SECRET",
    "PI_RELAY_SLACK_LIVE_BOT_A_PI_COMMAND",
    "PI_RELAY_SLACK_LIVE_BOT_B_TOKEN",
    "PI_RELAY_SLACK_LIVE_BOT_B_SIGNING_SECRET",
    "PI_RELAY_SLACK_LIVE_BOT_B_PI_COMMAND",
  ];
  if (eventMode === "socket") {
    required.push("PI_RELAY_SLACK_LIVE_BOT_A_APP_TOKEN", "PI_RELAY_SLACK_LIVE_BOT_B_APP_TOKEN");
  }
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    return { ready: false, missing, skipReason: `Live Slack credentials are not configured: missing ${missing.join(", ")}.` };
  }

  return {
    ready: true,
    config: {
      workspaceId: env.PI_RELAY_SLACK_LIVE_WORKSPACE_ID!,
      channelId: env.PI_RELAY_SLACK_LIVE_CHANNEL_ID!,
      authorizedUserId: env.PI_RELAY_SLACK_LIVE_AUTHORIZED_USER_ID!,
      driverToken: env.PI_RELAY_SLACK_LIVE_DRIVER_TOKEN!,
      eventMode,
      realAgent,
      timeoutMs: parsePositiveInteger(env.PI_RELAY_SLACK_LIVE_TIMEOUT_MS, realAgent ? 300_000 : 120_000),
      apps: [
        readSlackLiveApp(env, "a", "A", "PI_RELAY_SLACK_LIVE_BOT_A"),
        readSlackLiveApp(env, "b", "B", "PI_RELAY_SLACK_LIVE_BOT_B"),
      ],
    },
  };
}

export function slackLiveTargetPrompt(input: { targetBotUserId: string; runId: string; realAgent?: boolean }): string {
  const mention = `<@${input.targetBotUserId}>`;
  if (input.realAgent) {
    return `${mention} This is an automated PiRelay live test. Reply with exactly this marker and no extra text: ${input.runId}`;
  }
  return `${mention} Please reply exactly with ${input.runId}.`;
}

export function slackLiveSkipReason(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const parsed = readSlackLiveSuiteConfig(env);
  return parsed.ready ? undefined : parsed.skipReason;
}

export async function runSlackLivePreflight(config: SlackLiveSuiteConfig, client: SlackLiveApiClient = new SlackWebApiClient()): Promise<SlackPreflightResult> {
  const secrets = slackLiveSecrets(config);
  const findings: SlackPreflightFinding[] = [];
  const appIdentities: SlackPreflightAppIdentity[] = [];

  await preflightDriver(config, client, findings, secrets);
  for (const app of config.apps) {
    const identity = await preflightApp(config, app, client, findings, secrets);
    if (identity) appIdentities.push(identity);
  }

  const ok = !findings.some((finding) => finding.severity === "error");
  return { ok, findings, appIdentities };
}

export class SlackWebApiClient implements SlackLiveApiClient {
  constructor(private readonly baseUrl = "https://slack.com/api") {}

  async authTest(token: string): Promise<SlackAuthIdentity> {
    const response = await this.callSlackApi("auth.test", token, {});
    return {
      teamId: stringField(response, "team_id") ?? "",
      userId: stringField(response, "user_id") ?? "",
      botId: stringField(response, "bot_id"),
    };
  }

  async authScopes(token: string): Promise<string[] | undefined> {
    try {
      const response = await this.callSlackApi("auth.scopes", token, {});
      return [...new Set(flattenScopeValues(response))];
    } catch (error) {
      if (!(error instanceof SlackApiError) || error.slackCode !== "unknown_method") throw error;
    }
    try {
      const response = await this.callSlackApi("apps.permissions.scopes.list", token, {});
      return [...new Set(flattenScopeValues(response))];
    } catch (error) {
      if (error instanceof SlackApiError && (error.slackCode === "unknown_method" || error.slackCode === "not_allowed_token_type" || error.slackCode === "missing_scope")) return undefined;
      throw error;
    }
  }

  async conversationsInfo(token: string, channelId: string): Promise<SlackConversationInfo> {
    const response = await this.callSlackApi("conversations.info", token, { channel: channelId });
    const channel = recordField(response, "channel");
    return { id: stringField(channel, "id") ?? channelId, isMember: booleanField(channel, "is_member") };
  }

  async appsConnectionsOpen(token: string): Promise<void> {
    await this.callSlackApi("apps.connections.open", token, {});
  }

  async postMessage(token: string, request: SlackPostMessageRequest): Promise<SlackPostMessageResponse> {
    const response = await this.callSlackApi("chat.postMessage", token, {
      channel: request.channel,
      text: request.text,
      thread_ts: request.threadTs,
    });
    return {
      ok: true,
      channel: stringField(response, "channel") ?? request.channel,
      ts: stringField(response, "ts") ?? "",
      message: slackMessageFromUnknown(recordField(response, "message")),
    };
  }

  async conversationsHistory(token: string, channelId: string, options: { oldest?: string; latest?: string; limit?: number } = {}): Promise<SlackHistoryMessage[]> {
    const response = await this.callSlackApi("conversations.history", token, {
      channel: channelId,
      oldest: options.oldest,
      latest: options.latest,
      limit: options.limit ?? 100,
      inclusive: true,
    });
    const messages = arrayField(response, "messages");
    return messages.map(slackMessageFromUnknown).filter((message): message is SlackHistoryMessage => Boolean(message));
  }

  private async callSlackApi(method: string, token: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: formEncode(removeUndefined(body)),
    });
    if (!response.ok) throw new SlackApiError(method, `http_${response.status}`, `${method} failed with HTTP ${response.status}.`);
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) throw new SlackApiError(method, "invalid_response", `${method} returned a non-object response.`);
    if (payload.ok === false) {
      const code = stringField(payload, "error") ?? "unknown_error";
      const needed = stringField(payload, "needed");
      const provided = stringField(payload, "provided");
      throw new SlackApiError(method, code, slackApiFailureMessage(method, code, needed, provided), needed, provided);
    }
    return payload;
  }
}

export function redactSlackLiveText(text: string, secrets: readonly string[] = []): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length >= 4) redacted = redacted.split(secret).join(REDACTION);
  }
  for (const pattern of SLACK_SECRET_PATTERNS) redacted = redacted.replace(pattern, REDACTION);
  return redacted;
}

export function redactSlackLiveValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactSlackLiveText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactSlackLiveValue(item, secrets));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = secretishKey(key) ? REDACTION : redactSlackLiveValue(item, secrets);
  }
  return output;
}

export function slackLiveSecrets(config: SlackLiveSuiteConfig): string[] {
  return [
    config.driverToken,
    ...config.apps.flatMap((app) => [app.botToken, app.signingSecret, app.appLevelToken].filter((value): value is string => Boolean(value))),
  ];
}

async function preflightDriver(config: SlackLiveSuiteConfig, client: SlackLiveApiClient, findings: SlackPreflightFinding[], secrets: readonly string[]): Promise<void> {
  try {
    const identity = await client.authTest(config.driverToken);
    checkWorkspace(config.workspaceId, identity.teamId, findings, "driver");
    const scopes = await client.authScopes(config.driverToken);
    pushMissingScopes(findings, "driver", scopes, ["chat:write"]);
    findings.push({ severity: "ok", code: "slack-live-driver-authenticated", message: "Slack live driver token is installed and can send test prompts." });
  } catch (error) {
    findings.push(slackPreflightErrorFinding(error, "driver", "Slack live driver token cannot access the workspace or send prompts.", secrets));
  }
}

async function preflightApp(config: SlackLiveSuiteConfig, app: SlackLiveAppConfig, client: SlackLiveApiClient, findings: SlackPreflightFinding[], secrets: readonly string[]): Promise<SlackPreflightAppIdentity | undefined> {
  let identity: SlackAuthIdentity | undefined;
  try {
    identity = await client.authTest(app.botToken);
    checkWorkspace(config.workspaceId, identity.teamId, findings, app.instanceId);
    if (app.expectedBotUserId && app.expectedBotUserId !== identity.userId) {
      findings.push({ severity: "error", code: "slack-live-bot-user-mismatch", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} authenticated as ${identity.userId}, not expected bot user ${app.expectedBotUserId}.` });
    }
    findings.push({ severity: "ok", code: "slack-live-app-installed", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} is installed in the expected workspace.` });
  } catch (error) {
    findings.push(slackPreflightErrorFinding(error, app.instanceId, `Slack app ${app.displayName} is not installed or cannot access the workspace.`, secrets));
    return undefined;
  }

  try {
    const scopes = await client.authScopes(app.botToken);
    pushMissingScopes(findings, app.instanceId, scopes, requiredBotScopes(config.channelId));
  } catch (error) {
    findings.push(slackPreflightErrorFinding(error, app.instanceId, `Slack app ${app.displayName} scopes cannot be inspected.`, secrets));
  }

  try {
    const info = await client.conversationsInfo(app.botToken, config.channelId);
    if (info.isMember !== true) {
      findings.push({ severity: "error", code: "slack-live-channel-membership-missing", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} is not a member of channel ${config.channelId}; invite it before running live traffic.` });
    } else {
      findings.push({ severity: "ok", code: "slack-live-channel-membership-ok", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} can observe channel ${config.channelId}.` });
    }
  } catch (error) {
    findings.push(slackPreflightErrorFinding(error, app.instanceId, `Slack app ${app.displayName} cannot inspect channel ${config.channelId}; check channel membership and read scopes.`, secrets));
  }

  if (config.eventMode === "socket") {
    if (!app.appLevelToken) {
      findings.push({ severity: "error", code: "slack-live-event-delivery-token-missing", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} is missing an app-level Socket Mode token; event delivery cannot be validated.` });
    } else {
      try {
        await client.appsConnectionsOpen(app.appLevelToken);
        findings.push({ severity: "ok", code: "slack-live-event-delivery-ok", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} accepted a Socket Mode connection preflight.` });
      } catch (error) {
        findings.push(slackPreflightErrorFinding(error, app.instanceId, `Slack app ${app.displayName} Socket Mode token cannot open an event connection; check Socket Mode and connections:write.`, secrets));
      }
    }
  } else if (!app.signingSecret) {
    findings.push({ severity: "error", code: "slack-live-signing-secret-missing", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} is missing a signing secret for webhook event verification.` });
  } else {
    findings.push({ severity: "ok", code: "slack-live-signing-secret-present", appInstanceId: app.instanceId, message: `Slack app ${app.displayName} has webhook signing configured for local verification.` });
  }

  return { ...identity, instanceId: app.instanceId, displayName: app.displayName };
}

function slackPreflightErrorFinding(error: unknown, appInstanceId: string, fallback: string, secrets: readonly string[]): SlackPreflightFinding {
  if (error instanceof SlackApiError) {
    return {
      severity: "error",
      code: `slack-live-${error.slackCode}`,
      appInstanceId,
      message: redactSlackLiveText(`${fallback} Slack API ${error.method} reported ${error.slackCode}${error.needed ? ` (needed: ${error.needed})` : ""}.`, secrets),
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { severity: "error", code: "slack-live-preflight-failed", appInstanceId, message: redactSlackLiveText(`${fallback} ${detail}`, secrets) };
}

function requiredBotScopes(channelId: string): string[] {
  const channelScopes = channelId.startsWith("G") ? ["groups:read", "groups:history"] : ["channels:read", "channels:history"];
  return ["chat:write", "app_mentions:read", ...channelScopes];
}

function pushMissingScopes(findings: SlackPreflightFinding[], appInstanceId: string, scopes: readonly string[] | undefined, requiredScopes: readonly string[]): void {
  if (!scopes) {
    findings.push({ severity: "warning", code: "slack-live-scope-inspection-unavailable", appInstanceId, message: `Slack app ${appInstanceId} scopes could not be inspected via Web API; channel/posting preflight will still validate usable access.` });
    return;
  }
  const actual = new Set(scopes);
  const missing = requiredScopes.filter((scope) => !actual.has(scope));
  if (missing.length > 0) {
    findings.push({ severity: "error", code: "slack-live-scopes-missing", appInstanceId, message: `Slack app ${appInstanceId} is missing required scope(s): ${missing.join(", ")}.` });
    return;
  }
  findings.push({ severity: "ok", code: "slack-live-scopes-ok", appInstanceId, message: `Slack app ${appInstanceId} has the required live-test scopes.` });
}

function checkWorkspace(expectedWorkspaceId: string, actualWorkspaceId: string, findings: SlackPreflightFinding[], appInstanceId: string): void {
  if (actualWorkspaceId !== expectedWorkspaceId) {
    findings.push({ severity: "error", code: "slack-live-workspace-mismatch", appInstanceId, message: `Slack token belongs to workspace ${actualWorkspaceId || "unknown"}, not expected workspace ${expectedWorkspaceId}.` });
  }
}

function slackApiFailureMessage(method: string, code: string, needed?: string, provided?: string): string {
  const scopeText = needed ? ` Needed scopes: ${needed}.` : "";
  const providedText = provided ? ` Provided scopes: ${provided}.` : "";
  return `${method} failed: ${code}.${scopeText}${providedText}`;
}

function readSlackLiveApp(env: NodeJS.ProcessEnv, role: SlackLiveAppRole, suffix: "A" | "B", prefix: string): SlackLiveAppConfig {
  return {
    role,
    instanceId: env[`${prefix}_INSTANCE_ID`] ?? `slack-live-${role}`,
    displayName: env[`${prefix}_DISPLAY_NAME`] ?? `Slack live bot ${suffix}`,
    botToken: env[`${prefix}_TOKEN`]!,
    signingSecret: env[`${prefix}_SIGNING_SECRET`]!,
    appLevelToken: env[`${prefix}_APP_TOKEN`],
    expectedBotUserId: env[`${prefix}_USER_ID`],
    piCommand: env[`${prefix}_PI_COMMAND`]!,
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function formEncode(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    params.set(key, typeof value === "boolean" ? String(value) : String(value));
  }
  return params.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function booleanField(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function flattenScopeValues(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[ ,]+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(flattenScopeValues);
  if (isRecord(value)) {
    if (typeof value.scope === "string") return flattenScopeValues(value.scope);
    return Object.values(value).flatMap(flattenScopeValues);
  }
  return [];
}

function slackMessageFromUnknown(value: unknown): SlackHistoryMessage | undefined {
  if (!isRecord(value)) return undefined;
  const ts = stringField(value, "ts");
  if (!ts) return undefined;
  return {
    type: stringField(value, "type"),
    subtype: stringField(value, "subtype"),
    user: stringField(value, "user"),
    botId: stringField(value, "bot_id"),
    appId: stringField(value, "app_id"),
    text: stringField(value, "text"),
    ts,
    threadTs: stringField(value, "thread_ts"),
  };
}

function secretishKey(key: string): boolean {
  return /token|secret|authorization|cookie|payload|response_url|socket_url/i.test(key);
}

export interface SlackLivePiProcess {
  instanceId: string;
  stateDir: string;
  configPath: string;
  brokerNamespace?: string;
  child: ChildProcessWithoutNullStreams;
}

export class SlackLivePiHarness {
  private rootDir?: string;
  private readonly processes: SlackLivePiProcess[] = [];

  constructor(private readonly config: SlackLiveSuiteConfig) {}

  async start(): Promise<SlackLivePiProcess[]> {
    if (this.rootDir) throw new Error("Slack live Pi harness is already started.");
    this.rootDir = await mkdtemp(join(tmpdir(), "pirelay-slack-live-"));
    for (const app of this.config.apps) {
      const processInfo = await this.startInstance(app, this.rootDir);
      this.processes.push(processInfo);
    }
    return [...this.processes];
  }

  async stop(): Promise<void> {
    const processes = this.processes.splice(0);
    await Promise.all(processes.map((processInfo) => stopChild(processInfo.child)));
    await Promise.all(processes.map((processInfo) => stopNamespaceBrokerProcesses(processInfo)));
    if (this.rootDir) {
      await rm(this.rootDir, { recursive: true, force: true });
      this.rootDir = undefined;
    }
  }

  private async startInstance(app: SlackLiveAppConfig, rootDir: string): Promise<SlackLivePiProcess> {
    const instanceDir = join(rootDir, app.instanceId);
    const stateDir = join(instanceDir, "state");
    const configPath = join(instanceDir, "config.json");
    const brokerNamespace = this.config.realAgent ? slackLiveBrokerNamespace(app) : undefined;
    await mkdir(stateDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(slackLivePiConfig(this.config, app, stateDir), null, 2), { mode: 0o600 });
    const child = spawn(app.piCommand, {
      shell: true,
      detached: true,
      env: {
        ...process.env,
        PI_RELAY_CONFIG: configPath,
        PI_RELAY_STATE_DIR: stateDir,
        PI_RELAY_BROKER_NAMESPACE: brokerNamespace ?? "",
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
        PI_RELAY_MACHINE_ID: app.instanceId,
        PI_RELAY_MACHINE_DISPLAY_NAME: app.displayName,
        PI_RELAY_SLACK_ENABLED: "true",
        PI_RELAY_SLACK_BOT_TOKEN: app.botToken,
        PI_RELAY_SLACK_SIGNING_SECRET: app.signingSecret,
        PI_RELAY_SLACK_APP_TOKEN: app.appLevelToken ?? "",
        PI_RELAY_SLACK_BOT_USER_ID: app.expectedBotUserId ?? "",
        PI_RELAY_SLACK_HISTORY_FALLBACK: "true",
        PI_RELAY_SLACK_LIVE_PRESEEDED_BINDING: "true",
        PI_RELAY_SLACK_EVENT_MODE: this.config.eventMode,
        PI_RELAY_SLACK_WORKSPACE_ID: this.config.workspaceId,
        PI_RELAY_SLACK_ALLOW_USER_IDS: this.config.authorizedUserId,
        PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES: "true",
      },
    });
    attachDebugPipe(child, app.instanceId, slackLiveSecrets(this.config));
    return { instanceId: app.instanceId, stateDir, configPath, brokerNamespace, child };
  }
}

export function slackLiveBrokerNamespace(app: Pick<SlackLiveAppConfig, "instanceId">): string {
  return `slack-live-${app.instanceId}`.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 80);
}

export function slackLivePiConfig(config: SlackLiveSuiteConfig, app: SlackLiveAppConfig, stateDir: string): Record<string, unknown> {
  const brokerNamespace = config.realAgent ? slackLiveBrokerNamespace(app) : undefined;
  return {
    relay: {
      machineId: app.instanceId,
      displayName: app.displayName,
      aliases: [app.role, app.displayName],
      stateDir,
      brokerNamespace,
    },
    messengers: {
      slack: {
        default: {
          enabled: true,
          tokenEnv: "PI_RELAY_SLACK_BOT_TOKEN",
          signingSecretEnv: "PI_RELAY_SLACK_SIGNING_SECRET",
          appTokenEnv: "PI_RELAY_SLACK_APP_TOKEN",
          botUserId: app.expectedBotUserId,
          eventMode: config.eventMode,
          workspaceId: config.workspaceId,
          allowUserIds: [config.authorizedUserId],
          allowChannelMessages: true,
          sharedRoom: {
            enabled: true,
            roomHint: config.channelId,
            plainText: "addressed-only",
            machineAliases: [app.role, app.displayName],
          },
        },
      },
    },
  };
}

function attachDebugPipe(child: ChildProcessWithoutNullStreams, instanceId: string, secrets: readonly string[]): void {
  const path = process.env.PI_RELAY_SLACK_DEBUG_LOG;
  if (!path) return;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => appendFileSync(path, `${new Date().toISOString()} ${instanceId} stdout ${redactSlackLiveText(String(chunk), secrets)}\n`));
  child.stderr.on("data", (chunk) => appendFileSync(path, `${new Date().toISOString()} ${instanceId} stderr ${redactSlackLiveText(String(chunk), secrets)}\n`));
  child.on("exit", (code, signal) => appendFileSync(path, `${new Date().toISOString()} ${instanceId} exit code=${code ?? ""} signal=${signal ?? ""}\n`));
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) killChildProcessGroup(child, "SIGKILL");
    }, 1_000);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    killChildProcessGroup(child, "SIGTERM");
  });
}

async function stopNamespaceBrokerProcesses(processInfo: Pick<SlackLivePiProcess, "stateDir" | "brokerNamespace">): Promise<void> {
  if (!processInfo.brokerNamespace) return;
  let entries: string[];
  try {
    entries = await readdir(processInfo.stateDir);
  } catch {
    return;
  }
  const prefix = `broker-${processInfo.brokerNamespace}-`;
  const pidFiles = entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".pid"));
  await Promise.all(pidFiles.map(async (entry) => {
    const pidPath = join(processInfo.stateDir, entry);
    const raw = await readFile(pidPath, "utf8").catch(() => "");
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 0) return;
    await terminateProcessGroup(pid);
    await rm(pidPath, { force: true }).catch(() => undefined);
  }));
}

async function terminateProcessGroup(pid: number): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { return; }
  }
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killChildProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (child.pid === undefined) throw new Error("Child PID is unavailable.");
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Ignore already-exited children.
    }
  }
}

export type SlackLiveObservationKind = "slack-event" | "api-ack" | "message";

export interface SlackLiveObservation {
  kind: SlackLiveObservationKind;
  at: number;
  instanceId?: string;
  method?: string;
  payload: unknown;
}

export class SlackLiveObserver {
  private readonly observations: SlackLiveObservation[] = [];

  constructor(private readonly secrets: readonly string[] = []) {}

  recordSlackEvent(instanceId: string, payload: unknown): void {
    this.record({ kind: "slack-event", instanceId, payload });
  }

  recordApiAcknowledgement(instanceId: string, method: string, payload: unknown): void {
    this.record({ kind: "api-ack", instanceId, method, payload });
  }

  recordPostedMessages(messages: readonly SlackHistoryMessage[]): void {
    for (const message of messages) {
      this.record({ kind: "message", instanceId: message.user, payload: message });
    }
  }

  async pollChannelHistory(client: SlackLiveApiClient, token: string, channelId: string, options?: { oldest?: string; latest?: string; limit?: number }): Promise<SlackHistoryMessage[]> {
    const messages = await client.conversationsHistory(token, channelId, options);
    this.recordPostedMessages(messages);
    return messages;
  }

  snapshot(): SlackLiveObservation[] {
    return this.observations.map((observation) => ({ ...observation, payload: redactSlackLiveValue(observation.payload, this.secrets) }));
  }

  private record(input: Omit<SlackLiveObservation, "at">): void {
    this.observations.push({ ...input, at: Date.now(), payload: redactSlackLiveValue(input.payload, this.secrets) });
  }
}

export interface SlackTargetedFlowExpectation {
  runId: string;
  targetBotUserId: string;
  nonTargetBotUserId: string;
  expectedReplyIncludes: string;
  forbiddenReplyText?: readonly string[];
}

export interface SlackAssertionResult {
  ok: boolean;
  failures: string[];
}

export function assertSlackTargetedMessageFlow(observations: readonly SlackLiveObservation[], expectation: SlackTargetedFlowExpectation): SlackAssertionResult {
  const messages = observations.flatMap((observation) => observation.kind === "message" ? [observation.payload] : [])
    .map(slackMessageFromUnknown)
    .filter((message): message is SlackHistoryMessage => Boolean(message));
  const failures: string[] = [];
  const targetReply = messages.some((message) => message.user === expectation.targetBotUserId && includesAll(message.text, [expectation.runId, expectation.expectedReplyIncludes]));
  if (!targetReply) failures.push(`Expected target Slack bot ${expectation.targetBotUserId} to reply with ${expectation.expectedReplyIncludes} for ${expectation.runId}.`);
  for (const forbidden of expectation.forbiddenReplyText ?? []) {
    const forbiddenReply = messages.find((message) => message.user === expectation.targetBotUserId && (message.text ?? "").includes(forbidden));
    if (forbiddenReply) failures.push(`Target Slack bot ${expectation.targetBotUserId} emitted forbidden text ${forbidden} at ${forbiddenReply.ts}.`);
  }
  const nonTargetReply = messages.find((message) => message.user === expectation.nonTargetBotUserId && includesAll(message.text, [expectation.runId]));
  if (nonTargetReply) failures.push(`Non-target Slack bot ${expectation.nonTargetBotUserId} emitted an unexpected reply at ${nonTargetReply.ts}.`);
  return { ok: failures.length === 0, failures };
}

export interface SlackFinalStateExpectation {
  requiredText: readonly string[];
  forbiddenText?: readonly string[];
  forbiddenBotUserIds: readonly string[];
  runId: string;
}

export function assertSlackFinalChannelState(observations: readonly SlackLiveObservation[], expectation: SlackFinalStateExpectation): SlackAssertionResult {
  const messages = observations.flatMap((observation) => observation.kind === "message" ? [observation.payload] : [])
    .map(slackMessageFromUnknown)
    .filter((message): message is SlackHistoryMessage => Boolean(message));
  const text = messages.map((message) => message.text ?? "").join("\n");
  const failures = expectation.requiredText
    .filter((required) => !text.includes(required))
    .map((required) => `Expected final Slack channel state to contain ${required}.`);
  for (const forbidden of expectation.forbiddenText ?? []) {
    if (text.includes(forbidden)) failures.push(`Expected final Slack channel state not to contain ${forbidden}.`);
  }
  for (const userId of expectation.forbiddenBotUserIds) {
    const unexpected = messages.find((message) => message.user === userId && (message.text ?? "").includes(expectation.runId));
    if (unexpected) failures.push(`Forbidden Slack bot ${userId} posted for ${expectation.runId} at ${unexpected.ts}.`);
  }
  return { ok: failures.length === 0, failures };
}

function includesAll(text: string | undefined, fragments: readonly string[]): boolean {
  return fragments.every((fragment) => (text ?? "").includes(fragment));
}
