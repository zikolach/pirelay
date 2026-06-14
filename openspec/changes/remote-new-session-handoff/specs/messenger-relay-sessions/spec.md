## ADDED Requirements

### Requirement: Session renewal handoff preserves authorized relay control
The system SHALL safely move eligible messenger bindings and active selections from an old live session route to a replacement session route when a local or remote new-session operation clearly represents the same workspace continuation.

#### Scenario: Local new session migrates eligible binding
- **WHEN** a paired local Pi session shuts down because the user starts a new session and a replacement route starts in the same workspace within the handoff window
- **THEN** PiRelay migrates the eligible active messenger binding to the replacement session key
- **AND** updates the active selection for that messenger conversation/user to the replacement session
- **AND** does not require a fresh pairing code

#### Scenario: Handoff requires strict matching
- **WHEN** a replacement route starts after an old paired route shuts down
- **THEN** PiRelay migrates bindings only when the old and replacement routes match the same local machine/runtime, workspace root, and unambiguous pending handoff record
- **AND** the old binding is active, not revoked, not explicitly disconnected, and not conflicting with an existing replacement binding

#### Scenario: Ambiguous handoff fails closed
- **WHEN** more than one pending handoff could match a replacement route or the replacement route cannot be proven to be the same workspace continuation
- **THEN** PiRelay does not migrate any binding automatically
- **AND** it reports safe reconnect or `/sessions` guidance without exposing raw session keys, file paths, chat ids, or hidden data

#### Scenario: Old route becomes stale after handoff
- **WHEN** a binding is migrated from an old session route to a replacement session route
- **THEN** protected output, callbacks, guided actions, full-output actions, latest-image actions, abort, compact, and prompt delivery for the old route are rejected as stale or moved
- **AND** the replacement route receives future authorized prompts and controls according to active selection rules

### Requirement: Handoff-aware lifecycle notifications
The system SHALL avoid misleading offline lifecycle notifications during a short new-session handoff window and SHALL send clear moved or offline notifications after the handoff outcome is known.

#### Scenario: Offline notification is delayed during handoff window
- **WHEN** a paired session shuts down with active bindings and a handoff candidate is possible
- **THEN** PiRelay delays the offline lifecycle notification for a bounded short interval
- **AND** still unregisters the old live route immediately so new prompts are not injected into the stale session

#### Scenario: Successful handoff sends moved notification
- **WHEN** a replacement route starts and the handoff succeeds
- **THEN** eligible messenger conversations receive a safe notification that relay control moved to the new Pi session
- **AND** they do not receive the misleading old-session offline notification for that handoff

#### Scenario: Handoff expiry sends offline notification
- **WHEN** no safe replacement route appears before the handoff window expires
- **THEN** PiRelay sends the normal offline notification for the old paired session
- **AND** leaves the persisted binding in its safe offline/restorable state unless it was explicitly disconnected

### Requirement: Remote new-session command renews selected live route
The system SHALL allow authorized messenger users to request a new Pi session for an online selected route when the runtime can safely execute command-capable session controls.

#### Scenario: Authorized remote new starts replacement session
- **WHEN** an authorized messenger user sends `/new` or an equivalent command for exactly one selected online idle session
- **THEN** PiRelay requests a new Pi session through the route-action boundary
- **AND** on success migrates the requester conversation's eligible binding and active selection to the replacement route
- **AND** replies that the new session started and relay control moved

#### Scenario: Remote new refuses offline or ambiguous route
- **WHEN** an authorized messenger user sends `/new` but no online selected route exists or multiple routes are ambiguous
- **THEN** PiRelay does not request a new Pi session
- **AND** returns safe `/sessions` or `/use` guidance consistent with other remote controls

#### Scenario: Remote new refuses busy route by default
- **WHEN** an authorized messenger user sends `/new` while the selected route is running a turn, awaiting approval, or capturing a custom answer
- **THEN** PiRelay refuses or requires an explicit confirmation policy before replacing the session
- **AND** it does not silently abandon the active turn, approval, or answer state

#### Scenario: Remote new unsupported reports capability limitation
- **WHEN** an authorized messenger user sends `/new` for a route whose runtime has no current command-capable session-control context
- **THEN** PiRelay returns an explicit unsupported-capability message
- **AND** it does not mark the route offline, mutate bindings, or pretend a new session was created
