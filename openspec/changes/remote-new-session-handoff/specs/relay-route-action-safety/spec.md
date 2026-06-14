## ADDED Requirements

### Requirement: New-session route action uses typed outcomes
The system SHALL execute remote new-session requests through shared route-action safety helpers that return typed outcomes for success, unavailable route, busy route, unsupported capability, cancellation, authorization failure, and execution failure.

#### Scenario: New-session action succeeds
- **WHEN** a route-action caller requests a new session for an authorized selected idle route with command-capable session-control support
- **THEN** the helper executes the new-session action and returns a success outcome containing safe replacement-route information needed for handoff
- **AND** it does not expose raw session file paths, raw session keys, messenger destination ids, or secrets in user-facing text

#### Scenario: New-session action reports unavailable route
- **WHEN** the selected route becomes offline, stale, revoked, moved, or unavailable before the new-session action executes
- **THEN** the helper returns an unavailable outcome
- **AND** no binding migration, prompt injection, or session-control operation is attempted

#### Scenario: New-session action reports busy route
- **WHEN** the selected route is running a turn, waiting for approval, capturing a custom answer, or otherwise not safe to replace under the configured policy
- **THEN** the helper returns a busy or confirmation-required outcome
- **AND** it does not cancel or abandon the active operation unless a later explicit confirmation policy allows it

#### Scenario: New-session action reports unsupported capability
- **WHEN** the route is online but no command-capable context or session-control action is available
- **THEN** the helper returns an unsupported-capability outcome
- **AND** adapters render that outcome as a safe limitation message instead of a generic failure

#### Scenario: Cancelled new-session leaves state unchanged
- **WHEN** Pi cancels or refuses the requested new-session operation
- **THEN** the helper returns a cancelled outcome
- **AND** old bindings, active selections, pending approvals, and custom-answer state are not migrated or cleared except for safe audit/status updates
