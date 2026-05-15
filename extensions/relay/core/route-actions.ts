import type { Model } from "@mariozechner/pi-ai";
import type { RelayFileDeliveryRequester } from "./requester-file-delivery.js";
import type { DeliveryMode, ImageFileLoadResult, LatestTurnImage, SessionRoute, TelegramPromptContent } from "./types.js";

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

export function routeActionUnavailable(message = unavailableRouteMessage()): Extract<RouteActionOutcome<never>, { kind: "unavailable" }> {
  return { kind: "unavailable", message };
}

export function routeActionAlreadyIdle(message: string): Extract<RouteActionOutcome<never>, { kind: "already-idle" }> {
  return { kind: "already-idle", message };
}

export function routeActionFailed(error: unknown, safeMessage: string): Extract<RouteActionOutcome<never>, { kind: "failed" }> {
  return { kind: "failed", error, safeMessage };
}

export class RouteUnavailableError extends Error {
  readonly name = "RouteUnavailableError";
  readonly routeUnavailable = true;

  constructor(message = unavailableRouteMessage(), options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function routeUnavailableError(message = unavailableRouteMessage(), cause?: unknown): RouteUnavailableError {
  return new RouteUnavailableError(message, cause === undefined ? undefined : { cause });
}

export function isRouteUnavailableError(error: unknown): boolean {
  return error instanceof RouteUnavailableError || isStaleExtensionReferenceError(error);
}

export function isRouteUnavailableOutcome(outcome: RouteActionOutcome<unknown>): outcome is Extract<RouteActionOutcome<unknown>, { kind: "unavailable" }> {
  return outcome.kind === "unavailable";
}

export function routeActionOutcomeFromError(error: unknown, safeMessage: string): Extract<RouteActionOutcome<never>, { kind: "unavailable" | "failed" }> {
  if (error instanceof RouteUnavailableError) return routeActionUnavailable(error.message);
  if (isStaleExtensionReferenceError(error)) return routeActionUnavailable();
  return routeActionFailed(error, safeMessage);
}

export function routeActionDisplayMessage(outcome: Exclude<RouteActionOutcome<unknown>, { kind: "success" }>): string {
  if (outcome.kind === "failed") return outcome.safeMessage;
  return outcome.message;
}

export type RouteAvailabilityProbe =
  | { kind: "available"; idle: boolean; busy: boolean; model?: Model<any>; workspaceRoot?: string }
  | { kind: "unavailable"; message: string };

export interface RouteAvailabilityProbeOptions {
  includeModel?: boolean;
  includeWorkspace?: boolean;
}

export function probeRouteAvailability(route: SessionRoute, options: RouteAvailabilityProbeOptions = {}): RouteAvailabilityProbe {
  let idle = routeIdleState(route);
  if (idle === undefined) return routeActionUnavailable();

  let model: Model<any> | undefined;
  if (options.includeModel) {
    try {
      model = route.actions.getModel();
    } catch (error) {
      if (isRouteUnavailableError(error)) return routeActionUnavailable();
      throw error;
    }
    idle = routeIdleState(route);
    if (idle === undefined) return routeActionUnavailable();
  }

  let workspaceRoot: string | undefined;
  if (options.includeWorkspace) {
    workspaceRoot = routeWorkspaceRoot(route);
    if (!workspaceRoot) return routeActionUnavailable();
  }

  return { kind: "available", idle, busy: !idle, model, workspaceRoot };
}

export type RoutePromptOperationOutcome = RouteActionOutcome<{ idle: boolean; deliverAs?: DeliveryMode }>;

export interface RoutePromptOperationOptions {
  content: TelegramPromptContent;
  deliverAs?: DeliveryMode;
  requester?: RelayFileDeliveryRequester;
  safeFailureMessage?: string;
  passUndefinedOptions?: boolean;
  onStart?(context: { idle: boolean; deliverAs?: DeliveryMode }): void | Promise<void>;
  onRollback?(context: { idle: boolean; deliverAs?: DeliveryMode }): void | Promise<void>;
  onCommit?(context: { idle: boolean; deliverAs?: DeliveryMode }): void | Promise<void>;
}

export async function deliverRoutePrompt(route: SessionRoute, options: RoutePromptOperationOptions): Promise<RoutePromptOperationOutcome> {
  const probe = probeRouteAvailability(route);
  if (probe.kind === "unavailable") return probe;

  const previousRequester = route.remoteRequester;
  const previousPendingTurn = route.remoteRequesterPendingTurn;
  const deliverAs = probe.idle ? undefined : options.deliverAs;
  const context = { idle: probe.idle, deliverAs };
  const rollback = async (): Promise<void> => {
    if (options.requester) {
      route.remoteRequester = previousRequester;
      route.remoteRequesterPendingTurn = previousPendingTurn;
    }
    await options.onRollback?.(context);
  };

  if (options.requester) route.remoteRequester = options.requester;

  try {
    await options.onStart?.(context);
    if (deliverAs) route.actions.sendUserMessage(options.content, { deliverAs });
    else if (options.passUndefinedOptions) route.actions.sendUserMessage(options.content, undefined);
    else route.actions.sendUserMessage(options.content);
  } catch (error) {
    await rollback();
    return routeActionOutcomeFromError(error, options.safeFailureMessage ?? "Could not deliver the prompt to Pi.");
  }

  try {
    await options.onCommit?.(context);
  } catch (error) {
    return routeActionFailed(error, options.safeFailureMessage ?? "Could not finish prompt delivery.");
  }

  return routeActionSuccess({ idle: probe.idle, deliverAs });
}

export type RouteControlOperationOutcome = RouteActionOutcome<void>;

export function abortRouteSafely(route: SessionRoute, options: { alreadyIdleMessage?: string; safeFailureMessage?: string } = {}): RouteControlOperationOutcome {
  const probe = probeRouteAvailability(route);
  if (probe.kind === "unavailable") return probe;
  if (probe.idle) return routeActionAlreadyIdle(options.alreadyIdleMessage ?? "The Pi session is already idle.");

  route.notification.abortRequested = true;
  try {
    route.actions.abort();
  } catch (error) {
    route.notification.abortRequested = false;
    return routeActionOutcomeFromError(error, options.safeFailureMessage ?? "Could not request abort.");
  }
  return routeActionSuccess(undefined);
}

export async function compactRouteSafely(route: SessionRoute, options: { safeFailureMessage?: string } = {}): Promise<RouteControlOperationOutcome> {
  const probe = probeRouteAvailability(route);
  if (probe.kind === "unavailable") return probe;
  try {
    await route.actions.compact();
  } catch (error) {
    return routeActionOutcomeFromError(error, options.safeFailureMessage ?? "Could not request compaction.");
  }
  return routeActionSuccess(undefined);
}

export type RouteWorkspaceOperationOutcome<T> = RouteActionOutcome<T>;

export function routeWorkspaceRootSafely(route: SessionRoute): RouteWorkspaceOperationOutcome<string> {
  const probe = probeRouteAvailability(route, { includeWorkspace: true });
  if (probe.kind === "unavailable") return probe;
  if (!probe.workspaceRoot) return routeActionUnavailable();
  return routeActionSuccess(probe.workspaceRoot);
}

export async function latestRouteImagesSafely(route: SessionRoute): Promise<RouteWorkspaceOperationOutcome<LatestTurnImage[]>> {
  const probe = probeRouteAvailability(route);
  if (probe.kind === "unavailable") return probe;
  try {
    return routeActionSuccess(await route.actions.getLatestImages());
  } catch (error) {
    return routeActionOutcomeFromError(error, "Could not load latest Pi images.");
  }
}

export async function routeImageByPathSafely(route: SessionRoute, relativePath: string): Promise<RouteWorkspaceOperationOutcome<ImageFileLoadResult>> {
  const probe = probeRouteAvailability(route, { includeWorkspace: true });
  if (probe.kind === "unavailable") return probe;
  try {
    return routeActionSuccess(await route.actions.getImageByPath(relativePath));
  } catch (error) {
    return routeActionOutcomeFromError(error, "Could not load the requested Pi image.");
  }
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
  // Keep display wording centralized; callers should branch on typed outcomes or
  // RouteUnavailableError rather than comparing this user-facing string.
  return "The Pi session is unavailable. Resume it locally, then try again.";
}
