## ADDED Requirements

### Requirement: Generic relay setup commands
The system SHALL expose generic local `/relay` setup commands for supported channels while preserving channel-specific compatibility commands.

#### Scenario: User requests channel setup help
- **WHEN** the local user invokes `/relay setup <channel>` for a supported channel
- **THEN** the system shows channel-specific setup status, missing configuration, and next steps without printing secret values

#### Scenario: User connects a channel
- **WHEN** the local user invokes `/relay connect <channel> [name]` for a configured enabled channel
- **THEN** the system creates a time-limited pairing instruction scoped to that channel and session

#### Scenario: Unsupported channel is requested
- **WHEN** the local user invokes `/relay setup <unknown-channel>` or `/relay connect <unknown-channel>`
- **THEN** the system lists supported channels and does not create pairing state

### Requirement: Relay doctor diagnostics
The system SHALL provide a local `/relay doctor` diagnostic command that validates relay setup across configured channels.

#### Scenario: Doctor checks configured channels
- **WHEN** the local user invokes `/relay doctor`
- **THEN** the system reports enabled/disabled status for Telegram, Discord, and Slack, and reports actionable warnings for missing required credentials, invalid allow-lists, unsafe state-file permissions, and unsupported channel modes

#### Scenario: Doctor output contains secrets
- **WHEN** diagnostics include credentials such as bot tokens, signing secrets, OAuth tokens, or active pairing codes
- **THEN** the system redacts or omits those secret values from all displayed, logged, persisted, and exported output

#### Scenario: Doctor has no configured channels
- **WHEN** no relay channel is configured
- **THEN** the system explains the minimal setup path for Telegram and how to opt into Discord or Slack

### Requirement: Platform-specific setup guidance
The system SHALL generate platform-specific setup guidance that minimizes manual mistakes.

#### Scenario: Telegram guidance is requested
- **WHEN** setup guidance is generated for Telegram
- **THEN** the system references `TELEGRAM_BOT_TOKEN`, existing config-file compatibility, `/telegram-tunnel setup`, and private-chat pairing

#### Scenario: Discord guidance is requested
- **WHEN** setup guidance is generated for Discord
- **THEN** the system references `discord.botToken` or `PI_RELAY_DISCORD_BOT_TOKEN`, DM-first behavior, allow-list recommendations, and a bot invite URL when a client/application id is configured

#### Scenario: Slack guidance is requested
- **WHEN** setup guidance is generated for Slack
- **THEN** the system references `slack.botToken`, `slack.signingSecret`, workspace/user allow-listing, Socket Mode or webhook expectations, and DM-first behavior
