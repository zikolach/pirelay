import { describe, expect, it, vi } from "vitest";
import {
  isRouteUnavailableError,
  isRouteUnavailableOutcome,
  isStaleExtensionReferenceError,
  RouteUnavailableError,
  routeActionAlreadyIdle,
  routeActionDisplayMessage,
  routeActionFailed,
  abortRouteSafely,
  compactRouteSafely,
  deliverRoutePrompt,
  latestRouteImagesSafely,
  routeActionOutcomeFromError,
  routeActionSuccess,
  routeActionUnavailable,
  probeRouteAvailability,
  routeImageByPathSafely,
  routeIdleState,
  routeModelState,
  routeUnavailableError,
  routeWorkspaceRoot,
  routeWorkspaceRootSafely,
  unavailableRouteMessage,
} from "../../extensions/relay/core/route-actions.js";
import type { SessionRoute, TelegramBindingMetadata } from "../../extensions/relay/core/types.js";

const STALE_EXTENSION_ERROR = "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().";

function route(overrides: Partial<SessionRoute["actions"]> = {}): SessionRoute {
  const binding: TelegramBindingMetadata = {
    sessionKey: "session:/tmp/session.jsonl",
    sessionId: "session",
    sessionFile: "/tmp/session.jsonl",
    sessionLabel: "Session",
    chatId: 1,
    userId: 2,
    boundAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  return {
    sessionKey: binding.sessionKey,
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    sessionLabel: binding.sessionLabel,
    binding,
    notification: {},
    actions: {
      context: {
        cwd: "/workspace",
        isIdle: vi.fn(() => true),
      } as never,
      getModel: () => undefined,
      sendUserMessage: () => undefined,
      getLatestImages: async () => [],
      getImageByPath: async () => ({ ok: false, error: "missing" }),
      appendAudit: () => undefined,
      persistBinding: () => undefined,
      promptLocalConfirmation: async () => true,
      abort: () => undefined,
      compact: async () => undefined,
      ...overrides,
    },
  };
}

describe("route action lifetime helpers", () => {
  it("models typed route action outcomes", () => {
    expect(routeActionSuccess("accepted")).toEqual({ kind: "success", result: "accepted" });
    expect(routeActionUnavailable()).toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
    expect(routeActionAlreadyIdle("already idle")).toEqual({ kind: "already-idle", message: "already idle" });
    const error = new Error("boom");
    expect(routeActionFailed(error, "safe failure")).toEqual({ kind: "failed", error, safeMessage: "safe failure" });
  });

  it("identifies unavailable route errors and outcomes without display string equality", () => {
    const typedError = routeUnavailableError("custom unavailable text");
    expect(typedError).toBeInstanceOf(RouteUnavailableError);
    expect(isRouteUnavailableError(typedError)).toBe(true);
    expect(isRouteUnavailableError(new Error(unavailableRouteMessage()))).toBe(false);
    expect(isRouteUnavailableOutcome(routeActionUnavailable("custom unavailable text"))).toBe(true);
    expect(isRouteUnavailableOutcome(routeActionFailed(new Error("boom"), "safe failure"))).toBe(false);
  });

  it("converts unavailable errors without hiding non-unavailable failures", () => {
    expect(routeActionOutcomeFromError(new Error(STALE_EXTENSION_ERROR), "safe failure")).toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
    const error = new Error("platform failure");
    expect(routeActionOutcomeFromError(error, "safe failure")).toEqual({ kind: "failed", error, safeMessage: "safe failure" });
    expect(routeActionDisplayMessage(routeActionUnavailable())).toBe(unavailableRouteMessage());
    expect(routeActionDisplayMessage(routeActionFailed(error, "safe failure"))).toBe("safe failure");
  });

  it("detects stale extension reference errors", () => {
    expect(isStaleExtensionReferenceError(new Error(STALE_EXTENSION_ERROR))).toBe(true);
    expect(isStaleExtensionReferenceError(new Error("ordinary stale cache entry"))).toBe(false);
    expect(isStaleExtensionReferenceError(new Error("network down"))).toBe(false);
  });

  it("fails workspace and media operations closed when route context is unavailable", async () => {
    const unavailableWorkspace = route({ isIdle: () => true, getWorkspaceRoot: () => { throw new Error(STALE_EXTENSION_ERROR); } });
    expect(routeWorkspaceRootSafely(unavailableWorkspace)).toEqual({ kind: "unavailable", message: unavailableRouteMessage() });

    const getImageByPath = vi.fn(async () => ({ ok: false as const, error: "should not read" }));
    await expect(routeImageByPathSafely(route({ isIdle: () => true, getWorkspaceRoot: () => undefined, getImageByPath }), "out.png")).resolves.toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
    expect(getImageByPath).not.toHaveBeenCalled();

    await expect(latestRouteImagesSafely(route({ isIdle: () => undefined }))).resolves.toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
  });

  it("preserves media validation results after safe workspace checks", async () => {
    const loadResult = { ok: false as const, error: "Image file not found." };
    const getImageByPath = vi.fn(async () => loadResult);
    await expect(routeImageByPathSafely(route({ isIdle: () => true, getWorkspaceRoot: () => "/workspace", getImageByPath }), "missing.png")).resolves.toEqual({ kind: "success", result: loadResult });
    expect(getImageByPath).toHaveBeenCalledWith("missing.png");
  });

  it("handles abort outcomes and rollback", () => {
    const abort = vi.fn();
    const busy = route({ isIdle: () => false, abort });
    expect(abortRouteSafely(busy)).toEqual({ kind: "success", result: undefined });
    expect(abort).toHaveBeenCalledOnce();
    expect(busy.notification.abortRequested).toBe(true);

    const idle = route({ isIdle: () => true, abort: vi.fn() });
    expect(abortRouteSafely(idle)).toEqual({ kind: "already-idle", message: "The Pi session is already idle." });
    expect(idle.actions.abort).not.toHaveBeenCalled();

    const unavailable = route({ isIdle: () => false, abort: () => { throw routeUnavailableError(); } });
    expect(abortRouteSafely(unavailable)).toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
    expect(unavailable.notification.abortRequested).toBe(false);
  });

  it("contains compact unavailable races", async () => {
    const unavailable = route({ isIdle: () => false, compact: async () => { throw routeUnavailableError(); } });
    await expect(compactRouteSafely(unavailable)).resolves.toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
    const compact = vi.fn(async () => undefined);
    await expect(compactRouteSafely(route({ isIdle: () => true, compact }))).resolves.toEqual({ kind: "success", result: undefined });
    expect(compact).toHaveBeenCalledOnce();
  });

  it("rolls back prompt reservations and hooks on unavailable delivery", async () => {
    const session = route({ isIdle: () => true, sendUserMessage: () => { throw routeUnavailableError(); } });
    const previousRequester = { channel: "telegram" as const, instanceId: "default", conversationId: "old", userId: "1", sessionKey: session.sessionKey, safeLabel: "old", createdAt: 1 };
    const nextRequester = { ...previousRequester, conversationId: "new", safeLabel: "new" };
    session.remoteRequester = previousRequester;
    session.remoteRequesterPendingTurn = true;
    const events: string[] = [];

    await expect(deliverRoutePrompt(session, {
      content: "hello",
      requester: nextRequester,
      onStart: () => { events.push("start"); },
      onRollback: () => { events.push("rollback"); },
    })).resolves.toEqual({ kind: "unavailable", message: unavailableRouteMessage() });

    expect(session.remoteRequester).toBe(previousRequester);
    expect(session.remoteRequesterPendingTurn).toBe(true);
    expect(events).toEqual(["start", "rollback"]);
  });

  it("commits accepted prompt operations without rollback", async () => {
    const sendUserMessage = vi.fn();
    const session = route({ isIdle: () => false, sendUserMessage });
    const requester = { channel: "telegram" as const, instanceId: "default", conversationId: "new", userId: "1", sessionKey: session.sessionKey, safeLabel: "new", createdAt: 1 };
    const events: string[] = [];

    await expect(deliverRoutePrompt(session, {
      content: "hello",
      deliverAs: "followUp",
      requester,
      onStart: () => { events.push("start"); },
      onRollback: () => { events.push("rollback"); },
      onCommit: () => { events.push("commit"); },
    })).resolves.toEqual({ kind: "success", result: { idle: false, deliverAs: "followUp" } });

    expect(sendUserMessage).toHaveBeenCalledWith("hello", { deliverAs: "followUp" });
    expect(session.remoteRequester).toBe(requester);
    expect(events).toEqual(["start", "commit"]);
  });

  it("probes route availability coherently", () => {
    expect(probeRouteAvailability(route({ isIdle: () => false }), { includeModel: true })).toMatchObject({ kind: "available", idle: false, busy: true });
    expect(probeRouteAvailability(route({ isIdle: () => undefined }))).toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
    expect(probeRouteAvailability(route({ isIdle: () => true, getModel: () => { throw new Error(STALE_EXTENSION_ERROR); } }), { includeModel: true })).toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
    expect(probeRouteAvailability(route({ isIdle: () => true, getWorkspaceRoot: () => undefined }), { includeWorkspace: true })).toEqual({ kind: "unavailable", message: unavailableRouteMessage() });
  });

  it("prefers narrow action helpers over raw context", () => {
    const session = route({ isIdle: () => false, getWorkspaceRoot: () => "/safe" });
    expect(routeIdleState(session)).toBe(false);
    expect(routeWorkspaceRoot(session)).toBe("/safe");
  });

  it("treats undefined from narrow helpers as unavailable", () => {
    const session = route({ isIdle: () => undefined, getWorkspaceRoot: () => undefined });
    expect(routeIdleState(session)).toBeUndefined();
    expect(routeWorkspaceRoot(session)).toBeUndefined();
  });

  it("distinguishes unavailable model lookup from no model selected", () => {
    expect(routeModelState(route({ getModel: () => undefined, isIdle: () => true }))).toEqual({ available: true, model: undefined });
    expect(routeModelState(route({ getModel: () => undefined, isIdle: () => undefined }))).toEqual({ available: false });
    expect(routeModelState(route({ getModel: () => { throw new Error(STALE_EXTENSION_ERROR); } }))).toEqual({ available: false });
  });

  it("contains stale raw context failures", () => {
    const session = route();
    session.actions.context = {
      get cwd(): string { throw new Error(STALE_EXTENSION_ERROR); },
      isIdle: () => { throw new Error(STALE_EXTENSION_ERROR); },
    } as never;

    expect(routeIdleState(session)).toBeUndefined();
    expect(routeWorkspaceRoot(session)).toBeUndefined();
  });
});
