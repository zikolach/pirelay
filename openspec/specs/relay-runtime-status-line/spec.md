# relay-runtime-status-line Specification

## Purpose
TBD - created by archiving change improve-relay-status-line. Update Purpose after archive.
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

