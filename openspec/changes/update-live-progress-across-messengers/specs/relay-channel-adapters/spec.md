## ADDED Requirements

### Requirement: Channel adapters expose optional live progress update capability
The system SHALL model live progress message creation and update as optional channel adapter capabilities with safe fallback to ordinary text messages when a platform lacks update support or an update operation fails.

#### Scenario: Adapter returns live progress reference
- **WHEN** a channel adapter supports live progress and sends a live progress message
- **THEN** it returns a non-secret message reference sufficient to update that bot-owned message later
- **AND** the reference is scoped to the destination and is not persisted as a long-term binding secret

#### Scenario: Adapter updates live progress reference
- **WHEN** a channel adapter receives a valid live progress reference for a bot-owned message in the expected destination
- **THEN** it updates that message with the new safe progress text using platform-specific APIs
- **AND** it falls back to ordinary text delivery or reports a recoverable failure when the update cannot be performed

#### Scenario: Adapter fallback invariant is consistent
- **WHEN** live progress delivery is attempted through Telegram, Slack, Discord, or a future adapter
- **THEN** the delivery path tries update-in-place first when a reference exists, then sends a new live/editable progress message when supported, then sends a plain text snapshot
- **AND** if every attempt fails, the failure is contained as best-effort progress and does not fail the Pi turn or mark the messenger runtime unhealthy

#### Scenario: Binding authority is checked before protected progress delivery
- **WHEN** live progress is about to be sent or updated through any adapter
- **THEN** PiRelay verifies the current binding authority, destination identity, paused/revoked/moved state, and route liveness for that destination
- **AND** refuses to send or update protected progress when authority is unavailable or denied
