## ADDED Requirements

### Requirement: Live Discord adapter operations
The system SHALL provide concrete Discord adapter operations that connect the channel-neutral Discord adapter to a live Discord bot client.

#### Scenario: Gateway message is normalized
- **WHEN** the live Discord client receives a direct-message event from Discord
- **THEN** it passes the event through the Discord adapter normalization before relay authorization or prompt delivery

#### Scenario: Discord outbound payload is sent
- **WHEN** the relay core emits a normalized outbound payload for a Discord binding
- **THEN** the Discord adapter sends the equivalent Discord message, file, image, typing activity, or interaction acknowledgement through the live client operations

#### Scenario: Discord platform client is mocked in tests
- **WHEN** tests exercise Discord runtime behavior
- **THEN** they can inject mocked Discord operations without opening a network connection to Discord

### Requirement: Discord adapter safety boundaries
The system SHALL preserve adapter-level Discord safety checks when used by the live runtime.

#### Scenario: Live runtime receives guild message by default
- **WHEN** the live Discord client receives a guild-channel message and guild-channel control is not explicitly enabled and allowed
- **THEN** the adapter/runtime rejects the event before route lookup, media download, or prompt injection

#### Scenario: Live runtime receives unsupported attachment
- **WHEN** the live Discord client receives an attachment that exceeds configured size or MIME limits
- **THEN** the adapter marks or rejects the attachment according to the declared capabilities before any Pi prompt injection

#### Scenario: Live runtime sends oversized file
- **WHEN** the relay core asks the Discord adapter to send a file that exceeds configured limits
- **THEN** the adapter refuses the upload and returns a safe error instead of sending the file
