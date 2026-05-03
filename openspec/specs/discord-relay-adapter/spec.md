# discord-relay-adapter Specification

## Purpose
Defines Discord adapter behavior for DM pairing, authorization, prompt relay, output retrieval, guided actions, and bounded media transport according to Discord platform limits.
## Requirements
### Requirement: Discord DM pairing and authorization
The system SHALL allow a local Pi user to pair the active Pi session with an authorized Discord direct-message conversation.

#### Scenario: Discord pairing code is generated
- **WHEN** the local user starts Discord relay pairing for a Pi session
- **THEN** the system displays a time-limited pairing instruction or code scoped to that session

#### Scenario: Authorized Discord user completes pairing
- **WHEN** the configured Discord bot receives a valid pairing command from an allowed Discord user before expiry
- **THEN** the system binds that Discord DM identity to the Pi session

#### Scenario: Discord server channel sends command by default
- **WHEN** a Discord guild channel sends a PiRelay command and guild-channel control is not explicitly enabled
- **THEN** the system rejects the command and does not inject anything into Pi

### Requirement: Discord prompt and output relay
The system SHALL support core PiRelay prompt delivery and output retrieval through Discord DMs.

#### Scenario: Discord text prompt is sent
- **WHEN** an authorized Discord DM user sends non-command text while the paired Pi session is online and unpaused
- **THEN** the system injects the text into Pi using the same idle and busy delivery rules as other relay channels

#### Scenario: Discord output is too long
- **WHEN** a Pi completion output exceeds Discord message limits
- **THEN** the system chunks the output or offers a document download according to Discord adapter capabilities

#### Scenario: Discord user taps answer button
- **WHEN** an authorized Discord DM user taps a current answer/action button
- **THEN** the system validates the action and injects or returns the selected response using shared relay behavior

### Requirement: Discord media transport
The system SHALL support bounded Discord file and image transport according to adapter capabilities.

#### Scenario: Discord image attachment is sent
- **WHEN** an authorized Discord DM user sends a supported image attachment and the current Pi model supports images
- **THEN** the system validates and injects it using the shared image prompt behavior

#### Scenario: Discord user requests latest images
- **WHEN** an authorized Discord DM user requests latest images for the current turn
- **THEN** the system sends supported latest images or validated workspace image files using Discord file upload limits

