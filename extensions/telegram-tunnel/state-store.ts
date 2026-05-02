import { readFile, writeFile } from "node:fs/promises";
import { ensureParentDir, ensureStateDir, getStateFilePath } from "./paths.js";
import type { PendingPairingRecord, PersistedBindingRecord, SetupCache, TelegramBindingMetadata, TunnelStoreData } from "./types.js";
import { createPairingNonce, sessionKeyOf, sha256, toIsoNow } from "./utils.js";

function emptyStore(): TunnelStoreData {
  return {
    pendingPairings: {},
    bindings: {},
  };
}

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
}
