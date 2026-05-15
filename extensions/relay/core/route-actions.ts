import type { Model } from "@mariozechner/pi-ai";
import type { RelayFileDeliveryRequester } from "./requester-file-delivery.js";
import type { DeliveryMode, SessionRoute, TelegramPromptContent } from "./types.js";

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
  if (isRouteUnavailableError(error)) return routeActionUnavailable();
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
  const idle = routeIdleState(route);
  if (idle === undefined) return routeActionUnavailable();

  let model: Model<any> | undefined;
  if (options.includeModel) {
    try {
      model = route.actions.getModel();
    } catch (error) {
      if (isRouteUnavailableError(error)) return routeActionUnavailable();
      throw error;
    }
    if (routeIdleState(route) === undefined) return routeActionUnavailable();
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
