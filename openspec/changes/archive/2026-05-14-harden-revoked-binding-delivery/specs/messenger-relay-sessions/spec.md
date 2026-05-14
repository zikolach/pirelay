## ADDED Requirements

### Requirement: Remote disconnect is requester-conversation scoped
The system SHALL interpret remote `/disconnect` or equivalent messenger disconnect commands as revoking only the requesting conversation binding for the selected session, while preserving unrelated messenger bindings for that session.

#### Scenario: Telegram chat disconnects from a multi-messenger session
- **WHEN** an authorized Telegram private chat invokes `/disconnect` for a Pi session that also has active Slack or Discord bindings
- **THEN** PiRelay revokes the Telegram chat binding for that session
- **AND** it does not revoke the Slack or Discord bindings for the same session

#### Scenario: Slack or Discord disconnect does not revoke Telegram
- **WHEN** an authorized Slack or Discord conversation invokes its disconnect command for a Pi session that also has an active Telegram binding
- **THEN** PiRelay revokes only the requesting Slack or Discord conversation binding
- **AND** it does not revoke the Telegram binding or other messenger bindings for the same session

#### Scenario: Local disconnect remains session-wide
- **WHEN** the local Pi user invokes `/relay disconnect` for the current session
- **THEN** PiRelay revokes all active Telegram, Discord, Slack, and future messenger bindings for that session according to local command semantics
- **AND** this local behavior is distinct from requester-conversation scoped remote disconnect

### Requirement: Revoked bindings receive no session feedback
The system SHALL prevent any revoked messenger binding from receiving session-scoped output, actions, or protected retrieval responses until a fresh pairing recreates an active binding.

#### Scenario: Completion after remote disconnect is not delivered to revoked chat
- **WHEN** a Telegram chat disconnects from a Pi session and the same session later completes work that was initiated or kept alive through Slack, Discord, local Pi, or another binding
- **THEN** PiRelay does not send Telegram completion, failure, abort, progress, full-output buttons, latest-image buttons, or document fallback messages to the disconnected Telegram chat
- **AND** active non-revoked bindings for the same session may still receive their own eligible notifications

#### Scenario: Broker-level sessions command remains available
- **WHEN** a disconnected Telegram chat invokes `/sessions` after its binding was revoked
- **THEN** PiRelay may respond with broker-level state such as no paired sessions for that chat and re-pair guidance
- **AND** the response does not include protected assistant output, session-control buttons, or stale paired-session actions for the revoked binding

#### Scenario: Stale action after disconnect is refused
- **WHEN** a user invokes a pre-disconnect button, callback, guided-answer action, full-output download, latest-image download, or equivalent stale action for a revoked binding
- **THEN** PiRelay refuses the action with a safe stale-or-disconnected response
- **AND** it does not reveal assistant output, download files/images, mutate session state, or re-pair the chat

#### Scenario: New pairing restores delivery
- **WHEN** the same messenger conversation completes a fresh valid pairing after disconnect
- **THEN** PiRelay creates a new active binding
- **AND** future session feedback may be delivered according to normal authorization, selection, and progress-mode rules
