import type { Model } from "@mariozechner/pi-ai";
import type { SessionRoute } from "./types.js";

const STALE_EXTENSION_REFERENCE_PATTERNS = [
  "extension ctx is stale",
  "captured pi",
  "command ctx",
  "session replacement or reload",
];

export type RouteActionOutcome<T = void> =
  | { kind: "success"; result: T }
  | { kind: "unavailable"; message: string }
  | { kind: "already-idle"; message: string }
  | { kind: "failed"; error: unknown; safeMessage: string };

export function routeActionSuccess<T = void>(result: T): RouteActionOutcome<T> {
  return { kind: "success", result };
}

export function routeActionUnavailable(message = unavailableRouteMessage()): RouteActionOutcome<never> {
  return { kind: "unavailable", message };
}

export function routeActionAlreadyIdle(message: string): RouteActionOutcome<never> {
  return { kind: "already-idle", message };
}

export function routeActionFailed(error: unknown, safeMessage: string): RouteActionOutcome<never> {
  return { kind: "failed", error, safeMessage };
}

export function isStaleExtensionReferenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("stale") && STALE_EXTENSION_REFERENCE_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function routeIdleState(route: SessionRoute): boolean | undefined {
  try {
    if (route.actions.isIdle) return route.actions.isIdle();
    return route.actions.context.isIdle();
  } catch (error) {
    if (isStaleExtensionReferenceError(error)) return undefined;
    throw error;
  }
}

export function routeIsBusy(route: SessionRoute): boolean {
  return routeIdleState(route) === false;
}

export type RouteModelState =
  | { available: true; model: Model<any> | undefined }
  | { available: false };

export function routeModelState(route: SessionRoute): RouteModelState {
  try {
    const model = route.actions.getModel();
    return routeIdleState(route) === undefined ? { available: false } : { available: true, model };
  } catch (error) {
    if (isStaleExtensionReferenceError(error)) return { available: false };
    throw error;
  }
}

export function routeWorkspaceRoot(route: SessionRoute): string | undefined {
  try {
    if (route.actions.getWorkspaceRoot) return route.actions.getWorkspaceRoot();
    return route.actions.context.cwd;
  } catch (error) {
    if (isStaleExtensionReferenceError(error)) return undefined;
    throw error;
  }
}

export function unavailableRouteMessage(): string {
  return "The Pi session is unavailable. Resume it locally, then try again.";
}
