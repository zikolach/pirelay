## ADDED Requirements

### Requirement: Namespaced PiRelay configuration
The system SHALL load canonical configuration from a PiRelay namespace with shared relay defaults and namespaced messenger instances.

#### Scenario: Canonical config file is loaded
- **WHEN** `~/.pi/agent/pirelay/config.json` contains `relay`, `defaults`, and `messengers.<kind>.<instanceId>` sections
- **THEN** the system resolves machine settings, shared limits, and each messenger instance without requiring Telegram-specific top-level keys

#### Scenario: Multiple bot instances of one messenger kind are configured
- **WHEN** the config contains `messengers.telegram.personal` and `messengers.telegram.work`
- **THEN** each instance is addressable independently by `/relay setup telegram:personal`, `/relay connect telegram:work`, diagnostics, broker ownership, and persisted bindings

#### Scenario: Unknown messenger config is present
- **WHEN** configuration contains a messenger kind for which no adapter is installed or enabled
- **THEN** the system reports that instance as unsupported without failing other configured messenger instances

### Requirement: Secret environment fallback
The system SHALL support environment-variable fallback for secrets and deployment overrides while keeping canonical JSON config namespaced.

#### Scenario: Token is supplied by env reference
- **WHEN** a messenger instance specifies a token environment variable name and that variable is set
- **THEN** the system uses the env value at runtime without writing it to state, diagnostics, session history, or migrated config

#### Scenario: Legacy environment variable is present
- **WHEN** `TELEGRAM_BOT_TOKEN`, `PI_TELEGRAM_TUNNEL_*`, or existing `PI_RELAY_DISCORD_*`/`PI_RELAY_SLACK_*` variables are present and no canonical value exists
- **THEN** the system maps them to the migrated `default` messenger instance and reports a deprecation warning

#### Scenario: JSON contains env-style top-level keys
- **WHEN** the legacy config file contains top-level env-style keys such as `TELEGRAM_BOT_TOKEN` or `PI_RELAY_DISCORD_BOT_TOKEN`
- **THEN** migration reads them as legacy input but the canonical written config uses namespaced messenger fields or env references instead of duplicating env-style keys

### Requirement: Legacy config and state migration
The system SHALL migrate existing Telegram tunnel config and state into PiRelay config and state without leaking secrets or active pairing material.

#### Scenario: Legacy Telegram config exists
- **WHEN** `~/.pi/agent/telegram-tunnel/config.json` exists and canonical PiRelay config does not
- **THEN** the system offers or performs an idempotent migration to `~/.pi/agent/pirelay/config.json` with Telegram mapped to `messengers.telegram.default`

#### Scenario: Legacy binding state exists
- **WHEN** legacy Telegram binding records exist in the old state directory
- **THEN** the system imports active non-secret bindings into the new messenger-neutral state schema and preserves enough metadata to restore paired sessions

#### Scenario: Pending legacy pairings exist
- **WHEN** migration encounters unconsumed legacy pending pairing records
- **THEN** the system does not copy raw active pairing secrets and instructs the user to create a fresh `/relay connect telegram:default` pairing

### Requirement: Secret-safe diagnostics and config output
The system SHALL keep tokens, signing secrets, OAuth credentials, broker peer secrets, pairing nonces, and hidden session data out of all diagnostics and persisted relay state.

#### Scenario: Doctor reports messenger readiness
- **WHEN** the local user invokes `/relay doctor`
- **THEN** the output names configured messenger instances, readiness, missing credential categories, ownership status, federation status, and unsafe permissions without printing secret values

#### Scenario: Config file has unsafe permissions
- **WHEN** a config or state file containing relay configuration is group-readable or world-readable
- **THEN** diagnostics report an actionable permission warning such as `chmod 600` without printing the file contents

#### Scenario: Migration writes canonical config
- **WHEN** migration writes a new PiRelay config file
- **THEN** the file mode is restricted and the migration output redacts any token-shaped or secret-shaped values

### Requirement: Discord onboarding configuration guidance
The system SHALL make Discord Application ID/clientId, shared-server setup, and DM reachability part of setup and diagnostics for the QR-based Discord connect experience.

#### Scenario: Discord setup explains clientId source
- **WHEN** the local user invokes `/relay setup discord`
- **THEN** the setup guidance names Discord Developer Portal > General Information > Application ID as the source for `discord.clientId` or `PI_RELAY_DISCORD_CLIENT_ID`
- **AND** it explains that the clientId is needed to render the `/relay connect discord` QR invite/open link

#### Scenario: Doctor warns when Discord QR cannot be rendered
- **WHEN** Discord live control is enabled but no Discord Application ID/clientId is configured
- **THEN** `/relay doctor` reports a warning that manual PIN pairing may still work but QR redirect/invite guidance is unavailable

#### Scenario: Discord setup explains shared server and DMs
- **WHEN** `/relay setup discord` or `/relay connect discord` shows onboarding guidance
- **THEN** it explains that the user and bot generally need to share a Discord server and that Discord privacy settings must allow opening or receiving bot DMs

### Requirement: Canonical relay commands and resource names
The system SHALL use PiRelay and `/relay` naming for user-facing commands, docs, skills, extension resource paths, config paths, state paths, and diagnostics.

#### Scenario: User invokes canonical command
- **WHEN** the local user invokes `/relay setup`, `/relay connect`, `/relay status`, `/relay disconnect`, or `/relay doctor`
- **THEN** the system performs the requested messenger-neutral behavior using the configured messenger references

#### Scenario: User invokes removed Telegram tunnel command
- **WHEN** the local user invokes `/telegram-tunnel setup`, `/telegram-tunnel connect`, `/telegram-tunnel status`, or `/telegram-tunnel disconnect` after the breaking migration
- **THEN** the command is not registered by PiRelay and performs no relay action
- **AND** any migration hint, if shown by external stale metadata, directs the user to `/relay` without starting setup, pairing, status, or disconnect side effects

#### Scenario: Packaged resources are inspected
- **WHEN** PiRelay is installed from npm
- **THEN** the advertised Pi extension and skill resources use PiRelay/relay paths and do not require `telegram-tunnel` paths for normal operation
