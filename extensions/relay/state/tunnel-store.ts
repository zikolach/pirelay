import { readFile, writeFile } from "node:fs/promises";
import { ensureParentDir, ensureStateDir, getStateFilePath } from "./paths.js";
import type { ChannelBinding } from "../core/channel-adapter.js";
import { channelBindingStorageKey } from "../broker/channel-registry.js";
import type { ChannelActiveSelectionRecord, ChannelPersistedBindingRecord, PendingPairingRecord, PersistedBindingRecord, SetupCache, TelegramBindingMetadata, TunnelStoreData } from "../core/types.js";
import { createPairingNonce, sessionKeyOf, sha256, toIsoNow } from "../core/utils.js";

function emptyStore(): TunnelStoreData {
  return {
    pendingPairings: {},
    bindings: {},
    channelBindings: {},
    activeChannelSelections: {},
  };
}

export type PendingPairingInspection =
  | { status: "active"; pairing: PendingPairingRecord }
  | { status: "missing" | "wrong-channel" | "consumed" | "expired"; pairing?: PendingPairingRecord };

export class TunnelStateStore {
  constructor(private readonly stateDir: string) {}

  private get filePath(): string {
    return getStateFilePath(this.stateDir);
  }

  async load(): Promise<TunnelStoreData> {
    await ensureStateDir(this.stateDir);
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TunnelStoreData>;
      return {
        setup: parsed.setup,
        pendingPairings: parsed.pendingPairings ?? {},
        bindings: parsed.bindings ?? {},
        channelBindings: parsed.channelBindings ?? {},
        activeChannelSelections: parsed.activeChannelSelections ?? {},
      };
    } catch {
      return emptyStore();
    }
  }

  async save(data: TunnelStoreData): Promise<void> {
    await ensureParentDir(this.filePath);
    await writeFile(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async update(mutator: (data: TunnelStoreData) => void | Promise<void>): Promise<TunnelStoreData> {
    const current = await this.load();
    await mutator(current);
    await this.save(current);
    return current;
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
  }): Promise<{ nonce: string; pairing: PendingPairingRecord }> {
    const nonce = createPairingNonce();
    const nonceHash = sha256(nonce);
    const sessionKey = sessionKeyOf(input.sessionId, input.sessionFile);
    const createdAt = toIsoNow();
    const pairing: PendingPairingRecord = {
      nonceHash,
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
    const nonceHash = sha256(nonce);
    const pairing = (await this.load()).pendingPairings[nonceHash];
    if (!pairing) return { status: "missing" };
    if (options.channel && pairing.channel && pairing.channel !== options.channel) return { status: "wrong-channel", pairing };
    if (pairing.consumedAt) return { status: "consumed", pairing };
    if (Date.parse(pairing.expiresAt) <= Date.now()) return { status: "expired", pairing };
    return { status: "active", pairing };
  }

  async markPendingPairingConsumed(nonce: string, options: { channel?: PendingPairingRecord["channel"] } = {}): Promise<PendingPairingRecord | undefined> {
    const nonceHash = sha256(nonce);
    let found: PendingPairingRecord | undefined;
    await this.update((data) => {
      const pairing = data.pendingPairings[nonceHash];
      if (!pairing) return;
      if (options.channel && pairing.channel && pairing.channel !== options.channel) return;
      if (pairing.consumedAt) return;
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        delete data.pendingPairings[nonceHash];
        return;
      }
      found = { ...pairing, consumedAt: toIsoNow() };
      data.pendingPairings[nonceHash] = found;
    });
    return found;
  }

  async consumePendingPairing(nonce: string, options: { channel?: PendingPairingRecord["channel"] } = {}): Promise<PendingPairingRecord | undefined> {
    const nonceHash = sha256(nonce);
    let found: PendingPairingRecord | undefined;
    await this.update((data) => {
      const pairing = data.pendingPairings[nonceHash];
      if (!pairing) return;
      if (options.channel && pairing.channel && pairing.channel !== options.channel) return;
      if (pairing.consumedAt) {
        delete data.pendingPairings[nonceHash];
        return;
      }
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        delete data.pendingPairings[nonceHash];
        return;
      }
      found = { ...pairing, consumedAt: toIsoNow() };
      delete data.pendingPairings[nonceHash];
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

  async getBindingBySessionKey(sessionKey: string): Promise<PersistedBindingRecord | undefined> {
    return (await this.load()).bindings[sessionKey];
  }

  async getBindingByChatId(chatId: number): Promise<PersistedBindingRecord | undefined> {
    const bindings = Object.values((await this.load()).bindings);
    return bindings.find((binding) => binding.chatId === chatId);
  }

  async getBindingsByChatId(chatId: number): Promise<PersistedBindingRecord[]> {
    const bindings = Object.values((await this.load()).bindings);
    return bindings.filter((binding) => binding.chatId === chatId);
  }

  async upsertChannelBinding(binding: ChannelBinding): Promise<ChannelPersistedBindingRecord> {
    const key = channelBindingStorageKey(binding.channel, binding.sessionKey);
    const record: ChannelPersistedBindingRecord = { ...binding, status: binding.revokedAt ? "revoked" : "active" };
    await this.update((data) => {
      data.channelBindings[key] = record;
    });
    return record;
  }

  async revokeChannelBinding(channel: ChannelBinding["channel"], sessionKey: string, revokedAt = toIsoNow()): Promise<ChannelPersistedBindingRecord | undefined> {
    const key = channelBindingStorageKey(channel, sessionKey);
    let revoked: ChannelPersistedBindingRecord | undefined;
    await this.update((data) => {
      const existing = data.channelBindings[key];
      if (!existing) return;
      revoked = revokeChannelBindingRecord(existing, revokedAt);
      data.channelBindings[key] = revoked;
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

  async setActiveChannelSelection(channel: ChannelBinding["channel"], conversationId: string, userId: string, sessionKey: string): Promise<ChannelActiveSelectionRecord> {
    const record: ChannelActiveSelectionRecord = { channel, conversationId, userId, sessionKey, updatedAt: toIsoNow() };
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

  async getChannelBinding(channel: ChannelBinding["channel"], conversationId: string, userId: string): Promise<ChannelPersistedBindingRecord | undefined> {
    const bindings = Object.values((await this.load()).channelBindings);
    return bindings.find((binding) => binding.channel === channel && binding.conversationId === conversationId && binding.userId === userId && binding.status !== "revoked");
  }

  async getChannelBindingBySessionKey(channel: ChannelBinding["channel"], sessionKey: string): Promise<ChannelPersistedBindingRecord | undefined> {
    const binding = (await this.load()).channelBindings[channelBindingStorageKey(channel, sessionKey)];
    return binding && binding.status !== "revoked" ? binding : undefined;
  }
}

function channelSelectionStorageKey(channel: ChannelBinding["channel"], conversationId: string, userId: string): string {
  return `${channel}:${conversationId}:${userId}`;
}

function revokeChannelBindingRecord(binding: ChannelPersistedBindingRecord, revokedAt: string): ChannelPersistedBindingRecord {
  return { ...binding, revokedAt, lastSeenAt: revokedAt, status: "revoked" };
}

function clearSelectionForBinding(data: TunnelStoreData, binding: ChannelBinding, sessionKey: string): void {
  const selectionKey = channelSelectionStorageKey(binding.channel, binding.conversationId, binding.userId);
  if (data.activeChannelSelections[selectionKey]?.sessionKey === sessionKey) delete data.activeChannelSelections[selectionKey];
}
