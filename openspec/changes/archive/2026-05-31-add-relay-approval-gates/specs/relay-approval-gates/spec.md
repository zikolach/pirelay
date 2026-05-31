## ADDED Requirements

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
