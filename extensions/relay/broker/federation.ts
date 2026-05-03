import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { BrokerFederationMessage } from "./protocol.js";

export interface SignedBrokerFederationEnvelope {
  protocolVersion: 1;
  peerId: string;
  sentAt: string;
  nonce: string;
  message: BrokerFederationMessage;
  signature: string;
}

export interface BrokerPeerAuthenticator {
  sign(peerId: string, message: BrokerFederationMessage, options?: { sentAt?: string; nonce?: string }): SignedBrokerFederationEnvelope;
  verify(envelope: SignedBrokerFederationEnvelope): BrokerFederationMessage | undefined;
}

function canonicalPayload(envelope: Omit<SignedBrokerFederationEnvelope, "signature">): string {
  return JSON.stringify(envelope);
}

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createSharedSecretPeerAuthenticator(input: { localPeerId: string; peerSecrets: Record<string, string> }): BrokerPeerAuthenticator {
  return {
    sign(peerId, message, options = {}) {
      const secret = input.peerSecrets[peerId];
      if (!secret) throw new Error(`Missing broker peer secret for ${peerId}.`);
      const unsigned = {
        protocolVersion: 1 as const,
        peerId: input.localPeerId,
        sentAt: options.sentAt ?? new Date().toISOString(),
        nonce: options.nonce ?? randomUUID(),
        message,
      };
      return {
        ...unsigned,
        signature: hmac(secret, canonicalPayload(unsigned)),
      };
    },
    verify(envelope) {
      const secret = input.peerSecrets[envelope.peerId];
      if (!secret) return undefined;
      const { signature, ...unsigned } = envelope;
      const expected = hmac(secret, canonicalPayload(unsigned));
      return safeEqual(signature, expected) ? envelope.message : undefined;
    },
  };
}

export function federationMessageContainsSecretLikeValue(message: BrokerFederationMessage): boolean {
  const serialized = JSON.stringify(message);
  return /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/.test(serialized)
    || /xox[baprs]-[A-Za-z0-9-]{10,}/.test(serialized)
    || /Bot\s+[A-Za-z0-9._-]{20,}/i.test(serialized);
}
