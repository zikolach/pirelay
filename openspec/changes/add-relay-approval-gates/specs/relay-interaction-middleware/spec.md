## ADDED Requirements

### Requirement: Approval-gated actions in middleware
The middleware pipeline SHALL carry approval-required classifications and approval actions without coupling them to Telegram-specific update shapes.

#### Scenario: Middleware classifies action as approval-required
- **WHEN** policy evaluation classifies an operation or internal relay action as requiring confirmation
- **THEN** the middleware result marks the action with `requires-confirmation` safety and approval metadata before any operation is allowed to proceed

#### Scenario: Approval action enters middleware
- **WHEN** a messenger callback, button interaction, or text fallback represents an approval decision
- **THEN** middleware normalizes it as an approval action containing channel, instance, conversation/thread, user, session, operation, approval id, and requested decision metadata

#### Scenario: Approval output is unsafe for channel
- **WHEN** approval middleware receives secret-sensitive operation data
- **THEN** it blocks or redacts that data before any channel response is rendered

### Requirement: Approval state uses shared stale-action handling
Approval decisions SHALL use the same stale-state and authorization protections as guided answers, dashboards, full-output buttons, image buttons, and file-delivery actions.

#### Scenario: Stale approval action is invoked
- **WHEN** a messenger action references approval state that is expired, completed, cancelled, or no longer current
- **THEN** middleware rejects it as stale and does not resolve any active approval

#### Scenario: Revoked binding invokes approval action
- **WHEN** a revoked, paused, disconnected, or mismatched binding invokes an approval action
- **THEN** middleware rejects the action before resolving approval state or unblocking a tool call

#### Scenario: Approval decision targets offline session
- **WHEN** a valid approval decision targets a session that is offline or whose owning client no longer has the pending operation
- **THEN** PiRelay reports a safe stale/offline response and does not approve the operation
