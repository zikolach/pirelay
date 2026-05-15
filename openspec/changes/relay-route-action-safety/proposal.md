## Why

Recent stale-context fixes required many review iterations because prompt delivery, controls, media lookup, requester ownership, activity indicators, and route availability are guarded independently in Telegram, Discord, Slack, broker, and runtime code. PiRelay needs a shared route-action safety contract so expected session-lifetime failures are handled consistently, pre-action state is rolled back, and adapters stop reimplementing subtle route liveness transactions.

## What Changes

- Introduce a shared route-action safety capability that models route availability and action results with structured outcomes rather than display-string matching.
- Centralize prompt, abort, compact, workspace/media lookup, requester ownership, and route status probes behind reusable helpers or an equivalent route-operation facade.
- Require every state reservation made before a fallible route action, such as requester context, activity indicators, shared-room output destinations, and abort flags, to be committed only on success or rolled back on unavailable/failure outcomes.
- Treat expected route-unavailable outcomes as session lifecycle state, not messenger adapter health failures.
- Make route status/session snapshots compute liveness, busy state, and model availability through one coherent safe probe so stale discoveries cannot render a route online after invalidating it.
- Keep messenger authorization, binding authority, and platform transport behavior unchanged; this change only centralizes route-action execution safety after a route has been selected and authorized.

## Capabilities

### New Capabilities
- `relay-route-action-safety`: Shared route availability probes, typed action outcomes, route-operation transaction helpers, rollback semantics, and adapter/broker integration rules for fallible Pi route actions.

### Modified Capabilities
- `messenger-relay-sessions`: Prompt delivery, controls, media retrieval, output ownership, and remote requester context must use route-action safety outcomes before acknowledging success or preserving turn-scoped state.
- `relay-channel-adapters`: Telegram, Discord, Slack, and future adapters must delegate common route-action liveness, rollback, and unavailable-response behavior to shared helpers instead of duplicating divergent precheck/catch logic.
- `relay-broker-topology`: Broker-mediated route actions must use the same route-action safety outcomes as in-process adapters and must not turn unavailable route races into successful broker responses or uncaught failures.
- `relay-code-architecture`: Route-action safety belongs in shared pure/core modules with adapter and broker code limited to platform I/O, state loading, and response rendering.
- `relay-runtime-status-line`: Runtime status snapshots must preserve unavailable route state consistently when any safe route probe discovers stale or unavailable session-bound objects.

## Impact

- Affected code: `extensions/relay/core/route-actions.ts`, `extensions/relay/core/relay-core.ts`, `extensions/relay/core/types.ts`, `extensions/relay/runtime/extension-runtime.ts`, `extensions/relay/adapters/{telegram,discord,slack}/runtime.ts`, `extensions/relay/broker/tunnel-runtime.ts`, requester/file/media helpers, presenters, and related tests.
- Public behavior: remote users should see the same safe unavailable/offline guidance, while fewer route races leak stale requester/output state or mark messenger runtimes unhealthy.
- Tests: add pure unit tests for route-action outcome helpers and integration/runtime tests that exercise unavailable races across prompt delivery, abort, compact, media/file lookup, status/session listing, shared-room output destinations, and requester-scoped actions.
- Dependencies: no new runtime dependencies expected.
