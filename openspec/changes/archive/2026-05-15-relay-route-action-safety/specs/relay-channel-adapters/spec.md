## ADDED Requirements

### Requirement: Adapters delegate route-action safety
Telegram, Discord, Slack, and future live messenger adapters SHALL use shared route-action safety outcomes or equivalent shared helpers for fallible Pi route actions instead of duplicating incompatible availability, rollback, and stale-error handling at each platform edge.

#### Scenario: Adapter delivers prompt through shared safety
- **WHEN** a live messenger adapter accepts an authorized prompt for a selected route
- **THEN** it invokes the route prompt through shared safety semantics that classify accepted, busy, unavailable, and failed outcomes consistently with other adapters

#### Scenario: Adapter registers platform cleanup hooks
- **WHEN** an adapter starts platform-specific typing, activity, thinking reaction, or shared-room output routing before a fallible route action
- **THEN** it registers cleanup or rollback behavior with the operation so unavailable outcomes do not leave stale platform state active

#### Scenario: Adapter renders unavailable outcome consistently
- **WHEN** a shared route-action safety helper returns an unavailable outcome
- **THEN** the adapter renders safe unavailable guidance using platform-appropriate text or interaction responses
- **AND** it does not convert the outcome into unknown-command help, successful delivery acknowledgement, or adapter health failure

#### Scenario: Adapter preserves platform failures
- **WHEN** platform I/O or adapter transport fails independently of route availability
- **THEN** the adapter still records or reports that platform failure according to its existing diagnostics and does not hide it as a route-unavailable outcome

### Requirement: Adapter status uses coherent route probes
Messenger adapters SHALL build session lists, active-session status, and availability displays from shared coherent route probes so online, busy, and model fields cannot disagree after a stale route is discovered.

#### Scenario: Session list sees unavailable model probe
- **WHEN** a route becomes unavailable while an adapter builds a session list that includes model information
- **THEN** the adapter lists that route as offline or unavailable rather than online with only the model omitted

#### Scenario: Status sees unavailable idle probe
- **WHEN** a route availability probe reports unavailable during a status command
- **THEN** the adapter reports the session offline or unavailable and does not display it as idle or busy
