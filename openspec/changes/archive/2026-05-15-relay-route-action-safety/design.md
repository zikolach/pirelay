## Context

PiRelay's long-lived messenger routes expose `SessionRouteActions` that are invoked by Telegram, Discord, Slack, broker requests, timers, callbacks, requester-scoped tools, and completion delivery after the original Pi event has returned. The `fix-stale-extension-context` work made these actions safer by resolving live context at call time and by returning an unavailable state when Pi reports stale session-bound objects. Review feedback on that change still found repeated sibling issues because each adapter call site combines availability checks, state reservation, route action invocation, cleanup, and response rendering by hand.

The current high-risk shape is:

```text
adapter/broker event
      │
      ▼
routeIdleState(route) precheck
      │
      ├── reserve mutable state
      │     - route.remoteRequester
      │     - remoteRequesterPendingTurn
      │     - shared-room output destination
      │     - typing/activity/reaction timers
      │     - notification.abortRequested
      │
      ▼
route.actions.<send|abort|compact|image|file|model>()
      │
      ├── success: acknowledge, audit, keep turn state
      ├── unavailable: respond safely and roll back reservations
      └── platform/unknown failure: report or surface according to adapter policy
```

The same transaction appears with small differences in Telegram, Discord, Slack, and broker paths. That makes future review expensive: every stale-route fix invites a search for equivalent call paths with a missing rollback, stale requester, stale activity indicator, stale status, or wrong health classification.

This change introduces a shared route-action safety layer that sits after authorization/binding resolution but before messenger response rendering:

```text
Inbound event
    │
    ▼
Authorization + binding authority
    │
    ▼
Route action safety
    │   - probe route availability coherently
    │   - reserve operation state
    │   - invoke route action
    │   - commit or roll back state
    │   - return typed outcome
    ▼
Adapter/broker response rendering
```

## Goals / Non-Goals

**Goals:**

- Make route-unavailable outcomes typed and machine-readable instead of relying on display-string equality.
- Centralize common route operation patterns for prompt delivery, abort, compact, latest-image retrieval, explicit workspace image/file lookup, requester ownership, and route status probing.
- Ensure mutable state reserved before a fallible route action is rolled back on unavailable or failed execution.
- Preserve unavailable/offline as a tri-state route result through status/session/model snapshots.
- Keep expected route-unavailable races out of messenger runtime health fields such as Discord/Slack `lastError`.
- Add table-driven tests that exercise the same invariant across Telegram, Discord, Slack, broker, and shared helpers.
- Keep adapter-specific transport side effects, command parsing, authorization, and platform rendering at the edges.

**Non-Goals:**

- Changing pairing, authorization, or binding authority semantics.
- Replacing `centralize-binding-authority-resolution`; route-action safety assumes the event has already passed the relevant binding/authorization check.
- Reworking broker federation, route ownership, or process supervision.
- Changing user-facing command names, messenger invocation syntax, or public file-delivery policy.
- Guaranteeing old routes can continue after a session reload; unavailable remains the safe outcome.
- Removing every direct `route.actions.*` call in one sweep if a call is simple, synchronous, and already safe; the priority is fallible route-lifetime operations with mutable state or user-visible acknowledgement.

## Decisions

### Decision: Introduce typed route action outcomes

Add a shared outcome model under `extensions/relay/core/route-actions.ts` or a sibling core module. The exact TypeScript names can evolve, but the contract should distinguish at least:

```text
ok(result?)
unavailable(message)
already-idle(message)       # for abort/control UX when applicable
failed(error, safeMessage)  # non-unavailable failure
```

Adapters should use an `isRouteUnavailableOutcome` or equivalent discriminator rather than comparing `error.message === unavailableRouteMessage()`.

**Rationale:** Display strings are for users, not control flow. The current string comparison makes it easy for new code to miss unavailable handling or to misclassify stale route races as platform failures.

**Alternative considered:** Keep throwing `Error(unavailableRouteMessage())` and add helper `isUnavailableRouteError(error)`. This is smaller and may be a migration step, but it still mixes domain state with exceptions and does not encourage operation-level rollback.

### Decision: Add coherent route availability probes

Introduce a single route probe helper that evaluates route liveness, idle/busy state, workspace/model availability where requested, and stale invalidation as one coherent snapshot. Status/session presenters and adapters should not compute `online`, `busy`, and `modelId` with independent route action calls that can invalidate each other mid-render.

Example shape:

```text
probeRoute(route, { includeModel?: true, includeWorkspace?: true })
  -> { kind: "unavailable", message }
  -> { kind: "available", idle, busy, model?, workspaceRoot? }
```

**Rationale:** PR feedback showed that preserving `undefined` unavailable state across multiple callers is subtle. A route can be considered online by one precheck and then invalidated by model/workspace access. One snapshot makes the intended behavior obvious.

**Alternative considered:** Teach every caller to recompute `routeIdleState` after `getModel` or `getWorkspaceRoot`. That spreads the invariant and increases review churn.

### Decision: Centralize prompt delivery operation safety

Provide a shared prompt operation helper or facade that owns the route-level sequence:

1. probe route availability;
2. reserve requester context and optional output destination/activity rollback hooks;
3. invoke `route.actions.sendUserMessage`;
4. on success, commit requester/turn state and return accepted idle/busy metadata;
5. on unavailable/failure, roll back reservations and return a typed outcome.

Adapters remain responsible for platform-specific text, reactions, typing calls, and acknowledgements, but they should register those side effects as start/rollback/commit hooks instead of hand-writing every race path.

**Rationale:** Prompt delivery has the most state: requester attribution, final-output routing, busy delivery mode, shared-room destinations, typing/reaction state, activity timers, audit, and immediate acknowledgements.

**Alternative considered:** Only wrap `route.actions.sendUserMessage`. That would catch stale errors but leave requester/activity/shared-room rollback duplicated in adapters.

### Decision: Centralize abort and compact control safety

Add shared helpers for abort and compact that:

- precheck route availability;
- distinguish idle vs busy when relevant;
- set and roll back `notification.abortRequested` only around a successful abort request;
- catch unavailable races after prechecks;
- return typed outcomes for messenger rendering and broker responses.

**Rationale:** Abort/compact races already caused repeated fixes in adapter and broker paths. These controls are conceptually identical across messengers.

**Alternative considered:** Keep adapter-local try/catch blocks. That is acceptable for messenger-specific response text but should not own state rollback or unavailable classification.

### Decision: Keep route-owned state mutations behind operation helpers

Mutable route fields that affect later delivery should be updated by shared helpers or via explicit operation hooks:

- `remoteRequester` and `remoteRequesterPendingTurn`;
- shared-room output destination state;
- `notification.abortRequested`;
- latest-turn media caches and workspace lookup context;
- activity/reaction/typing cleanup hooks.

Where state remains adapter-private, the helper should accept `onStart`, `onRollback`, and `onCommit` callbacks so cleanup is still transactionally tied to the route action outcome.

**Rationale:** The bug class is not only stale errors; it is stale errors after state was mutated. Rollback must be first-class.

**Alternative considered:** Add comments at call sites documenting cleanup expectations. Comments help review but do not create a tested contract.

### Decision: Preserve separation from binding authority

Route-action safety begins after authorization and binding authority decide that the inbound event may target the route. It must not decide whether a messenger conversation is authorized, active, paused, revoked, or moved. Those decisions stay in `centralize-binding-authority-resolution` and existing authorization code.

**Rationale:** Binding authority and route action safety are adjacent but different lattices:

```text
binding authority: active | paused | revoked | moved | missing | state-unavailable
route action:      available | unavailable | idle | busy | succeeded | failed
```

Combining them would make both abstractions harder to reason about.

**Alternative considered:** Build one large "safe messenger operation" layer that handles binding and route action state. That could be attractive later, but it is too broad for this change and risks conflating authorization with route lifetime.

### Decision: Make broker use the same route-action outcomes

Broker-mediated actions should call the same shared helpers as in-process runtimes or a thin broker-compatible wrapper with equivalent semantics. Broker responses should map typed outcomes to `{ ok: false, error }` without throwing uncaught unavailable races.

**Rationale:** PR feedback repeatedly found broker parity issues after adapter fixes. Broker paths are another adapter edge and should not own separate stale-route race logic.

**Alternative considered:** Keep broker behavior separate because it is currently simpler. That preserves duplication in exactly the paths that review has flagged.

### Decision: Incremental migration with compatibility shims

The implementation may start by adding typed unavailable errors/results and helper wrappers while keeping the existing `SessionRouteActions` shape. Direct raw `route.actions.context` remains deprecated. The migration should prioritize high-risk operations before optional cleanup.

**Rationale:** A full route facade could be cleaner but would touch many tests and increase PR size. A staged approach delivers review-churn reduction without blocking other active relay work.

**Alternative considered:** Remove `SessionRouteActions.context` and force all route operations through a new facade in one change. That is more complete but likely too disruptive and overlaps with stale-context archival timing.

## Risks / Trade-offs

- **Risk: Over-abstracting adapter behavior hides platform-specific UX.** → Keep rendering, platform transport, command parsing, and capability messages in adapters; centralize only route outcome and rollback invariants.
- **Risk: New helper APIs become too generic or hard to read.** → Start with concrete helpers for prompt, abort, compact, route probe, and media/workspace lookup; extract lower-level primitives only after repeated patterns are clear.
- **Risk: Typed outcomes require broad mechanical edits.** → Provide compatibility helpers for thrown unavailable errors during migration and convert call sites in risk order.
- **Risk: Broker JavaScript/TypeScript packaging diverges.** → Prefer shared TypeScript helpers used by broker runtime code where possible; if broker process needs a wrapper, cover it with parity tests.
- **Risk: Route status probes become more expensive.** → Keep probes cheap and configurable; only request model/workspace data when rendering actually needs it.
- **Risk: In-flight PR #46 already changes stale-context behavior.** → Implement after `fix-stale-extension-context` lands and archive/spec sync is complete, or explicitly rebase the proposal if the active stale-context spec changes before implementation.

## Migration Plan

1. Archive or rebase on the completed `fix-stale-extension-context` work so the live-context safety baseline is canonical.
2. Add route-action outcome types and unavailable detection helpers with unit tests.
3. Add coherent route probing for availability, idle/busy, model, and workspace access; migrate status/session snapshot helpers first.
4. Add prompt operation helper with requester and rollback hooks; migrate Telegram, Discord, Slack, and broker prompt paths.
5. Add abort and compact safety helpers; migrate adapter and broker control paths.
6. Add safe media/workspace helpers for latest images and explicit image/file lookup where route liveness and workspace context matter.
7. Replace remaining high-risk direct `route.actions.*` calls or document why each remaining call is safe.
8. Run typecheck, full tests, and strict OpenSpec validation.

Rollback is possible by reverting helper adoption and keeping the typed outcome helpers unused; no persisted state or external API migration is required.

## Open Questions

- Should the public domain result be exception-free (`RouteActionOutcome`) or should route actions throw a typed `RouteUnavailableError` that operation helpers convert to outcomes?
- Should route status probing include model lookup by default, or should model lookup remain opt-in to avoid invalidating availability during simple status checks?
- Should prompt operation helpers own audit append timing, or should adapters continue to append audit after a successful outcome?
- Should this change remove `SessionRouteActions.context` from the type entirely, or leave removal to a later cleanup after adapter/broker adoption?
