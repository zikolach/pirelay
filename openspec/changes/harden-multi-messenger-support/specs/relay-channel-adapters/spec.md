## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Telegram compatibility adapter
**Reason**: Telegram is no longer the compatibility baseline; it is one first-class messenger adapter among peers.
**Migration**: Use the messenger-neutral relay adapter contract and canonical `/relay` commands. Existing Telegram bindings migrate to `telegram:default` messenger bindings.

### Requirement: Generic relay command aliases
**Reason**: `/relay` is now the canonical command namespace, not an alias for Telegram-specific commands.
**Migration**: Replace `/telegram-tunnel ...` usage with `/relay ...` commands and messenger references such as `telegram:default` or `discord:default`.
