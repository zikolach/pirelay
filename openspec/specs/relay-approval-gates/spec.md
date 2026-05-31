# relay-approval-gates Specification

## Purpose
Defines opt-in remote approval gates for sensitive Pi tool operations, including policy classification, safe request summaries, decision and grant lifecycles, requester binding scoping, audit trails, broker behavior, and task-scoped approvals.

## Requirements
### Requirement: Approval policy classification
PiRelay SHALL support explicit opt-in policies that classify Pi operations as requiring approval before execution.

#### Scenario: No approval policy is enabled
- **WHEN** approval policies are disabled or absent for the current session
- **THEN** PiRelay preserves existing tool execution, prompt delivery, and messenger behavior without adding approval prompts

#### Scenario: Tool call matches approval policy
- **WHEN** Pi emits a pre-execution tool call whose tool name, category, path, command, or normalized summary matches an enabled approval policy
- **THEN** PiRelay classifies the operation as requiring approval before the tool call is allowed to execute

#### Scenario: Tool call does not match approval policy
- **WHEN** Pi emits a pre-execution tool call that does not match any enabled approval policy
- **THEN** PiRelay allows the tool call to continue without remote approval

#### Scenario: Pattern matching uses safe normalization
- **WHEN** PiRelay evaluates user-defined approval patterns
- **THEN** it may inspect local raw tool input for matching
- **AND** it stores and sends only bounded redacted summaries, not raw secrets, hidden prompts, file bytes, or full command output

### Requirement: Safe approval request summaries
PiRelay SHALL render approval requests using bounded safe operation summaries.

#### Scenario: Approval request is created
- **WHEN** an operation requires approval
- **THEN** PiRelay creates an approval request containing the session label, operation category, tool name, redacted short description, expiry, and decision options
- **AND** excludes hidden prompts, full transcripts, raw bot tokens, upload URLs, secret environment values, and oversized payloads

#### Scenario: Summary contains sensitive-looking content
- **WHEN** a command, path, or argument in an approval summary matches configured or built-in redaction rules
- **THEN** PiRelay redacts that content before persisting or sending the approval request

### Requirement: Approval decision lifecycle
PiRelay SHALL resolve each approval request exactly once as approved, denied, expired, cancelled, or failed.

#### Scenario: Authorized user approves pending operation once
- **WHEN** the authorized approval target approves an unexpired pending operation with approve-once scope
- **THEN** PiRelay allows that operation to proceed exactly once
- **AND** acknowledges the approval through the originating messenger when possible

#### Scenario: Authorized user denies pending operation
- **WHEN** the authorized approval target denies an unexpired pending operation
- **THEN** PiRelay blocks the operation
- **AND** acknowledges the denial through the originating messenger when possible

#### Scenario: Approval request expires
- **WHEN** a pending approval reaches its configured timeout without an authorized decision
- **THEN** PiRelay resolves the approval as expired and does not allow the operation to proceed

#### Scenario: Approval request is cancelled
- **WHEN** the owning session unregisters, disconnects, switches, aborts the relevant operation, or otherwise cancels pending approval state
- **THEN** PiRelay resolves or marks the approval as cancelled and rejects future decisions for that approval id

#### Scenario: Approval action is stale
- **WHEN** any user invokes an approval action for an expired, completed, cancelled, unknown, or superseded approval request
- **THEN** PiRelay rejects the action and does not affect any current operation

### Requirement: Approval grants
PiRelay SHALL support bounded reusable approval grants so authorized users can approve matching operations for an explicit scope without repeated prompts.

#### Scenario: User approves matching operations for the session
- **WHEN** the authorized approval target chooses an approve-for-session decision for an unexpired pending operation
- **THEN** PiRelay creates a session-scoped grant for the same session, requester binding, tool/category, and matcher fingerprint
- **AND** allows the current operation and future matching operations while the grant remains active

#### Scenario: Session grant is used
- **WHEN** a later operation matches an active session-scoped grant
- **THEN** PiRelay allows the operation without sending a new approval prompt
- **AND** records a bounded audit event that the session grant was used

#### Scenario: Session grant expires or is revoked
- **WHEN** the session ends, switches, unregisters, the binding is revoked or paused, the requester disconnects, the grant TTL expires, or the grant is explicitly revoked
- **THEN** PiRelay stops using that grant and requires a fresh approval for future matching operations

#### Scenario: Persistent grant option is disabled
- **WHEN** remote persistent grants are not explicitly enabled by local configuration
- **THEN** PiRelay does not offer a remote approve-forever or persistent approval action

#### Scenario: Persistent grant is explicitly enabled
- **WHEN** local configuration explicitly allows remote persistent grants and the authorized user chooses a persistent approval action
- **THEN** PiRelay creates a narrowly scoped persistent grant for the same requester/binding scope and matcher fingerprint
- **AND** records a non-secret audit event and exposes a revocation path

#### Scenario: Persistent grant is revoked or invalidated
- **WHEN** a persistent grant is revoked, expires, no longer matches the active binding/user constraints, or is invalid under current configuration
- **THEN** PiRelay does not use that grant to approve operations

### Requirement: Approval target scoping
PiRelay SHALL scope approval requests, decisions, and reusable grants to the active authorized requester and binding context.

#### Scenario: Remote requester context exists
- **WHEN** a sensitive operation is associated with an authorized remote turn requester
- **THEN** PiRelay sends the approval request only to that requester's active persisted messenger conversation or thread

#### Scenario: Remote requester context is unavailable
- **WHEN** a sensitive operation has no safe remote requester or configured approval destination
- **THEN** PiRelay does not send approval prompts to arbitrary paired messengers
- **AND** denies, blocks, or falls back to local host semantics according to safe policy behavior

#### Scenario: Binding changes before decision
- **WHEN** the original approval binding is revoked, paused, disconnected, or no longer matches the persisted active conversation/user/session before a decision arrives
- **THEN** PiRelay rejects the decision and does not approve the operation

### Requirement: Approval audit trail
PiRelay SHALL record bounded non-secret audit events for approval requests and decisions.

#### Scenario: Approval state changes
- **WHEN** an approval is requested, approved once, approved for session, granted persistently, denied, expired, cancelled, uses an active grant, revokes a grant, or fails to send/resolve
- **THEN** PiRelay records an audit event containing safe session identity, operation category, tool name, decision state, grant scope when applicable, timestamp, expiry when applicable, matcher fingerprint label/hash, and authorized user/channel identity
- **AND** the audit event excludes secrets, hidden prompts, full transcripts, file bytes, and raw unredacted tool input

#### Scenario: Authorized user requests approval audit
- **WHEN** an authorized user requests recent approval history through a supported local or remote command
- **THEN** PiRelay returns a bounded list of non-secret approval events for the selected session

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

