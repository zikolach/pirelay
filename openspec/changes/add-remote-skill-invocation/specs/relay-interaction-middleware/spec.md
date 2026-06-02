## ADDED Requirements

### Requirement: Skill interactions resolve through middleware actions
The relay interaction pipeline SHALL classify remote skill discovery, selection, pending input, cancellation, and invocation as internal relay actions before any prompt or skill invocation is delivered to Pi.

#### Scenario: Skill list command is handled by middleware
- **WHEN** an authorized inbound messenger event is parsed as `skills` or an equivalent skill-list command
- **THEN** the pipeline resolves it to a skill-discovery action for the selected route
- **AND** it does not inject the command text into Pi as an ordinary prompt

#### Scenario: Skill invocation command is handled by middleware
- **WHEN** an authorized inbound messenger event is parsed as `skill <name> [input]` or an equivalent skill invocation command
- **THEN** the pipeline resolves it to a skill invocation or pending-input action after skill policy validation
- **AND** it does not inject the raw command text into Pi separately

#### Scenario: Pending skill input captures next text
- **WHEN** a requester-scoped pending skill-input state exists and the same authorized requester sends non-command text before expiry
- **THEN** middleware classifies that text as skill input for the pending invocation
- **AND** it bypasses ordinary prompt routing for that message

#### Scenario: Skill cancellation is internal
- **WHEN** a requester with pending skill input sends `/cancel`, `skill cancel`, or an equivalent platform action
- **THEN** middleware clears only that requester's pending skill state
- **AND** it does not inject the cancellation text into Pi

#### Scenario: Skill action targets offline session
- **WHEN** middleware resolves a skill action that requires an online session but the selected session or remote owning machine is offline
- **THEN** the system reports the offline state to the originating messenger
- **AND** it does not silently drop the action or inject a fallback prompt

#### Scenario: Skill action is stale
- **WHEN** a delayed button, retried event, duplicate ingress, expired pending state, or superseded route refers to a skill action that is no longer current
- **THEN** middleware rejects the action as stale
- **AND** it does not invoke a skill or deliver pending input to Pi
