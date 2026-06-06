import type { ChannelBinding } from "./channel-adapter.js";
import type { RelayFileDeliveryRequester } from "./requester-file-delivery.js";
import type { DeliveryMode, SessionRoute, TelegramTunnelConfig } from "./types.js";
import { deliverRoutePrompt, routeActionDisplayMessage, type RouteActionOutcome } from "./route-actions.js";

export type RemoteSkillSource = "project" | "user" | "package" | "temporary" | "unknown";

export interface RemoteSkillConfig {
  enabled?: boolean;
  allow?: string[];
  deny?: string[];
  sources?: RemoteSkillSource[];
  maxList?: number;
  pendingInputExpiryMs?: number;
  requireConfirmation?: string[];
}

export interface ResolvedRemoteSkillConfig {
  enabled: boolean;
  allow: string[];
  deny: string[];
  sources: RemoteSkillSource[];
  maxList: number;
  pendingInputExpiryMs: number;
  requireConfirmation: string[];
}

export interface SkillCommandMetadata {
  name: string;
  description?: string;
  source?: string;
  sourceInfo?: { scope?: string; source?: string; origin?: string; path?: string };
}

export interface RemoteSkillSummary {
  name: string;
  description?: string;
  source: RemoteSkillSource;
  requiresConfirmation: boolean;
}

export type SkillResolveResult =
  | { kind: "ok"; skill: RemoteSkillSummary }
  | { kind: "disabled"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "ambiguous"; message: string; matches: RemoteSkillSummary[] }
  | { kind: "confirmation-required"; message: string; skill: RemoteSkillSummary };

export type SkillListResult =
  | { kind: "ok"; skills: RemoteSkillSummary[]; message: string }
  | { kind: "disabled"; skills: []; message: string }
  | { kind: "empty"; skills: []; message: string };

export type SkillInvocationOutcome =
  | RouteActionOutcome<{ deliverAs?: DeliveryMode; skill: RemoteSkillSummary }>
  | { kind: "disabled" | "not-found" | "ambiguous" | "confirmation-required"; message: string; matches?: RemoteSkillSummary[]; skill?: RemoteSkillSummary };

export type SkillListCommandStyle = "slash" | "relay-prefix";

const DEFAULT_MAX_SKILL_LIST = 20;
const DEFAULT_PENDING_INPUT_EXPIRY_MS = 2 * 60_000;
const MAX_DESCRIPTION_CHARS = 160;
const MAX_AMBIGUOUS_SKILL_MATCHES = 10;
const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function resolveRemoteSkillConfig(config: RemoteSkillConfig | undefined): ResolvedRemoteSkillConfig {
  return {
    enabled: config?.enabled ?? false,
    allow: normalizeNameList(config?.allow),
    deny: normalizeNameList(config?.deny),
    sources: normalizeSources(config?.sources),
    maxList: boundedInteger(config?.maxList, DEFAULT_MAX_SKILL_LIST, 1, 50),
    pendingInputExpiryMs: boundedInteger(config?.pendingInputExpiryMs, DEFAULT_PENDING_INPUT_EXPIRY_MS, 10_000, 10 * 60_000),
    requireConfirmation: normalizeNameList(config?.requireConfirmation),
  };
}

export function skillConfigForRelay(config: Pick<TelegramTunnelConfig, "skills">): ResolvedRemoteSkillConfig {
  return resolveRemoteSkillConfig(config.skills);
}

export function remoteSkillSource(command: SkillCommandMetadata): RemoteSkillSource {
  const scope = command.sourceInfo?.scope;
  if (scope === "project" || scope === "user" || scope === "temporary") return scope;
  const source = command.sourceInfo?.source ?? command.source;
  if (source === "package") return "package";
  return "unknown";
}

export function safeSkillDescription(description: string | undefined): string | undefined {
  const normalized = (description ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_DESCRIPTION_CHARS) return normalized;
  return `${normalized.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name);
}

export function filterRemoteSkills(commands: SkillCommandMetadata[], config: ResolvedRemoteSkillConfig): RemoteSkillSummary[] {
  const skills = resolvePolicyAllowedSkills(commands, config);
  return skills.slice(0, config.maxList);
}

export function listRemoteSkills(commands: SkillCommandMetadata[], config: ResolvedRemoteSkillConfig): SkillListResult {
  if (!config.enabled) return { kind: "disabled", skills: [], message: "Remote skill invocation is disabled." };
  const skills = filterRemoteSkills(commands, config);
  if (skills.length === 0) return { kind: "empty", skills: [], message: "No remote-invokable skills are available for this session." };
  return { kind: "ok", skills, message: formatSkillList(skills) };
}

export function resolveRemoteSkill(name: string, commands: SkillCommandMetadata[], config: ResolvedRemoteSkillConfig, options: { allowConfirmationRequired?: boolean } = {}): SkillResolveResult {
  if (!config.enabled) return { kind: "disabled", message: "Remote skill invocation is disabled." };
  const normalized = normalizeSkillName(name);
  if (!normalized || !isValidSkillName(normalized)) return { kind: "not-found", message: "Skill name is invalid or unavailable for remote invocation." };
  const skills = resolvePolicyAllowedSkills(commands, config);
  const exact = skills.find((skill) => skill.name === normalized);
  const matches = exact ? [exact] : skills.filter((skill) => skill.name.startsWith(normalized));
  if (matches.length === 0) return { kind: "not-found", message: `Skill ${quoteName(normalized)} is not available for remote invocation.` };
  if (matches.length > 1) return { kind: "ambiguous", message: `Skill ${quoteName(normalized)} is ambiguous. Matches: ${formatAmbiguousSkillMatches(matches)}.`, matches };
  const skill = matches[0]!;
  if (skill.requiresConfirmation && !options.allowConfirmationRequired) return { kind: "confirmation-required", message: `Skill ${quoteName(skill.name)} requires confirmation before remote invocation.`, skill };
  return { kind: "ok", skill };
}

export async function invokeRemoteSkill(route: SessionRoute, commands: SkillCommandMetadata[], config: ResolvedRemoteSkillConfig, request: { name: string; input: string; deliveryMode?: DeliveryMode; requester?: RelayFileDeliveryRequester }): Promise<SkillInvocationOutcome> {
  const resolved = resolveRemoteSkill(request.name, commands, config);
  if (resolved.kind !== "ok") return resolved;
  if (route.binding?.paused) return { kind: "unavailable", message: "Remote delivery is currently paused for this binding. Resume remote delivery from the paired chat or disconnect locally." };
  const prompt = buildSkillInvocationPrompt(resolved.skill.name, request.input);
  const outcome = await deliverRoutePrompt(route, { content: prompt, deliverAs: request.deliveryMode, requester: request.requester, passUndefinedOptions: true });
  if (outcome.kind !== "success") return outcome;
  return { kind: "success", result: { deliverAs: outcome.result.deliverAs, skill: resolved.skill } };
}

export function buildSkillInvocationPrompt(name: string, input: string): string {
  const trimmed = input.trim();
  return [`Use the local Pi skill /skill:${name}${trimmed ? " with this input:" : "."}`, trimmed].filter(Boolean).join("\n\n");
}

export function formatSkillList(skills: RemoteSkillSummary[], options: { commandStyle?: SkillListCommandStyle } = {}): string {
  const lines = ["Available remote skills:"];
  for (const skill of skills) {
    const suffix = skill.description ? ` — ${skill.description}` : "";
    lines.push(`- ${skill.name}${suffix}`);
  }
  lines.push("", formatSkillListGuidance(options.commandStyle ?? "slash"));
  return lines.join("\n");
}

function formatSkillListGuidance(commandStyle: SkillListCommandStyle): string {
  if (commandStyle === "relay-prefix") return "Use relay skill <name> <input>, or relay skill <name> to send input as your next message. Use relay skills to list available skills.";
  return "Use /skill <name> <input>, or /skill <name> to send input as your next message.";
}

function formatAmbiguousSkillMatches(matches: RemoteSkillSummary[]): string {
  const visible = matches.slice(0, MAX_AMBIGUOUS_SKILL_MATCHES).map((skill) => skill.name).join(", ");
  const remaining = matches.length - MAX_AMBIGUOUS_SKILL_MATCHES;
  return remaining > 0 ? `${visible}, and ${remaining} more` : visible;
}

export function formatSkillInvocationAccepted(skill: RemoteSkillSummary, deliverAs?: DeliveryMode): string {
  const suffix = deliverAs ? ` (${deliverAs})` : "";
  return `Skill ${quoteName(skill.name)} invocation accepted${suffix}.`;
}

export function formatSkillOutcome(outcome: SkillInvocationOutcome): string {
  if (outcome.kind === "success") return formatSkillInvocationAccepted(outcome.result.skill, outcome.result.deliverAs);
  if (outcome.kind === "unavailable" || outcome.kind === "already-idle" || outcome.kind === "failed") return routeActionDisplayMessage(outcome);
  return outcome.message;
}

export interface PendingSkillInputKey {
  channel: ChannelBinding["channel"] | "telegram";
  instanceId?: string;
  conversationId: string;
  userId: string;
  sessionKey: string;
}

export interface PendingSkillInput extends PendingSkillInputKey {
  skillName: string;
  expiresAt: number;
}

export function pendingSkillInputKey(key: PendingSkillInputKey): string {
  return [key.channel, key.instanceId ?? "default", key.conversationId, key.userId, key.sessionKey].join(":");
}

export function isPendingSkillInputExpired(pending: Pick<PendingSkillInput, "expiresAt">, now = Date.now()): boolean {
  return pending.expiresAt <= now;
}

function resolvePolicyAllowedSkills(commands: SkillCommandMetadata[], config: ResolvedRemoteSkillConfig): RemoteSkillSummary[] {
  if (!config.enabled) return [];
  const allow = new Set(config.allow);
  const deny = new Set(config.deny);
  const allowedSources = new Set(config.sources);
  const confirmation = new Set(config.requireConfirmation);
  const seen = new Set<string>();
  const skills: RemoteSkillSummary[] = [];
  for (const command of commands) {
    const name = normalizeSkillName(command.name);
    if (!name || !isValidSkillName(name) || seen.has(name)) continue;
    if (allow.size > 0 && !allow.has(name)) continue;
    if (deny.has(name)) continue;
    const source = remoteSkillSource(command);
    if (allowedSources.size > 0 && !allowedSources.has(source)) continue;
    seen.add(name);
    skills.push({
      name,
      description: safeSkillDescription(command.description),
      source,
      requiresConfirmation: confirmation.has(name),
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeSkillName(name: string): string | undefined {
  const normalized = name.trim().replace(/^\/?skill:/, "").toLowerCase();
  return normalized || undefined;
}

function normalizeNameList(values: string[] | undefined): string[] {
  const normalized: string[] = [];
  for (const value of values ?? []) {
    const name = normalizeSkillName(value);
    if (name && isValidSkillName(name)) normalized.push(name);
  }
  return [...new Set(normalized)];
}

function normalizeSources(values: RemoteSkillSource[] | undefined): RemoteSkillSource[] {
  const allowed = new Set<RemoteSkillSource>(["project", "user", "package", "temporary", "unknown"]);
  return [...new Set((values ?? []).filter((value) => allowed.has(value)))];
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value === undefined) return fallback;
  return Math.min(max, Math.max(min, value));
}

function quoteName(name: string): string {
  return `\`${name}\``;
}
