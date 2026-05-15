# relay-runtime-status-line Specification

## Purpose
Relay runtime status line defines concise messenger status semantics that distinguish adapter readiness from the current Pi session's pairing, binding, paused, and conversation-kind state without exposing raw messenger identifiers.

## Requirements
### Requirement: Messenger status line distinguishes readiness from pairing
PiRelay SHALL render messenger status-line labels that distinguish adapter runtime readiness from the current Pi session's pairing or binding state.

#### Scenario: Runtime ready but current session is unpaired
- **WHEN** a messenger adapter runtime is configured and running
- **AND** the current Pi session has no active binding for that messenger
- **THEN** the status line shows the messenger as ready but unpaired, using concise text such as `slack: ready` or `slack: ready unpaired`
- **AND** the status line does not imply the current session is paired or connected

#### Scenario: Current session has an active binding
- **WHEN** the current Pi session has an active non-revoked binding for a messenger
- **THEN** the status line shows that messenger as paired
- **AND** the label uses consistent wording across Telegram, Discord, and Slack

#### Scenario: Current session binding is paused
- **WHEN** the current Pi session has an active binding whose remote delivery is paused
- **THEN** the status line shows the messenger as paused rather than only ready or paired

### Requirement: Status line includes safe conversation-kind detail when available
PiRelay SHALL include concise, non-sensitive conversation-kind detail for current-session messenger bindings when that detail is already known.

#### Scenario: Slack or Discord binding is a channel
- **WHEN** the current Pi session is paired to a Slack or Discord channel conversation
- **THEN** the status line can show `paired channel` or equivalent concise wording
- **AND** it does not include raw channel ids, workspace ids, or user ids

#### Scenario: Private chat binding is active
- **WHEN** the current Pi session is paired to a private chat or DM
- **THEN** the status line can show `paired dm`, `paired private`, or equivalent concise wording
- **AND** it does not include raw chat ids or user ids

#### Scenario: Conversation kind is unknown
- **WHEN** an active binding exists but its conversation kind is unknown or absent
- **THEN** the status line falls back to `paired` without failing or showing misleading detail

### Requirement: Status line refreshes after relay state changes
PiRelay SHALL refresh messenger status-line labels after local relay lifecycle events that can change readiness or pairing state.

#### Scenario: Pairing completes while dialog is open
- **WHEN** Telegram, Discord, or Slack pairing completes for the current Pi session
- **THEN** PiRelay closes the pairing dialog if one is open
- **AND** the status line updates from ready/unpaired to paired or paused as appropriate

#### Scenario: Binding is disconnected or revoked
- **WHEN** a messenger binding for the current Pi session is disconnected or revoked
- **THEN** the status line updates from paired or paused back to ready/unpaired when the adapter runtime is still healthy

#### Scenario: Runtime startup fails
- **WHEN** a messenger adapter runtime fails to start
- **THEN** the status line shows an error state for that messenger
- **AND** it does not show paired/connected wording even if stale persisted binding records exist

### Requirement: Status-line updates require live context
PiRelay SHALL update relay status-line entries only through a live extension context and SHALL contain stale-context failures from status rendering paths.

#### Scenario: Deferred route publish reports sync error after context replacement
- **WHEN** a deferred route publish or sync callback wants to set a status-line error after the previous context became stale
- **THEN** PiRelay does not call `ctx.ui.setStatus` on the stale context
- **AND** it does not crash the extension, worker subprocess, or messenger runtime because the local status label could not be updated

#### Scenario: Status refresh after route state change has no live context
- **WHEN** a route state change requests status refresh but no live context is available
- **THEN** PiRelay skips the local status refresh
- **AND** it preserves the underlying messenger route and binding state

#### Scenario: Status refresh uses latest live context
- **WHEN** a newer live session context is available after session replacement
- **THEN** PiRelay uses that latest live context for status-line updates instead of any older context captured by the callback

#### Scenario: Latest live context is for a different session
- **WHEN** a deferred status refresh for one route sees a latest live context whose session identity belongs to another route
- **THEN** PiRelay does not update that other session's relay status-line entries with stale-route information
- **AND** it skips or safely scopes the refresh to the matching live route only

#### Scenario: Runtime error reporting avoids stale route context
- **WHEN** a messenger runtime or broker callback catches an error and wants to report local status through a route context
- **THEN** PiRelay reports the error only through a live context/status helper
- **AND** it does not call `route.actions.context.ui.setStatus` from delayed adapter or broker code

### Requirement: Status snapshots preserve route unavailable state
Relay runtime status snapshots and status-line refreshes SHALL use coherent route-action safety probes so a route discovered as unavailable is not displayed as online, idle, busy, paired, or model-ready based on stale partial data.

#### Scenario: Stale idle probe renders offline
- **WHEN** a status-line refresh probes the current route and idle detection reports a stale or unavailable route
- **THEN** the status snapshot treats the session route as unavailable or offline rather than idle or busy

#### Scenario: Stale model probe renders offline
- **WHEN** a status or session snapshot requests model information and model access reports a stale route
- **THEN** the snapshot treats the session route as unavailable or offline instead of preserving an online state with missing model information

#### Scenario: Best-effort status failure remains nonfatal
- **WHEN** local status-line rendering cannot update because the Pi extension UI context is stale or unavailable
- **THEN** PiRelay skips or safely degrades that status update without crashing the session or marking messenger transport health unhealthy
