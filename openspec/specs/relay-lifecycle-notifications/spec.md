# relay-lifecycle-notifications Specification

## Purpose
Relay lifecycle notifications define best-effort remote notifications for Pi session offline, restored-online, and local-disconnect lifecycle events across active Telegram, Discord, and Slack bindings while preserving existing authorization and pairing semantics.

## Requirements
### Requirement: Lifecycle events are classified for remote notification
PiRelay SHALL classify local session lifecycle events into remote-safe lifecycle notification kinds without changing pairing authorization semantics.

#### Scenario: Normal shutdown is temporary offline
- **WHEN** a paired Pi session reaches a normal local shutdown path
- **THEN** PiRelay classifies the event as a temporary offline lifecycle event
- **AND** the existing messenger binding remains valid unless another action revokes it

#### Scenario: Startup after prior offline is restored online
- **WHEN** a Pi session starts and restores an active persisted messenger binding that was previously marked offline
- **THEN** PiRelay classifies the event as a restored online lifecycle event

#### Scenario: Local disconnect is intentional unpairing
- **WHEN** the local Pi user disconnects relay for the current session
- **THEN** PiRelay classifies the event as an intentional local disconnect lifecycle event
- **AND** future messenger events for that binding require a new pairing after revocation

### Requirement: Lifecycle notifications are delivered to active paired conversations
PiRelay SHALL deliver lifecycle notifications to active persisted Telegram, Discord, and Slack bindings for the affected session, using the correct messenger kind and instance scope.

#### Scenario: Offline notification is delivered before route unregister
- **WHEN** a paired session is shutting down normally and the messenger runtime can still send messages
- **THEN** PiRelay sends a remote notification that the session went offline locally before unregistering the route where possible

#### Scenario: Startup notification is delivered after route restore
- **WHEN** a session starts and successfully restores/registers a previously offline binding
- **THEN** PiRelay sends a remote notification that the session is back online

#### Scenario: Disconnect notification is delivered before revocation
- **WHEN** the local Pi user intentionally disconnects a paired session
- **THEN** PiRelay sends a remote notification that the session was disconnected locally before revoking the binding where possible

#### Scenario: Multi-instance binding uses matching instance
- **WHEN** Discord or Slack has multiple configured instances and a lifecycle event affects one instance binding
- **THEN** PiRelay delivers the lifecycle notification only through the matching messenger instance
- **AND** it does not notify unrelated instances or conversations

### Requirement: Lifecycle notification wording is safe and distinct
PiRelay SHALL format lifecycle notifications so remote users can distinguish temporary offline state, restored online state, and intentional local disconnect without exposing secrets or internal identifiers.

#### Scenario: Offline wording preserves binding expectation
- **WHEN** PiRelay sends a temporary offline notification
- **THEN** the message states that the named Pi session went offline locally or exited
- **AND** it does not imply the messenger chat was unpaired

#### Scenario: Restored wording announces availability
- **WHEN** PiRelay sends a restored online notification
- **THEN** the message states that the named Pi session is back online or available again

#### Scenario: Disconnect wording explains re-pair requirement
- **WHEN** PiRelay sends an intentional local disconnect notification
- **THEN** the message states that PiRelay was disconnected locally for the named session
- **AND** it explains that the chat is no longer paired or must pair again before controlling Pi

#### Scenario: Safe content only
- **WHEN** any lifecycle notification is formatted
- **THEN** the message omits bot tokens, pairing codes, hidden prompts, tool internals, full transcripts, raw chat ids, raw channel ids, and workspace ids

#### Scenario: Slack command guidance avoids leading slash forms
- **WHEN** a Slack lifecycle notification includes command guidance
- **THEN** it uses `pirelay <command>` wording rather than leading slash command forms

### Requirement: Lifecycle notifications are deduplicated and rate-limited
PiRelay SHALL persist minimal lifecycle notification metadata and suppress duplicate lifecycle notifications that would spam a paired conversation.

#### Scenario: First observation initializes state without spam
- **WHEN** PiRelay first observes an existing active binding after upgrade and no prior lifecycle state exists
- **THEN** it records lifecycle state without sending a restored-online notification solely because the metadata was absent

#### Scenario: Repeated startup does not spam online messages
- **WHEN** a session start is observed repeatedly while the persisted lifecycle state is already online
- **THEN** PiRelay does not send repeated restored-online notifications for the same binding

#### Scenario: Offline then startup sends one restored message
- **WHEN** PiRelay records an offline lifecycle notification for a binding and later starts the same session successfully
- **THEN** it sends at most one restored-online notification for that offline period
- **AND** it updates lifecycle state to online

#### Scenario: Rate limit suppresses rapid repeats
- **WHEN** the same lifecycle event is emitted repeatedly for the same binding within the configured or built-in debounce window
- **THEN** PiRelay suppresses duplicate remote lifecycle notifications

### Requirement: Lifecycle notification failures are nonfatal
PiRelay SHALL contain failures while sending lifecycle notifications and SHALL NOT let best-effort notification failures block lifecycle transitions or corrupt runtime health.

#### Scenario: Shutdown send failure does not block unregister
- **WHEN** sending a shutdown/offline lifecycle notification fails
- **THEN** PiRelay continues unregistering the route and completing local shutdown handling

#### Scenario: Disconnect send failure does not block revocation
- **WHEN** sending a local-disconnect lifecycle notification fails
- **THEN** PiRelay still revokes the binding and reports local disconnect completion where applicable

#### Scenario: Startup send failure does not mark core runtime unhealthy
- **WHEN** sending a restored-online lifecycle notification fails
- **THEN** PiRelay records only safe diagnostics or debug information
- **AND** the messenger runtime status does not become errored solely because of that best-effort notification failure

