# relay-channel-adapters Specification

## Purpose
TBD - created by archiving change add-channel-adapter-architecture. Update Purpose after archive.
## Requirements
### Requirement: Channel-neutral relay core
The system SHALL separate messenger-independent PiRelay behavior from messaging-platform-specific transport implementations for all supported messenger adapters.

#### Scenario: Messenger message is processed through adapter
- **WHEN** any enabled messenger adapter receives an authorized inbound message
- **THEN** the relay core handles route authorization, session state, busy delivery, and Pi prompt injection using messenger-neutral message data

#### Scenario: Core sends outbound response
- **WHEN** the relay core needs to send a completion, failure, prompt acknowledgement, image, document, activity indicator, or action prompt
- **THEN** it requests delivery through the selected messenger adapter using normalized outbound data and the target messenger instance reference

#### Scenario: Shared behavior is not implemented in platform adapter
- **WHEN** behavior applies to all messengers such as session selection, output retrieval, guided answers, or latest-image retrieval
- **THEN** the behavior lives in shared relay code rather than in Telegram-, Discord-, or Slack-specific modules

### Requirement: Channel adapter capability declaration
The system SHALL require each messenger adapter instance to declare supported transport capabilities and platform limits.

#### Scenario: Adapter lacks inline buttons
- **WHEN** the relay core wants to present actions but the selected messenger adapter does not support inline buttons
- **THEN** the system falls back to text commands or another declared supported interaction mode

#### Scenario: Adapter has smaller message limit
- **WHEN** an outbound message exceeds the active messenger adapter's declared message size limit
- **THEN** the system chunks, truncates, or offers document/file download according to shared relay behavior and adapter capabilities

#### Scenario: Multiple instances share an adapter kind
- **WHEN** multiple configured instances use the same messenger kind with different limits or credentials
- **THEN** each instance exposes its own resolved capability and limit profile to the relay core

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

### Requirement: First-class messenger adapter parity
The system SHALL treat Telegram, Discord, Slack, and future messenger adapters as peers behind the same adapter lifecycle and normalized event contracts.

#### Scenario: Telegram and Discord are both enabled
- **WHEN** Telegram and Discord messenger instances are configured and enabled
- **THEN** both adapters register with the broker using the same adapter lifecycle, pairing, inbound event, outbound delivery, media, and action contracts

#### Scenario: Adapter-specific command rendering differs
- **WHEN** one messenger supports buttons and another supports only text commands
- **THEN** both messengers expose the same relay actions through platform-appropriate renderers without changing shared session semantics

#### Scenario: Adapter command coverage is declared
- **WHEN** a messenger adapter is enabled for live use
- **THEN** it declares support, fallback, or explicit capability-gated limitation for every canonical remote command so parity tests can fail missing implementations such as `/full` or `/sessions`

#### Scenario: Adapter avoids unreliable platform command surfaces
- **WHEN** a platform reserves or intercepts a command syntax, such as Discord's `/...` application-command UI
- **THEN** the adapter provides a reliable documented fallback that reaches PiRelay as a normal inbound event, such as Discord `relay <command>` DM text, and treats intercepted syntax only as a convenience alias

#### Scenario: Adapter activity indicators match platform expiry behavior
- **WHEN** a messenger platform exposes expiring activity indicators such as Discord typing
- **THEN** the adapter or runtime refreshes the activity at a safe cadence while work is ongoing and stops refreshing on terminal state rather than assuming a single activity call lasts for the whole turn

#### Scenario: Adapter preserves plain-text intent
- **WHEN** shared relay presenters produce plain status, help, diagnostic, acknowledgement, or error text for a messenger with markup parsing such as Discord Markdown
- **THEN** the adapter sends or escapes that text so platform rendering does not accidentally bold, code-format, mention users/roles, create headings, or otherwise alter the intended plain-text meaning

#### Scenario: Adapter fails startup
- **WHEN** one configured messenger adapter fails to authenticate or connect
- **THEN** the broker reports a secret-safe diagnostic for that adapter and continues operating other enabled adapters when safe

