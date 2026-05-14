## ADDED Requirements

### Requirement: Protected messenger side effects require current binding authority
The system SHALL verify current binding authority immediately before protected messenger side effects that expose session output or mutate Pi session state.

#### Scenario: Terminal output checks authority before sending
- **WHEN** a Pi turn completes, fails, or aborts and PiRelay is about to send terminal output, summaries, full-output buttons, latest-image buttons, or document fallbacks through Telegram, Discord, Slack, or a future messenger
- **THEN** PiRelay resolves the target binding through binding authority for the expected messenger destination
- **AND** sends only when the result permits delivery for that destination and binding state

#### Scenario: Callback and action checks authority before serving content
- **WHEN** a user invokes a dashboard, full-output, Markdown download, latest-image, guided-answer, abort, compact, pause, resume, or similar action that was rendered before a disconnect, pause, or re-pair
- **THEN** PiRelay re-checks binding authority before returning protected content or mutating Pi state
- **AND** rejects the action safely when the binding is revoked, moved, unauthorized, unavailable, or stale

#### Scenario: Remote file delivery checks authority before filesystem reads and uploads
- **WHEN** a remote requester or assistant-triggered requester flow attempts to deliver a workspace file through a messenger
- **THEN** PiRelay resolves the original requester binding through binding authority before reading the file or calling the messenger upload API
- **AND** refuses delivery if the requester binding is revoked, paused, moved, missing, or state-unavailable

#### Scenario: State unavailable fails closed for protected delivery
- **WHEN** authoritative state is unreadable or cannot be parsed while protected messenger delivery is being evaluated
- **THEN** PiRelay does not send output, buttons, documents, images, activity, or lifecycle notifications using route bindings or recent caches
- **AND** it records or reports only secret-safe diagnostics appropriate to the runtime context

### Requirement: Deferred messenger work preserves original destination identity
The system SHALL ensure deferred messenger activity, typing, progress, and lifecycle-related work remains scoped to the destination for which it was scheduled.

#### Scenario: Progress timer fires after binding is cleared
- **WHEN** a progress update timer was scheduled for a messenger destination and the route binding has been cleared before the timer fires
- **THEN** PiRelay uses the captured destination key to clear the pending progress state
- **AND** does not leak progress state or send the update to another destination

#### Scenario: Typing or activity refresh stops after destination changes
- **WHEN** typing or activity refresh was scheduled for one conversation and the session is later re-paired or selected in another conversation
- **THEN** the refresh checks authority for the original destination
- **AND** stops the original indicator instead of refreshing activity in the new conversation

#### Scenario: Paused binding suppresses non-terminal delivery without revoking
- **WHEN** a binding is paused while non-terminal progress, typing, or activity refresh work is pending
- **THEN** PiRelay clears or stops the pending non-terminal delivery for that destination
- **AND** preserves the persisted paused binding for future resume, status, and safe command handling

### Requirement: Recent binding caches cannot override persisted authority
The system SHALL use recent binding caches only as bounded hints and never as authority over persisted binding state.

#### Scenario: Revoked persisted binding suppresses cached completion
- **WHEN** a recent cache still contains a messenger destination but persisted state marks the session binding revoked
- **THEN** PiRelay does not deliver completion, progress, lifecycle, file, image, or full-output content to the cached destination

#### Scenario: Moved persisted binding suppresses stale cached destination
- **WHEN** a recent cache points at an old conversation but persisted state contains an active binding for the same session and messenger instance in a different conversation
- **THEN** PiRelay treats the cached destination as stale
- **AND** does not send the deferred or protected response to either destination unless the current operation explicitly targets and authorizes one of them

#### Scenario: Cache fallback requires successful state load
- **WHEN** PiRelay cannot confirm persisted state because state loading failed
- **THEN** recent caches and route-local bindings are not used to authorize protected delivery
