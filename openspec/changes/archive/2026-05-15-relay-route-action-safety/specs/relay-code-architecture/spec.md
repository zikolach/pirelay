## ADDED Requirements

### Requirement: Route-action safety is shared core logic
The system SHALL place reusable route-action outcome types, availability probes, and operation safety helpers in shared relay modules instead of embedding the same route-lifetime transaction logic separately in Telegram, Discord, Slack, or broker edges.

#### Scenario: Shared route-action helper is added
- **WHEN** a helper models route availability, typed route action outcomes, prompt delivery safety, abort safety, compact safety, media workspace safety, or route status probing
- **THEN** it lives under a shared relay module such as `extensions/relay/core/` with focused unit tests

#### Scenario: Adapter imports route-action helper
- **WHEN** a messenger adapter needs to execute a fallible Pi route action
- **THEN** it imports the shared route-action safety contract and keeps only platform-specific command parsing, transport calls, and response rendering in the adapter module

#### Scenario: Broker imports route-action helper
- **WHEN** broker runtime code needs to forward or execute a fallible route action
- **THEN** it uses the shared route-action safety contract or a thin broker-compatible wrapper with parity tests instead of duplicating adapter-specific stale-route logic

### Requirement: Deprecated raw route context remains quarantined
Long-lived adapter and broker paths SHALL NOT add new direct dependencies on deprecated raw `SessionRouteActions.context` for route liveness, workspace, model, UI, prompt, abort, or compact behavior.

#### Scenario: New long-lived route code needs route liveness
- **WHEN** new remote, timer, broker, or adapter code needs to know whether a route is available, idle, busy, or has a workspace/model
- **THEN** it uses shared route-action safety helpers or narrow route actions rather than reading raw extension context directly

#### Scenario: Remaining raw context use is reviewed
- **WHEN** validation or review finds remaining `route.actions.context` usage
- **THEN** the usage is either removed, covered by a compatibility helper, or documented as synchronous and not long-lived
