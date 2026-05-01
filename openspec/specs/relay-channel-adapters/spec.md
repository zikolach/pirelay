# relay-channel-adapters Specification

## Purpose
TBD - created by archiving change add-channel-adapter-architecture. Update Purpose after archive.
## Requirements
### Requirement: Channel-neutral relay core
The system SHALL separate channel-independent PiRelay behavior from messaging-channel-specific transport implementations.

#### Scenario: Telegram message is processed through adapter
- **WHEN** the Telegram adapter receives an authorized inbound message
- **THEN** the relay core handles route authorization, session state, busy delivery, and Pi prompt injection using channel-neutral message data

#### Scenario: Core sends outbound response
- **WHEN** the relay core needs to send a completion, failure, prompt acknowledgement, image, document, or action prompt
- **THEN** it requests delivery through the active channel adapter using normalized outbound data

### Requirement: Channel adapter capability declaration
The system SHALL require each channel adapter to declare supported transport capabilities and platform limits.

#### Scenario: Adapter lacks inline buttons
- **WHEN** the relay core wants to present actions but the selected channel adapter does not support inline buttons
- **THEN** the system falls back to text commands or another declared supported interaction mode

#### Scenario: Adapter has smaller message limit
- **WHEN** an outbound message exceeds the active channel adapter's declared message size limit
- **THEN** the system chunks, truncates, or offers document download according to shared relay behavior and adapter capabilities

### Requirement: Telegram compatibility adapter
The system SHALL preserve existing Telegram tunnel behavior while routing it through the channel adapter architecture.

#### Scenario: Existing Telegram command is used
- **WHEN** a user invokes an existing `/telegram-tunnel` local command or Telegram slash command
- **THEN** the system preserves the command's current behavior through the Telegram adapter and relay core

#### Scenario: Existing Telegram binding is restored
- **WHEN** a Pi session with existing Telegram binding metadata resumes after the adapter refactor
- **THEN** the system restores the binding without requiring the user to pair again

### Requirement: Generic relay command aliases
The system SHALL expose generic `/relay` local command aliases for future multi-channel workflows while keeping Telegram-specific commands available.

#### Scenario: User invokes relay status alias
- **WHEN** the local user invokes a generic relay status command for a Telegram-paired session
- **THEN** the system returns equivalent status information to the existing Telegram tunnel status command

#### Scenario: User invokes legacy Telegram command
- **WHEN** the local user invokes an existing `/telegram-tunnel` command
- **THEN** the system continues to support it as a compatibility command

