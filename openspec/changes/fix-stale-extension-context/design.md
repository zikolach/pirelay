## Context

PiRelay runs inside Pi extension contexts, but some relay behavior is intentionally long-lived or asynchronous: messenger route actions, deferred status refreshes, lifecycle notifications, setup callbacks, broker requests, remote controls, and registered tools may run after the command or session context that created them has been replaced. Pi now rejects use of stale session-bound extension objects with runtime errors such as:

```text
This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().
```

This surfaced in goal-runner worker sessions where PiRelay was loaded in a `pi --print` subprocess. The worker completed successfully and emitted a terminal success event, but PiRelay later attempted a local UI/status update through a stale context and caused the Pi process to exit non-zero.

The observed hot spots include `extension-runtime.ts` route actions and lifecycle/status reporting paths that close over `ctx` or use `latestContext ?? ctx` without verifying that the chosen context is still active. The broader risk also includes captured session-bound `pi` methods (`sendUserMessage`, `sendMessage`, `appendEntry`) and adapter/broker code that reads `route.actions.context` directly for `isIdle()`, `cwd`, model, or UI/status behavior.

```text
session_start(ctx A)
      │
      ▼
build route/actions closing over ctx A and pi A
      │
      ├── adapter stores route
      ├── broker stores route
      └── deferred callbacks scheduled

session replacement/reload
      │
      ▼
ctx A / pi A become stale
      │
      ▼
old callback calls ctx A.ui or pi A.sendUserMessage  ✗
```

## Goals / Non-Goals

**Goals:**

- Prevent PiRelay from crashing Pi sessions or worker subprocesses because a best-effort relay callback uses a stale extension context or session-bound extension API object.
- Centralize live-context/API resolution so delayed callbacks use only a current active context or skip/fail safely.
- Remove or quarantine direct `route.actions.context` usage from adapter and broker paths that can outlive the immediate Pi event.
- Keep messenger delivery, authorization, pairing, and remote routing behavior unchanged for live routes.
- Preserve useful diagnostics without making status-line or notification updates depend on stale local UI contexts.
- Add tests that simulate stale-context and stale-API failures and assert they are contained.

**Non-Goals:**

- Changing Pi's extension context lifecycle semantics.
- Reworking messenger routing, pairing, broker topology, binding authority, or authorization rules.
- Suppressing real messenger delivery failures where the active context is valid and diagnostics can be recorded safely.
- Treating stale-context errors as successful messenger deliveries; they are local context/API lifetime failures and should be contained separately.
- Guaranteeing that an old extension instance can continue operating after `/reload`; the goal is safe degradation, not cross-reload resurrection.

## Decisions

### Introduce a live context/API accessor

Add a small helper inside the relay runtime, or a dedicated runtime utility module, that owns access to the latest session-bound objects and provides guarded operations such as:

- `getLiveContext(): ExtensionContext | undefined`
- `withLiveContext(operation, options): Promise<T> | T | undefined`
- `safeNotifyLocal(message, level)`
- `safeSetStatus(key, value)`
- `safeRefreshRelayStatuses()`
- `safeSendUserMessage(content, options)`
- `safeAppendAudit(message)`
- `safePersistBinding(binding, revoked)`
- `safeAbort()` / `safeCompact()`

The helper should catch known stale-context/session-bound API failures and clear or ignore the stale reference rather than rethrowing from best-effort paths. For required controls it should return a typed unavailable result or throw a safe domain error that messenger handlers can report as offline/unavailable.

Alternative considered: wrap each existing `ctx.ui.*` or `pi.*` call in ad hoc `try/catch`. This is lower-effort but likely to regress because the failure pattern is cross-cutting and includes both context and extension API objects.

### Treat captured `pi` as session-bound too

Pi's stale-context guidance names both old `pi` and old command `ctx` as unsafe after replacement. PiRelay currently closes over `pi` in route actions such as `sendUserMessage`, `appendAudit`, and `persistBinding`.

Long-lived route actions should not assume the original extension API remains valid. They should call through the live accessor or a route action facade that can fail gracefully when the active extension instance is gone.

Alternative considered: only guard `ctx` because the observed error mentioned `ctx`. That would leave the same class of worker failures possible through `pi.sendUserMessage`, `pi.sendMessage`, or `pi.appendEntry`.

### Avoid fallback from latest context to captured context in long-lived callbacks

Long-lived route actions and deferred callbacks should not use `latestContext ?? ctx` when `ctx` was captured at route construction time. If no live current context exists, local UI/status operations should be skipped and required controls should return clear nonfatal errors to the messenger layer.

Synchronous command handlers may still use their current command context directly while they are executing. The restriction applies to callbacks that outlive the immediate command/session event.

### Replace broad `route.actions.context` with narrow safe route actions

`SessionRouteActions.context` currently exposes the raw extension context to Telegram, Discord, Slack, and broker code. That makes stale-context safety difficult to enforce because any adapter can call `route.actions.context.isIdle()`, `route.actions.context.cwd`, or `route.actions.context.ui.*` from delayed work.

Prefer narrow methods and plain data on `SessionRouteActions`, for example:

```text
isIdle(): boolean | "unavailable"
workspaceRoot(): string | undefined
getModel(): Model | undefined
sendUserMessage(...): DeliveryResult
appendAudit(...): void
notifyLocal(...): void
refreshLocalStatus(): void
abort(): ControlResult
compact(): Promise<ControlResult>
```

If removing `context` from the type is too disruptive in one pass, keep it temporarily as deprecated/internal and update long-lived adapter/broker paths first. Tests should ensure runtime hot paths no longer require direct context access.

### Treat local UI/status updates as best-effort side effects

Local notifications, status-line updates, lifecycle warning labels, widgets, and deferred refreshes should never determine core relay health. They are useful when a context is live, but stale-context failures must not crash lifecycle transitions, route registration, prompt handling, worker completion, or messenger notifications.

Non-stale errors from messenger adapters, state, config, and route registration should still be surfaced through safe diagnostics where a live context exists.

### Keep context-dependent controls explicit

Some route actions genuinely require live Pi access, such as prompt injection, abort, compact, model lookup, image lookup, and workspace file lookup. Those actions should resolve current live context/API state at call time and fail gracefully with explicit safe messages when no live context/API is available.

For example:

```text
remote abort
  ├─ live context/API available and session busy -> abort requested
  ├─ live context/API available and idle         -> already idle
  └─ no live context/API                         -> session unavailable/offline
```

### Test with throwing fake context and API objects

Add unit/integration tests with fake extension contexts and API methods that throw stale-context shaped errors. Cover at least:

- lifecycle notification failure reporting;
- deferred status refresh and route publish error reporting;
- route action local notifications;
- route action `sendUserMessage`, `appendAudit`, and `persistBinding`;
- adapter/broker remote abort/compact/prompt/file/image paths that currently read `route.actions.context`;
- live-context behavior still working unchanged.

## Risks / Trade-offs

- **Over-suppressing real errors** → Only suppress stale-context/session-bound API failures in best-effort paths; preserve non-stale errors where they indicate real messenger, state, config, or runtime failures.
- **Losing local diagnostics when context is stale** → Prefer safe debug/audit logging where available, but do not require local UI to record diagnostics.
- **Using a stale context to test if it is live can itself throw** → The helper must treat exceptions from accessing UI/status/session APIs as evidence that the context is unusable for that operation.
- **Route actions without a live context may become no-ops** → Return explicit safe errors for controls that require live Pi access, while skipping only purely decorative local status/notification updates.
- **Removing `route.actions.context` may touch many adapter tests** → Migrate incrementally by adding narrow helpers first, then replacing direct context reads in high-risk long-lived paths before considering type removal.
- **Confusing current live context with another session's context** → Use live context only for the current registered route/session; if the current live session no longer matches the route, controls should fail as unavailable rather than crossing sessions.

## Migration Plan

No persisted state migration is required. Implement the live-context/API guard, add narrow route action helpers, update runtime/adapter/broker call sites, and add regression tests. Existing bindings, routes, and messenger state remain valid.

A safe implementation order is:

1. Add stale-error detection and guarded best-effort UI/status helpers.
2. Add narrow live route actions for context/API-dependent behavior.
3. Migrate `extension-runtime.ts` deferred callbacks and route actions away from `latestContext ?? ctx` and raw captured `pi` calls.
4. Migrate adapter and broker call sites away from direct `route.actions.context` in long-lived or remote-triggered paths.
5. Keep command-handler-local UI interactions using the current command context unchanged where they cannot outlive the handler.

Rollback is possible by reverting the runtime helper and call-site changes; no state format changes are introduced.

## Open Questions

- Is there a stable Pi API to ask whether an extension context/API is active, or must PiRelay detect stale objects by catching the documented error?
- Should stale-context incidents be recorded in an internal debug log or audit event when no local UI context is available?
- Should `SessionRouteActions.context` be removed entirely in this change, or deprecated with import/usage checks and removed in a follow-up?
