## Context

PR #44 hardened revoked-binding delivery by adding active-binding guards and cache cleanup in Telegram, Discord, Slack, and the broker. The bug class was broader than one delivery path: persisted state said a binding was revoked, but volatile route state, recent-binding caches, or timer callbacks still had enough address information to send.

The resulting fixes are correct but scattered. Equivalent logic now exists in multiple forms:

```text
                      persisted state
                            │
                            ▼
┌────────────┐   ┌───────────────┐   ┌────────────┐
│ Telegram   │   │ Discord/Slack │   │ Broker JS  │
│ route guard│   │ activeBinding │   │ route guard│
└─────┬──────┘   └───────┬───────┘   └─────┬──────┘
      │                  │                 │
      ▼                  ▼                 ▼
progress/activity   recent caches     route registration
callbacks/files     typing/progress    callbacks/progress
```

This duplication caused review churn: one iteration fixed stale route authority, later iterations fixed blocking reads in timer paths, repeated state reads, stale typing targets, and cleanup by mutable route state. The design improvement is to make binding authority a first-class shared concept instead of a convention each edge reimplements.

## Goals / Non-Goals

**Goals:**

- Centralize revocation-aware binding resolution for Telegram and channel adapters.
- Load persisted state once per protected operation and resolve all needed bindings from that snapshot.
- Preserve exact destination identity for timers and deferred work so cleanup and send decisions do not depend on mutable route state.
- Fail closed for protected delivery when authoritative state cannot be read or parsed.
- Keep recent/in-memory binding fallback narrow and unable to override persisted revoked, paused, or moved records.
- Make adapter and broker code read like I/O orchestration around a shared authority decision.

**Non-Goals:**

- Adding new remote commands or changing user-facing command syntax.
- Migrating persisted state schema or deleting revoked tombstones.
- Rewriting Telegram as a generic channel adapter in this change.
- Introducing a long-lived state cache, database, daemon, or new runtime dependency.
- Changing local `/relay disconnect` or remote conversation-scoped `/disconnect` semantics beyond enforcing them consistently.

## Decisions

### Decision: Introduce a binding-authority snapshot

A protected operation should load state once, then pass a pure snapshot object through all resolution checks needed by that operation.

```text
operation begins
      │
      ▼
load TunnelStoreData once
      │
      ▼
BindingAuthoritySnapshot
      │
      ├── resolveTelegram(expected)
      ├── resolveChannel(expected)
      └── classifyFallback(candidate)
```

The snapshot may be backed by `TunnelStateStore.load()` in TypeScript runtimes and by equivalent broker state loading in the broker process. The important invariant is that one command/timer/delivery attempt does not perform N disk reads for N routes or repeated active/raw lookups for the same route.

**Alternative considered:** keep store methods such as `getActiveBindingForSession()` as the only API. Those helpers are useful, but call-site composition easily causes repeated reads and duplicated fallback logic.

### Decision: Return structured outcomes, not only `undefined`

Authority resolution should distinguish why delivery is not allowed:

```text
active ─────────▶ may send
paused ─────────▶ skip delivery, keep pairing
revoked ────────▶ clear volatile state, require re-pairing
moved ──────────▶ clear stale destination state
missing ────────▶ fallback only when explicitly permitted
state-unavailable ─▶ fail closed, no volatile fallback
```

`binding | undefined` remains acceptable at narrow call sites that only need a yes/no send decision, but the shared resolver should expose richer outcomes so timers, route registration, and diagnostics can perform the correct cleanup.

**Alternative considered:** encode all non-active cases as `undefined`. That keeps APIs small but hides whether a caller should clear volatile state, preserve paused state, or report a diagnostic.

### Decision: Treat state unavailability differently from an empty store

Missing state files can still mean a fresh install. Corrupt JSON, permission errors, partial writes, or unreadable state are different: for protected delivery they mean PiRelay cannot prove the binding is still active.

```text
state missing        => empty snapshot, normal setup/pairing path
state unreadable     => state-unavailable for protected delivery
state parse failure  => state-unavailable for protected delivery
```

Protected messenger delivery, callbacks/actions, file uploads, lifecycle notifications, typing/progress refreshes, and broker forwarding must fail closed on `state-unavailable` and must not fall back to recent/in-memory bindings.

**Alternative considered:** continue collapsing all load errors to an empty store. That is convenient for UX, but it can turn a state failure into an implicit permission to use stale volatile bindings.

### Decision: Capture stable destination keys for deferred work

Timers and deferred tasks should carry immutable destination identity captured at scheduling time:

```text
Telegram: sessionKey + chatId + userId when available
Channel:  channel + instanceId + sessionKey + conversationId + userId
```

Cleanup should delete by the captured key. The route may still be consulted for current turn status, but it should not be the source of the cleanup key after a revoked/moved binding clears or replaces route metadata.

**Alternative considered:** keep deriving keys from `route.binding` or recent caches. That is exactly the pattern that leaked progress state when `route.binding` was already cleared.

### Decision: Make recent binding fallback explicit and bounded

Recent/in-memory binding caches are useful during short windows where a live route has not yet round-tripped through persisted state. They are not authoritative.

Fallback is allowed only when all are true:

- the authoritative state snapshot was loaded successfully;
- there is no persisted record for that session and messenger instance;
- the recent candidate exactly matches the expected conversation/user/instance/session;
- the candidate is not paused/revoked according to its own metadata;
- the call site explicitly allows volatile fallback.

Fallback is not allowed when the persisted record exists and says revoked, paused, or moved, and not allowed when state is unavailable.

**Alternative considered:** remove recent fallback entirely. That would be simpler but may break live route startup/registration behavior that currently tolerates a short persistence lag.

### Decision: Shared pure helpers live outside adapter edges

The authority rules should live in shared relay modules, likely under `extensions/relay/state/` or `extensions/relay/core/`, with pure helpers that can be unit tested without messenger clients, sockets, timers, or filesystem writes.

Adapter runtimes and broker code should become thin edges:

```text
load state / receive route / own timer
          │
          ▼
shared authority resolver
          │
          ▼
send, skip, clear key, or report safe diagnostic
```

The broker process is currently plain JavaScript, so implementation may either expose a JS-safe helper, move broker authority logic into an importable shared module, or keep a very small broker wrapper around the same pure resolution semantics. The contract matters more than the exact packaging.

**Alternative considered:** leave logic local to each adapter because each messenger has different address fields. The fields differ, but the state authority lattice is the same.

## Risks / Trade-offs

- **Risk: More explicit outcome types make call sites noisier.** → Provide small convenience helpers for common yes/no send decisions while keeping structured outcomes available for cleanup and diagnostics.
- **Risk: State-unavailable fail-closed behavior may suppress messages during transient filesystem errors.** → This is safer than leaking to a revoked or moved binding; emit local secret-safe diagnostics so users can repair state.
- **Risk: Broker and TypeScript runtime helpers diverge if the broker cannot import the shared module directly.** → Add parity tests and keep the broker wrapper minimal, or move reusable logic to a module format both sides can consume.
- **Risk: Existing tests may depend on empty-store fallback for corrupt state.** → Separate setup/fresh-install behavior from protected delivery behavior in tests.
- **Risk: Refactoring active-binding checks could accidentally change remote disconnect scope.** → Preserve conversation-scoped remote disconnect and local all-binding disconnect tests as regression coverage.

## Migration Plan

1. Add pure binding-authority resolution types and tests for Telegram and channel bindings.
2. Introduce state-loading results that distinguish `missing` from `unavailable` for protected operations.
3. Migrate adapter timer/deferred paths to captured destination keys and key-based cleanup.
4. Migrate outbound delivery, callbacks/actions, file delivery, lifecycle, and route registration call sites to authority snapshots.
5. Migrate broker route registration, sessions lookup, progress/activity timers, and send paths to load state once per operation.
6. Remove or restrict sync/hot-path helper use once async snapshot paths are in place.
7. Run targeted adapter/broker revocation tests, then full typecheck/test/OpenSpec validation.

Rollback is straightforward because no persisted schema migration is planned; if needed, revert to the prior per-adapter active-binding helpers while keeping tests that document the intended authority invariant.

## Open Questions

- Should `state-unavailable` produce a visible local status-line diagnostic, a debug log only, or both?
- Should recent fallback remain available for all messengers, or only during route registration/startup paths?
- Should the broker process import shared TypeScript/compiled helpers directly, or should the authority helper be authored in a broker-compatible shared module?
- Should this change also remove currently unused synchronous state-store helper methods, or leave that cleanup to a smaller follow-up?
