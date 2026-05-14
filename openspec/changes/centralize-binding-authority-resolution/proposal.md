## Why

Recent revoked-binding hardening fixed the observed delivery leaks, but it required several review iterations because the same authority invariant is duplicated across Telegram, Discord, Slack, broker routes, recent-binding caches, and timer cleanup paths. PiRelay needs a named, shared binding-authority layer so persisted revocation, pause, movement, and state-read failure are enforced consistently before protected delivery or control side effects.

## What Changes

- Introduce a shared revocation-aware binding-authority capability that resolves Telegram and channel bindings from an operation snapshot loaded once per operation.
- Return structured resolution outcomes (`active`, `paused`, `revoked`, `moved`, `missing`, `state-unavailable`) instead of relying on ad-hoc `binding | undefined` checks.
- Require protected outbound delivery, callbacks/actions, activity indicators, progress timers, lifecycle notifications, requester file delivery, and broker forwarding to fail closed when authoritative state is unavailable or says a binding is not active.
- Require timer/activity/progress state to use stable captured destination keys and clear by those keys rather than deriving cleanup keys from mutable route state.
- Bound recent/in-memory binding fallback so it can never override persisted revoked/paused/moved state and is not used when state availability is unknown.
- Reduce duplicated active-binding logic across adapter runtimes and broker code by moving pure resolution rules into shared relay modules with focused tests.

## Capabilities

### New Capabilities
- `relay-binding-authority`: Shared binding authority snapshots and resolution outcomes for active, paused, revoked, moved, missing, and state-unavailable Telegram/channel bindings.

### Modified Capabilities
- `messenger-relay-sessions`: Protected messenger delivery and controls must use binding authority checks and stable destination keys before side effects.
- `relay-broker-topology`: Broker route registration, route resync, progress/activity timers, and future forwarding must use authority snapshots and fail closed on unavailable state.
- `relay-channel-adapters`: Adapter runtimes must delegate common binding-authority decisions to shared helpers instead of duplicating divergent active/recent-binding logic.
- `relay-code-architecture`: Binding authority resolution belongs in shared pure modules with adapter/broker edges limited to I/O and state loading.

## Impact

- Affected code: `extensions/relay/state/`, `extensions/relay/core/`, `extensions/relay/adapters/{telegram,discord,slack}/runtime.ts`, `extensions/relay/broker/process.js` or broker-side shared helpers, lifecycle/progress/file delivery call sites, and related tests.
- Public behavior: no new remote commands; existing delivery, callback, lifecycle, and file behavior becomes stricter and more consistent around revoked, paused, moved, missing, or unreadable state.
- Safety: state-read or parse failure for protected delivery is treated as unavailable and fails closed rather than silently falling back to volatile in-memory bindings.
- Dependencies: no new runtime dependencies are expected.
