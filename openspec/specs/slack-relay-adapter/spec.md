# slack-relay-adapter Specification

## Purpose
TBD - created by archiving change add-discord-slack-adapters. Update Purpose after archive.
## Requirements
### Requirement: Slack DM pairing and authorization
The system SHALL allow a local Pi user to pair the active Pi session with an authorized Slack app direct-message conversation.

#### Scenario: Slack pairing is initiated
- **WHEN** the local user starts Slack relay pairing for a Pi session
- **THEN** the system displays a time-limited pairing instruction scoped to that session and the configured Slack workspace/app

#### Scenario: Authorized Slack user completes pairing
- **WHEN** the configured Slack app receives a valid pairing command from an allowed Slack user before expiry
- **THEN** the system binds that Slack workspace/user/DM identity to the Pi session

#### Scenario: Slack channel sends command by default
- **WHEN** a Slack public or private channel sends a PiRelay command and channel control is not explicitly enabled
- **THEN** the system rejects the command and does not inject anything into Pi

### Requirement: Slack prompt and output relay
The system SHALL support core PiRelay prompt delivery and output retrieval through Slack DMs.

#### Scenario: Slack text prompt is sent
- **WHEN** an authorized Slack DM user sends non-command text while the paired Pi session is online and unpaused
- **THEN** the system injects the text into Pi using the same idle and busy delivery rules as other relay channels

#### Scenario: Slack output is too long
- **WHEN** a Pi completion output exceeds Slack message or block limits
- **THEN** the system chunks the output or offers a file download according to Slack adapter capabilities

#### Scenario: Slack user taps action button
- **WHEN** an authorized Slack DM user taps a current action button
- **THEN** the system validates the action and performs the selected shared relay behavior

### Requirement: Slack app security
The system SHALL validate Slack app requests and keep Slack credentials secret-safe.

#### Scenario: Slack request signature is invalid
- **WHEN** the Slack adapter receives an interaction or event with an invalid signature or timestamp
- **THEN** the system rejects the request and does not affect any Pi session

#### Scenario: Session history is exported
- **WHEN** a session containing Slack relay metadata is exported or shared
- **THEN** the exported history does not include Slack bot tokens, signing secrets, OAuth tokens, or active pairing secrets

