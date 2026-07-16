import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ChannelBinding } from "./channel-adapter.js";
import type { ChannelActiveSelectionRecord, ChannelPersistedBindingRecord, PersistedBindingRecord, TunnelStoreData } from "./types.js";

export type SessionHandoffReason = "local-new" | "remote-new";

export interface SessionHandoffBindingSummary {
  channel: ChannelBinding["channel"];
  instanceId: string;
  conversationId: string;
  userId: string;
  paused: boolean;
}

export interface PendingSessionHandoff {
  id: string;
  oldSessionKey: string;
  oldSessionId: string;
  oldSessionFile?: string;
  oldSessionLabel: string;
  runtimeInstanceId: string;
  machineId: string;
  workspaceRoot: string;
  reason: SessionHandoffReason;
  requester?: SessionHandoffBindingSummary;
  bindings: SessionHandoffBindingSummary[];
  activeSelections: ChannelActiveSelectionRecord[];
  createdAt: number;
  expiresAt: number;
  explicitDisconnect?: boolean;
}

export interface ReplacementSessionIdentity {
  sessionKey: string;
  runtimeInstanceId: string;
  machineId: string;
  workspaceRoot: string;
}

export type PendingHandoffMatch =
  | { kind: "matched"; handoff: PendingSessionHandoff }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: PendingSessionHandoff[] };

interface RegisteredPendingHandoff {
  handoff: PendingSessionHandoff;
  timeout?: ReturnType<typeof setTimeout>;
  onExpire?: (handoff: PendingSessionHandoff) => void | Promise<void>;
}

const pendingHandoffs = new Map<string, RegisteredPendingHandoff>();
export const relayRuntimeInstanceId = randomUUID();
export const DEFAULT_SESSION_HANDOFF_TTL_MS = 5_000;

export function normalizeWorkspaceRoot(path: string): string {
  return resolve(path);
}

export function createPendingSessionHandoff(input: Omit<PendingSessionHandoff, "id" | "workspaceRoot" | "createdAt" | "expiresAt"> & {
  workspaceRoot: string;
  now?: number;
  ttlMs?: number;
}): PendingSessionHandoff {
  const createdAt = input.now ?? Date.now();
  return {
    ...input,
    id: randomUUID(),
    workspaceRoot: normalizeWorkspaceRoot(input.workspaceRoot),
    createdAt,
    expiresAt: createdAt + (input.ttlMs ?? DEFAULT_SESSION_HANDOFF_TTL_MS),
  };
}

export function bindingSummariesForSession(data: TunnelStoreData, sessionKey: string): SessionHandoffBindingSummary[] {
  const summaries: SessionHandoffBindingSummary[] = [];
  const telegram = data.bindings[sessionKey];
  if (telegram?.status === "active") summaries.push(telegramBindingSummary(telegram));
  for (const binding of Object.values(data.channelBindings)) {
    if (binding.sessionKey === sessionKey && binding.status === "active") summaries.push(channelBindingSummary(binding));
  }
  return summaries;
}

export function activeSelectionsForSession(data: TunnelStoreData, sessionKey: string): ChannelActiveSelectionRecord[] {
  return Object.values(data.activeChannelSelections).filter((selection) => selection.sessionKey === sessionKey);
}

export function matchPendingSessionHandoffs(candidates: readonly PendingSessionHandoff[], replacement: ReplacementSessionIdentity, now = Date.now()): PendingHandoffMatch {
  const workspaceRoot = normalizeWorkspaceRoot(replacement.workspaceRoot);
  const matches = candidates.filter((candidate) => !candidate.explicitDisconnect
    && candidate.expiresAt > now
    && candidate.oldSessionKey !== replacement.sessionKey
    && candidate.runtimeInstanceId === replacement.runtimeInstanceId
    && candidate.machineId === replacement.machineId
    && candidate.workspaceRoot === workspaceRoot
    && candidate.bindings.length > 0);
  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  return { kind: "matched", handoff: matches[0]! };
}

export function registerPendingSessionHandoff(handoff: PendingSessionHandoff, onExpire?: (handoff: PendingSessionHandoff) => void | Promise<void>): void {
  removePendingSessionHandoff(handoff.id);
  const delay = Math.max(0, handoff.expiresAt - Date.now());
  const timeout = onExpire ? setTimeout(async () => {
    await expirePendingSessionHandoff(handoff.id);
  }, delay) : undefined;
  timeout?.unref?.();
  pendingHandoffs.set(handoff.id, { handoff, timeout, onExpire });
}

export function findPendingSessionHandoff(replacement: ReplacementSessionIdentity, now = Date.now()): PendingHandoffMatch {
  pruneExpiredPendingSessionHandoffs(now);
  return matchPendingSessionHandoffs([...pendingHandoffs.values()].map((entry) => entry.handoff), replacement, now);
}

export function takePendingSessionHandoff(replacement: ReplacementSessionIdentity, now = Date.now()): PendingHandoffMatch {
  const match = findPendingSessionHandoff(replacement, now);
  if (match.kind === "matched") removePendingSessionHandoff(match.handoff.id);
  return match;
}

export function removePendingSessionHandoff(id: string): PendingSessionHandoff | undefined {
  const entry = pendingHandoffs.get(id);
  if (!entry) return undefined;
  if (entry.timeout) clearTimeout(entry.timeout);
  pendingHandoffs.delete(id);
  return entry.handoff;
}

export function removePendingSessionHandoffsForSession(sessionKey: string): PendingSessionHandoff[] {
  const removed: PendingSessionHandoff[] = [];
  for (const entry of [...pendingHandoffs.values()]) {
    if (entry.handoff.oldSessionKey !== sessionKey) continue;
    const handoff = removePendingSessionHandoff(entry.handoff.id);
    if (handoff) removed.push(handoff);
  }
  return removed;
}

export function listPendingSessionHandoffs(): PendingSessionHandoff[] {
  pruneExpiredPendingSessionHandoffs();
  return [...pendingHandoffs.values()].map((entry) => entry.handoff);
}

function pruneExpiredPendingSessionHandoffs(now = Date.now()): void {
  void expirePendingSessionHandoffs(now);
}

export async function expirePendingSessionHandoffs(now = Date.now()): Promise<void> {
  const expired = [...pendingHandoffs.values()].filter((entry) => entry.handoff.expiresAt <= now);
  await Promise.all(expired.map((entry) => expirePendingSessionHandoff(entry.handoff.id)));
}

async function expirePendingSessionHandoff(id: string): Promise<void> {
  const entry = pendingHandoffs.get(id);
  if (!entry) return;
  if (entry.timeout) clearTimeout(entry.timeout);
  pendingHandoffs.delete(id);
  if (entry.onExpire) await Promise.resolve(entry.onExpire(entry.handoff)).catch(() => undefined);
}

function telegramBindingSummary(binding: PersistedBindingRecord): SessionHandoffBindingSummary {
  return { channel: "telegram", instanceId: "default", conversationId: String(binding.chatId), userId: String(binding.userId), paused: Boolean(binding.paused) };
}

function channelBindingSummary(binding: ChannelPersistedBindingRecord): SessionHandoffBindingSummary {
  return { channel: binding.channel, instanceId: binding.instanceId ?? "default", conversationId: binding.conversationId, userId: binding.userId, paused: Boolean(binding.paused) };
}
