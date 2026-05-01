## ADDED Requirements

### Requirement: Human-friendly session labels
The system SHALL support human-friendly session labels for Telegram pairing and session selection.

#### Scenario: User connects with explicit label
- **WHEN** the local user invokes `/telegram-tunnel connect <name>` with a non-empty name
- **THEN** the system uses the provided bounded display name as the session label for the pending pairing, restored binding, Telegram session list, and notifications

#### Scenario: User connects without explicit label
- **WHEN** the local user invokes `/telegram-tunnel connect` without a name
- **THEN** the system derives the session label from the Pi session name if available, otherwise the project folder name when available, otherwise the session file basename, otherwise a short session id fallback

#### Scenario: Explicit label is too long or contains awkward whitespace
- **WHEN** the local user provides an explicit connect label with excessive length or whitespace
- **THEN** the system normalizes it to a bounded safe display label before using it in Telegram messages or persisted binding metadata

#### Scenario: Existing binding has saved label
- **WHEN** a previously paired session resumes with saved binding metadata
- **THEN** the system preserves the saved session label unless the user reconnects or explicitly changes the label through supported commands

### Requirement: Compact multi-session listing
The system SHALL present a compact list of paired sessions for an authorized Telegram chat without requiring a complex dashboard.

#### Scenario: User lists sessions
- **WHEN** an authorized Telegram user invokes `/sessions`
- **THEN** the system lists paired sessions with number, label, active marker, online/offline state, idle/busy state when online, and enough disambiguation for duplicate labels

#### Scenario: Duplicate labels exist
- **WHEN** multiple paired sessions have the same display label
- **THEN** the system keeps numeric selection unambiguous and includes short session identifiers or other safe disambiguators in the list

#### Scenario: No sessions exist
- **WHEN** an authorized Telegram user invokes `/sessions` and no active or persisted bindings exist for that chat/user
- **THEN** the system replies that no paired sessions were found and explains how to connect a session

### Requirement: Explicit active session selection
The system SHALL route ordinary Telegram messages through one active session pointer per authorized chat/user and avoid guessing when routing is ambiguous.

#### Scenario: User switches active session by number
- **WHEN** an authorized Telegram user invokes `/use <number>` with a number from the current session list
- **THEN** the system selects that live session as the active session for subsequent ordinary messages from that chat/user

#### Scenario: User switches active session by label
- **WHEN** an authorized Telegram user invokes `/use <label>` and exactly one live session matches that label or session id prefix
- **THEN** the system selects that live session as the active session

#### Scenario: User selector is ambiguous
- **WHEN** an authorized Telegram user invokes `/use <label>` and multiple live sessions match the selector
- **THEN** the system does not switch sessions and asks the user to choose by number from `/sessions`

#### Scenario: Multiple sessions exist without active selection
- **WHEN** an authorized Telegram user sends an ordinary prompt while multiple live sessions are paired and no active session can be resolved
- **THEN** the system does not guess and instructs the user to run `/sessions` and `/use <session>`

### Requirement: One-shot session targeting
The system SHALL support an explicit one-shot Telegram prompt target without changing the active session.

#### Scenario: User sends one-shot prompt by label
- **WHEN** an authorized Telegram user invokes `/to <session> <prompt>` and the session selector resolves to exactly one live paired session
- **THEN** the system sends the prompt to that session using existing idle and busy delivery rules without changing the active session pointer

#### Scenario: One-shot selector is missing or ambiguous
- **WHEN** an authorized Telegram user invokes `/to` without a selector, without prompt text, or with a selector matching multiple sessions
- **THEN** the system does not inject a prompt and replies with usage or disambiguation guidance

#### Scenario: One-shot target is offline
- **WHEN** an authorized Telegram user invokes `/to <session> <prompt>` for a paired session that is offline
- **THEN** the system reports that the session is offline and does not silently drop the prompt

### Requirement: Multi-session notification source labels
The system SHALL identify the source session in Telegram notifications when a chat has multiple paired sessions.

#### Scenario: Multiple sessions are paired to chat
- **WHEN** a completion, failure, abort, image-availability, or progress notification is sent to a chat that has multiple paired sessions
- **THEN** the notification includes the originating session label

#### Scenario: Only one session is paired to chat
- **WHEN** a notification is sent to a chat with only one paired session
- **THEN** the system may keep the existing concise notification format without redundant session labeling

### Requirement: Broker scope clarity
The system SHALL document and enforce the simple local broker model for Telegram multiplexing.

#### Scenario: Multiple sessions run on same machine
- **WHEN** multiple Pi sessions using the same Telegram bot token run on the same machine
- **THEN** they share the local authoritative broker for that bot token and appear in the same chat's session list when paired

#### Scenario: Multiple machines use same bot token
- **WHEN** the user wants laptop and cloud Pi sessions to share one Telegram chat through the same bot token
- **THEN** the documentation explains that this requires a future relay hub and that multiple independent brokers must not poll the same bot token concurrently
