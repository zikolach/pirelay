import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { ensureParentDir, ensureStateDir, getStateFilePath } from "./paths.js";
import type { ChannelBinding } from "../core/channel-adapter.js";
import { authorityOutcomeAllowsDelivery, bindingAuthorityStateFromData, resolveChannelBindingAuthority, resolveTelegramBindingAuthority, stateUnavailableBindingAuthority, type BindingAuthorityState } from "../core/binding-authority.js";
import { channelBindingStorageKey, legacyChannelBindingStorageKey } from "../broker/channel-registry.js";
import { decideRelayLifecycleNotification, relayLifecycleStorageKey, type RelayLifecycleEventKind, type RelayLifecycleNotificationDecision } from "../notifications/lifecycle.js";
import type { ChannelActiveSelectionRecord, ChannelPersistedBindingRecord, PendingPairingRecord, PersistedBindingRecord, SetupCache, TelegramBindingMetadata, TrustedRelayUserRecord, TunnelStoreData } from "../core/types.js";
import { markDelegationTaskStaleAfterRestart, type DelegationTaskAuditEvent, type DelegationTaskRecord } from "../core/agent-delegation.js";
import { createPairingNonce, createPairingPin, sessionKeyOf, sha256, toIsoNow } from "../core/utils.js";

function emptyStore(): TunnelStoreData {
  return {
    pendingPairings: {},
    bindings: {},
    channelBindings: {},
    activeChannelSelections: {},
    trustedRelayUsers: {},
    lifecycleNotifications: {},
    delegationTasks: {},
    delegationAudit: [],
  };
}

function parseStoreData(raw: string): TunnelStoreData {
  const parsed = JSON.parse(raw) as Partial<TunnelStoreData>;
  return {
    setup: parsed.setup,
    pendingPairings: parsed.pendingPairings ?? {},
    bindings: parsed.bindings ?? {},
    channelBindings: parsed.channelBindings ?? {},
    activeChannelSelections: parsed.activeChannelSelections ?? {},
    trustedRelayUsers: parsed.trustedRelayUsers ?? {},
    lifecycleNotifications: parsed.lifecycleNotifications ?? {},
    delegationTasks: parsed.delegationTasks ?? {},
    delegationAudit: parsed.delegationAudit ?? [],
  };
}

export type PendingPairingInspection =
  | { status: "active"; pairing: PendingPairingRecord }
  | { status: "missing" | "wrong-channel" | "consumed" | "expired"; pairing?: PendingPairingRecord };

export class TunnelStateStore {
  private static readonly updateQueues = new Map<string, Promise<void>>();

  constructor(private readonly stateDir: string) {}

  private get filePath(): string {
    return getStateFilePath(this.stateDir);
  }

  async load(): Promise<TunnelStoreData> {
    const snapshot = await this.loadBindingAuthoritySnapshot();
    return snapshot.kind === "loaded" ? snapshot.data : emptyStore();
  }

  async loadBindingAuthoritySnapshot(): Promise<BindingAuthorityState> {
    try {
      await ensureStateDir(this.stateDir);
      return bindingAuthorityStateFromData(parseStoreData(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (isMissingFileError(error)) return bindingAuthorityStateFromData(emptyStore(), { missing: true });
      return stateUnavailableBindingAuthority(error);
    }
  }

  private loadExistingSync(): TunnelStoreData {
    try {
      return parseStoreData(readFileSync(this.filePath, "utf8"));
    } catch {
      return emptyStore();
    }
  }

  async save(data: TunnelStoreData): Promise<void> {
    await ensureParentDir(this.filePath);
    await writeFile(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async update(mutator: (data: TunnelStoreData) => void | Promise<void>): Promise<TunnelStoreData> {
    const previous = TunnelStateStore.updateQueues.get(this.stateDir) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const currentQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const queued = previous.then(() => currentQueue, () => currentQueue);
    TunnelStateStore.updateQueues.set(this.stateDir, queued);
    await previous.catch(() => undefined);
    try {
      await ensureStateDir(this.stateDir);
      const releaseLock = await lockfile.lock(this.stateDir, { realpath: false, stale: 60_000, retries: { retries: 10, minTimeout: 10, maxTimeout: 100 } });
      try {
        const current = await this.load();
        await mutator(current);
        await this.save(current);
        return current;
      } finally {
        await releaseLock();
      }
    } finally {
      releaseQueue();
      if (TunnelStateStore.updateQueues.get(this.stateDir) === queued) {
        TunnelStateStore.updateQueues.delete(this.stateDir);
      }
    }
  }

  async setSetup(setup: SetupCache): Promise<void> {
    await this.update((data) => {
      data.setup = setup;
    });
  }

  async getSetup(): Promise<SetupCache | undefined> {
    return (await this.load()).setup;
  }

  async cleanupExpiredPairings(): Promise<void> {
    await this.update((data) => {
      const now = Date.now();
      for (const [key, pairing] of Object.entries(data.pendingPairings)) {
        if (Date.parse(pairing.expiresAt) <= now || pairing.consumedAt) {
          delete data.pendingPairings[key];
        }
      }
    });
  }

  async createPendingPairing(input: {
    channel?: PendingPairingRecord["channel"];
    sessionId: string;
    sessionFile?: string;
    sessionLabel: string;
    expiryMs: number;
    codeKind?: PendingPairingRecord["codeKind"];
  }): Promise<{ nonce: string; pairing: PendingPairingRecord }> {
    const nonce = input.codeKind === "pin" ? createPairingPin() : createPairingNonce();
    const nonceHash = sha256(nonce);
    const sessionKey = sessionKeyOf(input.sessionId, input.sessionFile);
    const createdAt = toIsoNow();
    const pairing: PendingPairingRecord = {
      nonceHash,
      codeKind: input.codeKind ?? "nonce",
      channel: input.channel,
      sessionKey,
      sessionId: input.sessionId,
      sessionFile: input.sessionFile,
      sessionLabel: input.sessionLabel,
      createdAt,
      expiresAt: new Date(Date.now() + input.expiryMs).toISOString(),
    };

    await this.update((data) => {
      for (const [key, candidate] of Object.entries(data.pendingPairings)) {
        if (candidate.sessionKey === sessionKey) delete data.pendingPairings[key];
      }
      data.pendingPairings[nonceHash] = pairing;
    });

    return { nonce, pairing };
  }

  async inspectPendingPairing(nonce: string, options: { channel?: PendingPairingRecord["channel"] } = {}): Promise<PendingPairingInspection> {
    const data = await this.load();
    const pairing = findPendingPairingByCode(data, nonce);
    if (!pairing) return { status: "missing" };
    if (options.channel && pairing.channel && pairing.channel !== options.channel) return { status: "wrong-channel", pairing };
    if (pairing.consumedAt) return { status: "consumed", pairing };
    if (Date.parse(pairing.expiresAt) <= Date.now()) return { status: "expired", pairing };
    return { status: "active", pairing };
  }

  async markPendingPairingConsumed(nonce: string, options: { channel?: PendingPairingRecord["channel"] } = {}): Promise<PendingPairingRecord | undefined> {
    let found: PendingPairingRecord | undefined;
    await this.update((data) => {
      const entry = findPendingPairingEntryByCode(data, nonce);
      const pairing = entry?.pairing;
      if (!pairing) return;
      if (options.channel && pairing.channel && pairing.channel !== options.channel) return;
      if (pairing.consumedAt) return;
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        delete data.pendingPairings[entry!.key];
        return;
      }
      found = { ...pairing, consumedAt: toIsoNow() };
      data.pendingPairings[entry!.key] = found;
    });
    return found;
  }

  async consumePendingPairing(nonce: string, options: { channel?: PendingPairingRecord["channel"] } = {}): Promise<PendingPairingRecord | undefined> {
    let found: PendingPairingRecord | undefined;
    await this.update((data) => {
      const entry = findPendingPairingEntryByCode(data, nonce);
      const pairing = entry?.pairing;
      if (!pairing) return;
      if (options.channel && pairing.channel && pairing.channel !== options.channel) return;
      if (pairing.consumedAt) {
        delete data.pendingPairings[entry!.key];
        return;
      }
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        delete data.pendingPairings[entry!.key];
        return;
      }
      found = { ...pairing, consumedAt: toIsoNow() };
      delete data.pendingPairings[entry!.key];
    });
    return found;
  }

  async upsertBinding(binding: TelegramBindingMetadata): Promise<PersistedBindingRecord> {
    const record: PersistedBindingRecord = { ...binding, status: binding.revokedAt ? "revoked" : "active" };
    await this.update((data) => {
      data.bindings[binding.sessionKey] = record;
    });
    return record;
  }

  async revokeBinding(sessionKey: string, revokedAt = toIsoNow()): Promise<PersistedBindingRecord | undefined> {
    let revoked: PersistedBindingRecord | undefined;
    await this.update((data) => {
      const existing = data.bindings[sessionKey];
      if (!existing) return;
      revoked = {
        ...existing,
        revokedAt,
        lastSeenAt: revokedAt,
        status: "revoked",
      };
      data.bindings[sessionKey] = revoked;
    });
    return revoked;
  }

  /** Blocking inspection helper for tests/migrations only; runtime delivery and timer paths must use async snapshots. */
  getBindingBySessionKeySync(sessionKey: string): PersistedBindingRecord | undefined {
    return this.loadExistingSync().bindings[sessionKey];
  }

  async getBindingBySessionKey(sessionKey: string): Promise<PersistedBindingRecord | undefined> {
    return (await this.load()).bindings[sessionKey];
  }

  /** Blocking inspection helper for tests/migrations only; runtime delivery and timer paths must use async snapshots. */
  getActiveBindingForSessionSync(sessionKey: string, expected: { chatId?: number; userId?: number; includePaused?: boolean } = {}): PersistedBindingRecord | undefined {
    return activeTelegramBindingFromData(this.loadExistingSync(), sessionKey, expected);
  }

  async getActiveBindingForSession(sessionKey: string, expected: { chatId?: number; userId?: number; includePaused?: boolean } = {}): Promise<PersistedBindingRecord | undefined> {
    return activeTelegramBindingFromData(await this.load(), sessionKey, expected);
  }

  async getBindingByChatId(chatId: number): Promise<PersistedBindingRecord | undefined> {
    const bindings = Object.values((await this.load()).bindings);
    return bindings.find((binding) => binding.chatId === chatId);
  }

  async getBindingsByChatId(chatId: number): Promise<PersistedBindingRecord[]> {
    const bindings = Object.values((await this.load()).bindings);
    return bindings.filter((binding) => binding.chatId === chatId);
  }

  async getTelegramBindingsByUserId(userId: number): Promise<PersistedBindingRecord[]> {
    const bindings = Object.values((await this.load()).bindings);
    return bindings.filter((binding) => binding.userId === userId);
  }

  async upsertChannelBinding(binding: ChannelBinding): Promise<ChannelPersistedBindingRecord> {
    const key = channelBindingStorageKey(binding.channel, binding.sessionKey, binding.instanceId);
    const record: ChannelPersistedBindingRecord = { ...binding, instanceId: binding.instanceId ?? "default", status: binding.revokedAt ? "revoked" : "active" };
    await this.update((data) => {
      data.channelBindings[key] = record;
      delete data.channelBindings[legacyChannelBindingStorageKey(binding.channel, binding.sessionKey)];
    });
    return record;
  }

  async revokeChannelBinding(channel: ChannelBinding["channel"], sessionKey: string, revokedAt = toIsoNow(), instanceId = "default"): Promise<ChannelPersistedBindingRecord | undefined> {
    const key = channelBindingStorageKey(channel, sessionKey, instanceId);
    const legacyKey = legacyChannelBindingStorageKey(channel, sessionKey);
    let revoked: ChannelPersistedBindingRecord | undefined;
    await this.update((data) => {
      const existing = data.channelBindings[key] ?? (instanceId === "default" ? data.channelBindings[legacyKey] : undefined);
      if (!existing) return;
      revoked = revokeChannelBindingRecord(existing, revokedAt);
      data.channelBindings[key] = revoked;
      if (key !== legacyKey) delete data.channelBindings[legacyKey];
      clearSelectionForBinding(data, existing, sessionKey);
    });
    return revoked;
  }

  async revokeChannelBindingsForSession(sessionKey: string, revokedAt = toIsoNow()): Promise<ChannelPersistedBindingRecord[]> {
    const revoked: ChannelPersistedBindingRecord[] = [];
    await this.update((data) => {
      for (const [key, existing] of Object.entries(data.channelBindings)) {
        if (existing.sessionKey !== sessionKey || existing.status === "revoked") continue;
        const record = revokeChannelBindingRecord(existing, revokedAt);
        data.channelBindings[key] = record;
        clearSelectionForBinding(data, existing, sessionKey);
        revoked.push(record);
      }
    });
    return revoked;
  }

  async setActiveChannelSelection(channel: ChannelBinding["channel"], conversationId: string, userId: string, sessionKey: string, options: { machineId?: string; machineDisplayName?: string } = {}): Promise<ChannelActiveSelectionRecord> {
    const record: ChannelActiveSelectionRecord = {
      channel,
      conversationId,
      userId,
      sessionKey,
      updatedAt: toIsoNow(),
      machineId: options.machineId,
      machineDisplayName: options.machineDisplayName,
    };
    await this.update((data) => {
      data.activeChannelSelections[channelSelectionStorageKey(channel, conversationId, userId)] = record;
    });
    return record;
  }

  async getActiveChannelSelection(channel: ChannelBinding["channel"], conversationId: string, userId: string): Promise<ChannelActiveSelectionRecord | undefined> {
    return (await this.load()).activeChannelSelections[channelSelectionStorageKey(channel, conversationId, userId)];
  }

  async clearActiveChannelSelection(channel: ChannelBinding["channel"], conversationId: string, userId: string, sessionKey?: string): Promise<void> {
    await this.update((data) => {
      const key = channelSelectionStorageKey(channel, conversationId, userId);
      if (!sessionKey || data.activeChannelSelections[key]?.sessionKey === sessionKey) delete data.activeChannelSelections[key];
    });
  }

  async getChannelBinding(channel: ChannelBinding["channel"], conversationId: string, userId: string, instanceId = "default"): Promise<ChannelPersistedBindingRecord | undefined> {
    const bindings = Object.values((await this.load()).channelBindings);
    return bindings.find((binding) => binding.channel === channel && (binding.instanceId ?? "default") === instanceId && binding.conversationId === conversationId && binding.userId === userId && binding.status !== "revoked");
  }

  async getChannelBindingsForConversation(channel: ChannelBinding["channel"], conversationId: string, instanceId = "default"): Promise<ChannelPersistedBindingRecord[]> {
    const bindings = Object.values((await this.load()).channelBindings);
    return bindings.filter((binding) => binding.channel === channel && (binding.instanceId ?? "default") === instanceId && binding.conversationId === conversationId && binding.status !== "revoked");
  }

  /** Blocking inspection helper for tests/migrations only; runtime delivery and timer paths must use async snapshots. */
  getChannelBindingRecordBySessionKeySync(channel: ChannelBinding["channel"], sessionKey: string, instanceId = "default"): ChannelPersistedBindingRecord | undefined {
    const data = this.loadExistingSync();
    return data.channelBindings[channelBindingStorageKey(channel, sessionKey, instanceId)]
      ?? (instanceId === "default" ? data.channelBindings[legacyChannelBindingStorageKey(channel, sessionKey)] : undefined);
  }

  async getChannelBindingRecordBySessionKey(channel: ChannelBinding["channel"], sessionKey: string, instanceId = "default"): Promise<ChannelPersistedBindingRecord | undefined> {
    const data = await this.load();
    return data.channelBindings[channelBindingStorageKey(channel, sessionKey, instanceId)]
      ?? (instanceId === "default" ? data.channelBindings[legacyChannelBindingStorageKey(channel, sessionKey)] : undefined);
  }

  async getChannelBindingBySessionKey(channel: ChannelBinding["channel"], sessionKey: string, instanceId = "default"): Promise<ChannelPersistedBindingRecord | undefined> {
    const binding = await this.getChannelBindingRecordBySessionKey(channel, sessionKey, instanceId);
    return binding && binding.status !== "revoked" ? binding : undefined;
  }

  /** Blocking inspection helper for tests/migrations only; runtime delivery and timer paths must use async snapshots. */
  getActiveChannelBindingForSessionSync(channel: ChannelBinding["channel"], sessionKey: string, expected: { instanceId?: string; conversationId?: string; userId?: string; includePaused?: boolean } = {}): ChannelPersistedBindingRecord | undefined {
    return activeChannelBindingFromData(this.loadExistingSync(), channel, sessionKey, expected);
  }

  async getActiveChannelBindingForSession(channel: ChannelBinding["channel"], sessionKey: string, expected: { instanceId?: string; conversationId?: string; userId?: string; includePaused?: boolean } = {}): Promise<ChannelPersistedBindingRecord | undefined> {
    return activeChannelBindingFromData(await this.load(), channel, sessionKey, expected);
  }

  async trustRelayUser(input: Omit<TrustedRelayUserRecord, "trustedAt"> & { trustedAt?: string }): Promise<TrustedRelayUserRecord> {
    const record: TrustedRelayUserRecord = { ...input, trustedAt: input.trustedAt ?? toIsoNow() };
    await this.update((data) => {
      data.trustedRelayUsers[trustedRelayUserStorageKey(record.channel, record.instanceId, record.userId)] = record;
    });
    return record;
  }

  async getTrustedRelayUser(channel: ChannelBinding["channel"], userId: string, instanceId = "default"): Promise<TrustedRelayUserRecord | undefined> {
    return (await this.load()).trustedRelayUsers[trustedRelayUserStorageKey(channel, instanceId, userId)];
  }

  async listTrustedRelayUsers(): Promise<TrustedRelayUserRecord[]> {
    return Object.values((await this.load()).trustedRelayUsers).sort((left, right) => left.channel.localeCompare(right.channel) || left.userId.localeCompare(right.userId));
  }

  async revokeTrustedRelayUser(channel: ChannelBinding["channel"], userId: string, instanceId = "default"): Promise<boolean> {
    let removed = false;
    await this.update((data) => {
      const key = trustedRelayUserStorageKey(channel, instanceId, userId);
      removed = Boolean(data.trustedRelayUsers[key]);
      delete data.trustedRelayUsers[key];
    });
    return removed;
  }

  async upsertDelegationTask(task: DelegationTaskRecord, options: { maxAuditEntries?: number } = {}): Promise<DelegationTaskRecord> {
    const maxAuditEntries = Math.max(1, options.maxAuditEntries ?? 200);
    await this.update((data) => {
      data.delegationTasks[task.id] = task;
      data.delegationAudit = [...data.delegationAudit, ...task.audit].slice(-maxAuditEntries);
    });
    return task;
  }

  async getDelegationTask(taskId: string): Promise<DelegationTaskRecord | undefined> {
    return (await this.load()).delegationTasks[taskId];
  }

  async listDelegationTasks(options: { roomConversationId?: string; sourceMachineId?: string; targetMachineId?: string; limit?: number } = {}): Promise<DelegationTaskRecord[]> {
    const limit = Math.max(1, options.limit ?? 50);
    return Object.values((await this.load()).delegationTasks)
      .filter((task) => !options.roomConversationId || task.room.conversationId === options.roomConversationId)
      .filter((task) => !options.sourceMachineId || task.sourceMachineId === options.sourceMachineId)
      .filter((task) => !options.targetMachineId || task.target.kind === "machine" && task.target.machineId === options.targetMachineId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.id.localeCompare(left.id))
      .slice(0, limit);
  }

  async appendDelegationAudit(event: DelegationTaskAuditEvent, options: { maxAuditEntries?: number } = {}): Promise<void> {
    const maxAuditEntries = Math.max(1, options.maxAuditEntries ?? 200);
    await this.update((data) => {
      data.delegationAudit = [...data.delegationAudit, event].slice(-maxAuditEntries);
    });
  }

  async listDelegationAudit(options: { taskId?: string; limit?: number } = {}): Promise<DelegationTaskAuditEvent[]> {
    const limit = Math.max(1, options.limit ?? 50);
    return (await this.load()).delegationAudit
      .filter((event) => !options.taskId || event.taskId === options.taskId)
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.eventId.localeCompare(left.eventId))
      .slice(0, limit);
  }

  async markInFlightDelegationTasksStaleAfterRestart(now = toIsoNow()): Promise<DelegationTaskRecord[]> {
    const changed: DelegationTaskRecord[] = [];
    await this.update((data) => {
      for (const [taskId, task] of Object.entries(data.delegationTasks)) {
        const next = markDelegationTaskStaleAfterRestart(task, now);
        if (next === task || next.status === task.status && next.updatedAt === task.updatedAt) continue;
        data.delegationTasks[taskId] = next;
        data.delegationAudit = [...data.delegationAudit, ...next.audit.slice(task.audit.length)].slice(-200);
        changed.push(next);
      }
    });
    return changed;
  }

  async recordLifecycleNotification(input: {
    channel: ChannelBinding["channel"];
    instanceId?: string;
    sessionKey: string;
    conversationId: string;
    userId: string;
    kind: RelayLifecycleEventKind;
    nowIso?: string;
    debounceMs?: number;
  }): Promise<RelayLifecycleNotificationDecision> {
    let decision: RelayLifecycleNotificationDecision | undefined;
    await this.update((data) => {
      const key = relayLifecycleStorageKey(input);
      const previous = data.lifecycleNotifications[key];
      decision = decideRelayLifecycleNotification({ ...input, previous });
      if (decision.shouldNotify && input.kind === "online") return;
      data.lifecycleNotifications[key] = {
        ...decision.record,
        lastNotifiedAt: previous?.lastNotifiedAt,
        lastEvent: previous?.lastEvent,
      };
    });
    return decision!;
  }

  async markLifecycleNotificationDelivered(input: {
    channel: ChannelBinding["channel"];
    instanceId?: string;
    sessionKey: string;
    conversationId: string;
    userId: string;
    kind: RelayLifecycleEventKind;
    deliveredAt?: string;
  }): Promise<void> {
    const deliveredAt = input.deliveredAt ?? toIsoNow();
    await this.update((data) => {
      const key = relayLifecycleStorageKey(input);
      data.lifecycleNotifications[key] = {
        channel: input.channel,
        instanceId: input.instanceId ?? "default",
        sessionKey: input.sessionKey,
        conversationId: input.conversationId,
        userId: input.userId,
        state: lifecycleStateForNotification(input.kind),
        updatedAt: deliveredAt,
        lastNotifiedAt: deliveredAt,
        lastEvent: input.kind,
      };
    });
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function lifecycleStateForNotification(kind: RelayLifecycleEventKind): "online" | "offline" | "disconnected" {
  if (kind === "online") return "online";
  if (kind === "offline") return "offline";
  return "disconnected";
}

function normalizePinLikeCode(value: string): string | undefined {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : undefined;
}

function pendingPairingLookupKeys(code: string): string[] {
  const keys = [sha256(code.trim())];
  const normalizedPin = normalizePinLikeCode(code);
  if (normalizedPin && normalizedPin !== code.trim()) keys.push(sha256(normalizedPin));
  return keys;
}

function findPendingPairingEntryByCode(data: TunnelStoreData, code: string): { key: string; pairing: PendingPairingRecord } | undefined {
  for (const key of pendingPairingLookupKeys(code)) {
    const pairing = data.pendingPairings[key];
    if (pairing) return { key, pairing };
  }
  return undefined;
}

function findPendingPairingByCode(data: TunnelStoreData, code: string): PendingPairingRecord | undefined {
  return findPendingPairingEntryByCode(data, code)?.pairing;
}

function trustedRelayUserStorageKey(channel: ChannelBinding["channel"], instanceId: string, userId: string): string {
  return `${channel}:${instanceId}:${userId}`;
}

function channelSelectionStorageKey(channel: ChannelBinding["channel"], conversationId: string, userId: string): string {
  return `${channel}:${conversationId}:${userId}`;
}

function activeTelegramBindingFromData(data: TunnelStoreData, sessionKey: string, expected: { chatId?: number; userId?: number; includePaused?: boolean }): PersistedBindingRecord | undefined {
  const outcome = resolveTelegramBindingAuthority(bindingAuthorityStateFromData(data), { sessionKey, ...expected });
  return authorityOutcomeAllowsDelivery(outcome) && "status" in outcome.binding ? outcome.binding : undefined;
}

function activeChannelBindingFromData(data: TunnelStoreData, channel: ChannelBinding["channel"], sessionKey: string, expected: { instanceId?: string; conversationId?: string; userId?: string; includePaused?: boolean }): ChannelPersistedBindingRecord | undefined {
  const outcome = resolveChannelBindingAuthority(bindingAuthorityStateFromData(data), { channel, sessionKey, ...expected });
  return authorityOutcomeAllowsDelivery(outcome) && "status" in outcome.binding ? outcome.binding : undefined;
}

function revokeChannelBindingRecord(binding: ChannelPersistedBindingRecord, revokedAt: string): ChannelPersistedBindingRecord {
  return { ...binding, revokedAt, lastSeenAt: revokedAt, status: "revoked" };
}

function clearSelectionForBinding(data: TunnelStoreData, binding: ChannelBinding, sessionKey: string): void {
  const selectionKey = channelSelectionStorageKey(binding.channel, binding.conversationId, binding.userId);
  if (data.activeChannelSelections[selectionKey]?.sessionKey === sessionKey) delete data.activeChannelSelections[selectionKey];
}
