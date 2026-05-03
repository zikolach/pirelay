## ADDED Requirements

### Requirement: Live Discord bot lifecycle
The system SHALL start and stop a live Discord bot runtime when Discord relay is explicitly enabled and configured.

#### Scenario: Discord runtime starts when configured
- **WHEN** PiRelay starts with Discord enabled and a Discord bot token configured
- **THEN** the system connects the Discord bot runtime and begins receiving direct-message events

#### Scenario: Discord runtime is disabled
- **WHEN** PiRelay starts without Discord enabled or without a Discord bot token
- **THEN** the system does not start a Discord bot runtime and Telegram behavior remains unchanged

#### Scenario: Discord startup fails
- **WHEN** the Discord bot runtime cannot connect or authenticate
- **THEN** the system reports a safe local status or doctor diagnostic without printing the bot token
- **AND** the Telegram runtime remains available when it is otherwise configured

### Requirement: Discord direct-message pairing
The system SHALL allow a configured Discord bot DM to pair with a Pi session using a channel-scoped, expiring pairing command.

#### Scenario: Discord pairing command is accepted
- **WHEN** an authorized Discord user sends `/start <code>` in a direct message before the pairing expires
- **THEN** the system consumes the Discord-scoped pending pairing and binds that Discord conversation to the target Pi session

#### Scenario: Pairing command is not from a DM
- **WHEN** a Discord `/start <code>` pairing command is received from a guild channel while guild-channel pairing is not explicitly enabled and allowed
- **THEN** the system rejects the pairing and does not create a binding

#### Scenario: Pairing command is expired or wrong channel
- **WHEN** Discord receives an expired, unknown, already consumed, or non-Discord pairing code
- **THEN** the system rejects the pairing and sends a safe retry instruction

#### Scenario: Pairing user is not authorized
- **WHEN** a Discord user not allowed by configured authorization sends a valid pairing command
- **THEN** the system rejects the pairing before binding the session or injecting any prompt

### Requirement: Discord inbound prompt and command routing
The system SHALL route authorized Discord DM messages into the bound Pi session using the same relay safety rules as other channels.

#### Scenario: Authorized Discord DM sends text
- **WHEN** an authorized paired Discord user sends non-command text in a DM while the Pi session is idle
- **THEN** the system injects the text as a Pi user prompt for the bound session

#### Scenario: Busy session receives Discord text
- **WHEN** an authorized paired Discord user sends non-command text while the Pi session is busy
- **THEN** the system applies the configured busy delivery mode and reports the queued or steering status in Discord

#### Scenario: Unauthorized Discord message is received
- **WHEN** an unpaired or unauthorized Discord user sends a DM, guild message, file, or action
- **THEN** the system rejects the event before prompt injection, media download, callbacks, or control actions

#### Scenario: Discord bot or webhook message is received
- **WHEN** Discord delivers a message authored by a bot, webhook, or the PiRelay bot itself
- **THEN** the system ignores it and does not route it to Pi

### Requirement: Discord remote controls
The system SHALL expose safe Discord DM controls for paired sessions using the relay command behavior supported by the Discord adapter.

#### Scenario: Status command is requested
- **WHEN** an authorized paired Discord user sends `/status` in a DM
- **THEN** the system replies with the bound session identity, online state, idle or busy state, and recent status information

#### Scenario: Abort command is requested
- **WHEN** an authorized paired Discord user sends `/abort` in a DM for a busy online session
- **THEN** the system requests cancellation of the active Pi operation and reports the result in Discord

#### Scenario: Disconnect command is requested
- **WHEN** an authorized paired Discord user sends `/disconnect` in a DM
- **THEN** the system revokes the Discord binding and rejects future Discord events until a new pairing is completed

### Requirement: Discord outbound delivery
The system SHALL deliver PiRelay responses to Discord using Discord platform limits and safe fallbacks.

#### Scenario: Text response exceeds Discord limit
- **WHEN** the system sends a Discord text response longer than the configured Discord text limit
- **THEN** it chunks or otherwise safely splits the response without losing required status or error information

#### Scenario: Pi task activity is visible
- **WHEN** an authorized Discord prompt is accepted for delivery to Pi
- **THEN** the system attempts to show Discord typing activity for the bound conversation while Pi is working

#### Scenario: File or image is sent to Discord
- **WHEN** PiRelay sends a document or image to Discord
- **THEN** the system validates file size and MIME type before upload and refuses unsupported files with an actionable message

#### Scenario: Button action is answered
- **WHEN** an authorized Discord interaction button is invoked for a current relay action
- **THEN** the system handles the action once and acknowledges the interaction without exposing internal callback data

### Requirement: Discord runtime diagnostics
The system SHALL provide secret-safe diagnostics for live Discord runtime readiness.

#### Scenario: Doctor checks Discord runtime readiness
- **WHEN** the local user invokes `/relay doctor` with Discord configured
- **THEN** the system reports whether Discord is enabled, whether required credentials are present, whether DM-first safety is in effect, and whether guild-channel settings are safe

#### Scenario: Doctor output would contain Discord secrets
- **WHEN** Discord diagnostics include bot tokens, OAuth tokens, active pairing codes, or platform error details that include secrets
- **THEN** the system redacts or omits those values from displayed, logged, persisted, and exported output

#### Scenario: Discord setup guidance is requested
- **WHEN** the local user invokes `/relay setup discord`
- **THEN** the system includes Developer Portal setup guidance, token/client-id instructions, required invite scope guidance, and DM-first pairing instructions
