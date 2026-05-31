## ADDED Requirements

### Requirement: Approval gates are explicit opt-in remote guardrails
PiRelay SHALL keep approval gates disabled unless explicitly enabled and SHALL scope enabled approval gates to remote messenger-owned turns.

#### Scenario: Approval gates are disabled by default
- **WHEN** approval gate configuration is absent, empty, or only contains rules without `enabled: true`
- **THEN** PiRelay does not classify matching tool calls for approval
- **AND** it does not create approval requests, wait for messenger decisions, or block tool execution because of approval gates

#### Scenario: Approval gates are explicitly disabled
- **WHEN** config sets `approvalGates.enabled` to `false` or the environment override sets `PI_RELAY_APPROVAL_ENABLED=false`
- **THEN** PiRelay treats approval gates as disabled even if rules are present
- **AND** remote and local turns proceed according to normal prompt/tool behavior without approval-gate blocking

#### Scenario: Approval gates are explicitly enabled
- **WHEN** config or environment resolves approval gates with `enabled: true` and at least one rule matches a sensitive tool call during a remote-owned turn
- **THEN** PiRelay creates a bounded approval request for the authorized remote requester
- **AND** the tool call remains blocked until the requester approves or the request fails, is denied, or expires

### Requirement: Local turns never require messenger approval
Local Pi prompts SHALL bypass approval-gate enforcement even when an enabled approval rule would match the tool call.

#### Scenario: Local prompt matches an approval rule
- **WHEN** the local Pi user starts a turn without an accepted remote messenger prompt and the turn calls a tool matching an enabled approval rule
- **THEN** PiRelay allows the tool call to proceed without creating a messenger approval request
- **AND** it does not block with a missing-remote-requester error

#### Scenario: Local prompt follows a remote turn
- **WHEN** a previous remote-owned turn completed or ended and a later local Pi prompt calls a tool matching an enabled approval rule
- **THEN** PiRelay treats the later turn as local
- **AND** stale remote requester state from the earlier turn does not cause an approval request or delivery to the old messenger conversation

#### Scenario: Local prompt has active bindings
- **WHEN** a session is paired with Telegram, Discord, Slack, or future messengers but the current turn was started locally
- **THEN** PiRelay does not use those bindings as approval request destinations
- **AND** it does not require any paired messenger user to approve the local tool call

### Requirement: Remote approval failures remain fail-closed
Enabled approval gates SHALL continue to fail closed for remote-owned turns when approval cannot be completed safely.

#### Scenario: Remote requester approves matching operation
- **WHEN** an authorized remote messenger prompt is accepted, the resulting turn calls a tool matching an enabled approval rule, and the same active requester approves before expiry
- **THEN** PiRelay permits the pending tool call according to the approval decision scope
- **AND** records only bounded non-secret approval audit data

#### Scenario: Remote requester is unavailable for matching operation
- **WHEN** an authorized remote messenger prompt is accepted and the resulting turn calls a tool matching an enabled approval rule but its requester context is missing, stale, revoked, paused, or not current
- **THEN** PiRelay blocks the tool call with a safe approval-required failure
- **AND** it does not treat the operation as local or auto-approve it

#### Scenario: Remote approval cannot be delivered or expires
- **WHEN** an enabled approval request for a remote-owned turn cannot be delivered, is denied, or expires before approval
- **THEN** PiRelay blocks the matching tool call
- **AND** it records a bounded non-secret audit event for the failure outcome
