## ADDED Requirements

### Requirement: Typed route action outcomes
The system SHALL represent route action results with typed, machine-readable outcomes that distinguish success, route unavailability, control-specific states such as already-idle, and non-unavailable failures.

#### Scenario: Unavailable route outcome is not inferred from display text
- **WHEN** a route action cannot execute because the Pi session context or session-bound API is unavailable
- **THEN** the action safety layer returns or throws a typed unavailable route result that callers can identify without comparing user-facing message strings

#### Scenario: Non-unavailable failure remains distinct
- **WHEN** a route action fails because of a non-stale programmer, platform, state, or validation error
- **THEN** the action safety layer preserves a distinct failure outcome rather than converting it to a route-unavailable result

#### Scenario: User-facing unavailable message remains safe
- **WHEN** a typed unavailable route outcome is rendered to a messenger user
- **THEN** the response uses safe offline guidance and does not expose stack traces, raw session paths, hidden prompts, tool internals, or captured context details

### Requirement: Coherent route availability probe
The system SHALL provide a shared route availability probe that evaluates route liveness, idle/busy state, and requested route metadata without losing the unavailable state when a later probe discovers stale or missing session-bound objects.

#### Scenario: Idle probe reports unavailable
- **WHEN** a route's live Pi context cannot be resolved or reports a stale session-bound reference during idle detection
- **THEN** the shared route probe reports the route as unavailable rather than idle or busy

#### Scenario: Model probe invalidates availability
- **WHEN** a route initially appears available but model lookup reports a stale session-bound reference during the same route probe
- **THEN** the shared route probe reports the route as unavailable and callers do not render it as online with only the model omitted

#### Scenario: Workspace probe invalidates availability
- **WHEN** workspace-root lookup for a selected route reports a stale session-bound reference
- **THEN** the shared route probe reports the route as unavailable and protected file or image operations do not proceed with fallback workspace data

### Requirement: Route operation rollback
The system SHALL treat route actions that reserve mutable state before execution as transactions that either commit on successful acceptance or roll back on unavailable and failure outcomes.

#### Scenario: Requester context rolls back when prompt is unavailable
- **WHEN** a messenger prompt reserves remote requester context and route prompt delivery becomes unavailable before the prompt is accepted
- **THEN** the requester context and pending-turn state are cleared instead of being retained for a later unrelated turn

#### Scenario: Activity indicators roll back when prompt is unavailable
- **WHEN** a prompt operation starts typing, activity, thinking reaction, or equivalent platform indicator before route delivery becomes unavailable
- **THEN** the operation invokes the registered rollback cleanup or stops future refreshes before returning the unavailable response

#### Scenario: Shared-room output destination rolls back when prompt is unavailable
- **WHEN** a shared-room one-shot prompt reserves an output destination and route delivery becomes unavailable before acceptance
- **THEN** the reserved shared-room destination is cleared so later private or different-conversation turns cannot deliver output to the stale room

#### Scenario: Abort flag rolls back when abort is unavailable
- **WHEN** an abort operation marks a route as abort-requested and the route abort call then reports unavailable
- **THEN** the abort-requested flag is cleared before the messenger or broker receives the unavailable response

### Requirement: Shared prompt operation safety
The system SHALL execute messenger prompt delivery through shared route-action safety semantics that cover availability probing, requester reservation, busy delivery mode selection, route invocation, rollback, and accepted-prompt metadata.

#### Scenario: Idle prompt is accepted
- **WHEN** an authorized messenger prompt targets an available idle route
- **THEN** the shared prompt operation injects the prompt, records the requester for the turn, returns an accepted idle outcome, and allows the adapter to acknowledge delivery

#### Scenario: Busy prompt is accepted with delivery mode
- **WHEN** an authorized messenger prompt targets an available busy route
- **THEN** the shared prompt operation injects the prompt with the configured busy delivery mode and returns an accepted busy outcome that the adapter can render as queued or steered

#### Scenario: Prompt delivery race becomes unavailable
- **WHEN** a route becomes unavailable after the precheck but before or during prompt injection
- **THEN** the shared prompt operation returns an unavailable outcome, rolls back reserved state, and does not mark the messenger adapter runtime unhealthy

### Requirement: Shared control operation safety
The system SHALL execute abort and compact controls through shared route-action safety semantics that handle idle/unavailable prechecks, post-precheck unavailable races, rollback, and typed outcomes.

#### Scenario: Abort on busy route succeeds
- **WHEN** an authorized abort targets an available busy route
- **THEN** the shared abort operation requests cancellation and returns a successful control outcome

#### Scenario: Abort on idle route reports already idle
- **WHEN** an authorized abort targets an available idle route
- **THEN** the shared abort operation returns an already-idle outcome and does not call the route abort action

#### Scenario: Compact unavailable race is contained
- **WHEN** an authorized compact request passes an availability precheck but the route becomes unavailable during compaction
- **THEN** the shared compact operation returns an unavailable outcome rather than throwing an uncaught error or reporting successful compaction

### Requirement: Shared media and workspace action safety
The system SHALL execute latest-image retrieval, explicit image lookup, and requester-scoped workspace file lookup through route-action safety semantics that preserve route/session boundaries and fail closed when the route workspace is unavailable.

#### Scenario: Latest images do not cross sessions
- **WHEN** a route is replaced by another session route
- **THEN** latest-turn image data and workspace image candidates from the previous session are not returned by the new route's latest-image operation

#### Scenario: Explicit image lookup sees unavailable workspace
- **WHEN** an authorized user requests a workspace image and the route workspace probe reports unavailable
- **THEN** the operation returns a safe unavailable or image-load failure before reading the file

#### Scenario: Requester file lookup sees unavailable workspace
- **WHEN** an assistant or remote user requests a workspace file and the route workspace probe reports unavailable
- **THEN** the operation refuses the file delivery without falling back to another route, another requester, or a stale workspace root
