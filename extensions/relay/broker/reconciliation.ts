import { Buffer } from "node:buffer";
import type { RelayRouteState } from "../core/relay-core.js";
import {
  MAX_BROKER_RECONCILIATION_PAYLOAD_BYTES,
  MAX_BROKER_RECONCILIATION_ROUTES,
  type BrokerClientSynchronizationState,
  type BrokerEpoch,
  type BrokerRouteReconciliationRejection,
  type BrokerRouteReconciliationRequest,
  type BrokerRouteReconciliationResponse,
  type BrokerRouteSynchronizationHealth,
} from "./protocol.js";

const MAX_CLIENT_ID_CHARS = 128;
const MAX_SESSION_KEY_CHARS = 8_192;
const MAX_SESSION_ID_CHARS = 512;
const MAX_SESSION_LABEL_CHARS = 512;
const MAX_SESSION_FILE_CHARS = 16_384;

export type BrokerReconciliationValidationResult =
  | { ok: true; request: BrokerRouteReconciliationRequest }
  | { ok: false; rejection: BrokerRouteReconciliationRejection };

export function normalizeBrokerReconciliationRequest(
  value: unknown,
  currentBrokerEpoch: BrokerEpoch,
): BrokerReconciliationValidationResult {
  if (!isRecord(value)) return invalidRequest("Invalid broker reconciliation request.");
  if (!isBoundedNonEmptyString(value.clientId, MAX_CLIENT_ID_CHARS) || !Array.isArray(value.routes)) {
    return invalidRequest("Invalid broker reconciliation request.");
  }
  if (value.observedBrokerEpoch !== undefined && !isBoundedNonEmptyString(value.observedBrokerEpoch, 128)) {
    return invalidRequest("Invalid broker reconciliation epoch.");
  }
  if (value.observedBrokerEpoch !== undefined && value.observedBrokerEpoch !== currentBrokerEpoch) {
    return {
      ok: false,
      rejection: { code: "stale-epoch", safeMessage: "Broker epoch changed; route reconciliation must be retried." },
    };
  }
  if (value.routes.length > MAX_BROKER_RECONCILIATION_ROUTES) {
    return {
      ok: false,
      rejection: { code: "too-many-routes", safeMessage: "Broker route reconciliation exceeds the route limit." },
    };
  }
  if (serializedByteSize(value) > MAX_BROKER_RECONCILIATION_PAYLOAD_BYTES) {
    return {
      ok: false,
      rejection: { code: "payload-too-large", safeMessage: "Broker route reconciliation exceeds the payload limit." },
    };
  }

  const routes: RelayRouteState[] = [];
  const sessionKeys = new Set<string>();
  for (let index = 0; index < value.routes.length; index += 1) {
    const route = value.routes[index];
    if (!isRelayRouteState(route)) {
      return { ok: false, rejection: { index, code: "invalid-request", safeMessage: "Broker route descriptor is invalid." } };
    }
    if (sessionKeys.has(route.sessionKey)) {
      return { ok: false, rejection: { index, code: "duplicate-route", safeMessage: "Broker route reconciliation contains a duplicate route." } };
    }
    sessionKeys.add(route.sessionKey);
    routes.push(route);
  }

  return {
    ok: true,
    request: {
      clientId: value.clientId,
      observedBrokerEpoch: value.observedBrokerEpoch,
      routes,
    },
  };
}

export function normalizeBrokerReconciliationResponse(value: unknown): BrokerRouteReconciliationResponse | undefined {
  if (!isRecord(value) || !isBoundedNonEmptyString(value.brokerEpoch, 128)) return undefined;
  if (!Array.isArray(value.acceptedSessionKeys) || !value.acceptedSessionKeys.every((key) => isBoundedNonEmptyString(key, MAX_SESSION_KEY_CHARS))) return undefined;
  if (new Set(value.acceptedSessionKeys).size !== value.acceptedSessionKeys.length || !Array.isArray(value.rejected)) return undefined;
  const rejected: BrokerRouteReconciliationRejection[] = [];
  for (const rejection of value.rejected) {
    if (!isRecord(rejection) || !isRejectionCode(rejection.code) || typeof rejection.safeMessage !== "string") return undefined;
    if (rejection.index !== undefined && (!Number.isInteger(rejection.index) || Number(rejection.index) < 0)) return undefined;
    rejected.push({
      index: rejection.index === undefined ? undefined : Number(rejection.index),
      code: rejection.code,
      safeMessage: rejection.safeMessage,
    });
  }
  return { brokerEpoch: value.brokerEpoch, acceptedSessionKeys: value.acceptedSessionKeys, rejected };
}

export function synchronizationStateAfterConnect(
  sessionKeys: readonly string[],
  previous: BrokerClientSynchronizationState = { transport: "disconnected", routes: {} },
): BrokerClientSynchronizationState {
  return {
    transport: "connected",
    brokerEpoch: previous.brokerEpoch,
    routes: routeHealthRecord(sessionKeys, "pending"),
  };
}

export function synchronizationStateAfterDisconnect(
  sessionKeys: readonly string[],
  transport: "disconnected" | "reconnecting" | "unavailable" = "reconnecting",
): BrokerClientSynchronizationState {
  return { transport, routes: routeHealthRecord(sessionKeys, "unknown") };
}

export function synchronizationStateAfterResponse(
  sessionKeys: readonly string[],
  response: BrokerRouteReconciliationResponse,
): BrokerClientSynchronizationState {
  const accepted = new Set(response.acceptedSessionKeys);
  const hasGeneralRejection = response.rejected.some((rejection) => rejection.index === undefined);
  const rejectedIndices = new Set(response.rejected.flatMap((rejection) => rejection.index === undefined ? [] : [rejection.index]));
  const routes: Record<string, BrokerRouteSynchronizationHealth> = {};
  for (let index = 0; index < sessionKeys.length; index += 1) {
    const sessionKey = sessionKeys[index]!;
    routes[sessionKey] = accepted.has(sessionKey) ? "synchronized" : hasGeneralRejection || rejectedIndices.has(index) ? "rejected" : "missing";
  }
  return { transport: "connected", brokerEpoch: response.brokerEpoch, routes };
}

function routeHealthRecord(
  sessionKeys: readonly string[],
  health: BrokerRouteSynchronizationHealth,
): Record<string, BrokerRouteSynchronizationHealth> {
  return Object.fromEntries(sessionKeys.map((sessionKey) => [sessionKey, health]));
}

function invalidRequest(safeMessage: string): BrokerReconciliationValidationResult {
  return { ok: false, rejection: { code: "invalid-request", safeMessage } };
}

function serializedByteSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRelayRouteState(value: unknown): value is RelayRouteState {
  if (!isRecord(value)) return false;
  return isBoundedNonEmptyString(value.channel, 64)
    && isBoundedNonEmptyString(value.sessionKey, MAX_SESSION_KEY_CHARS)
    && isBoundedNonEmptyString(value.sessionId, MAX_SESSION_ID_CHARS)
    && (value.sessionFile === undefined || isBoundedNonEmptyString(value.sessionFile, MAX_SESSION_FILE_CHARS))
    && isBoundedNonEmptyString(value.sessionLabel, MAX_SESSION_LABEL_CHARS)
    && typeof value.busy === "boolean"
    && isRecord(value.notification)
    && (value.binding === undefined || isRecord(value.binding))
    && (value.modelId === undefined || typeof value.modelId === "string")
    && (value.imageInputSupported === undefined || typeof value.imageInputSupported === "boolean")
    && (value.lastActivityAt === undefined || typeof value.lastActivityAt === "number" && Number.isFinite(value.lastActivityAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRejectionCode(value: unknown): value is BrokerRouteReconciliationRejection["code"] {
  return value === "invalid-request" || value === "payload-too-large" || value === "too-many-routes" || value === "duplicate-route" || value === "stale-epoch" || value === "stale-owner";
}

function isBoundedNonEmptyString(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars;
}
