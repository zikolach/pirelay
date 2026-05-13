# relay-configuration Specification

## Purpose
Defines PiRelay configuration loading, legacy migration, messenger instance naming, safe diagnostics, and secret-handling rules for Telegram, Discord, Slack, and future adapters.
## Requirements
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

### Requirement: Shared-room machine bot configuration
The system SHALL expose configuration and diagnostics for identifying a machine bot in shared rooms without storing or printing secrets.

#### Scenario: Machine display identity is configured
- **WHEN** PiRelay configuration defines a machine id, optional display name, and optional aliases for shared-room targeting
- **THEN** setup guidance, `/relay doctor`, and shared-room command help use those non-secret identifiers to explain how users can target that machine

#### Scenario: Shared-room readiness is diagnosed
- **WHEN** the local user invokes `/relay doctor` for a messenger instance intended for shared-room use
- **THEN** diagnostics report messenger readiness, machine identity, room/group/channel visibility requirements, authorization policy, and whether plain-text active-session routing is expected to work without printing tokens, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Duplicate local token is configured
- **WHEN** two configured messenger instances in the same config/state directory resolve to the same bot token or account fingerprint
- **THEN** diagnostics report a blocking or high-severity warning that shared-room machine-bot mode requires distinct bot/app identities and must not start duplicate local ingress for the same account when unsafe

#### Scenario: Cross-machine duplicate cannot be proven
- **WHEN** setup guidance describes shared-room deployment across multiple machines
- **THEN** it explicitly states that PiRelay cannot guarantee global duplicate-token prevention without broker coordination and that each machine must be configured with its own dedicated bot/app token for no-federation shared-room mode

### Requirement: Shared-room setup guidance
The system SHALL guide users to create one shared room per messenger and invite every participating machine bot/app with the permissions required by that platform.

#### Scenario: Telegram shared-room guidance is requested
- **WHEN** `/relay setup telegram` describes shared-room mode
- **THEN** it explains that multiple machine bots require a Telegram group or supergroup, that each machine needs a dedicated bot token, and that ordinary unaddressed prompts require bot privacy mode or permissions that allow the bot to see group messages

#### Scenario: Discord shared-room guidance is requested
- **WHEN** `/relay setup discord` describes shared-room mode
- **THEN** it explains that each machine uses a dedicated Discord application/bot identity in a shared server channel, that reliable text-prefix or mention forms are preferred, and that required intents/scopes/channel permissions must be enabled

#### Scenario: Slack shared-room guidance is requested
- **WHEN** `/relay setup slack` describes shared-room mode
- **THEN** it explains that each machine uses a dedicated Slack app/bot identity in a shared channel or DM-equivalent supported by Slack, with event scopes and channel membership sufficient for the selected command and mention fallback behavior

### Requirement: Messenger shared-room readiness diagnostics
The system SHALL report per-platform shared-room readiness and known gaps without implying unsupported parity.

#### Scenario: Telegram shared-room readiness is diagnosed
- **WHEN** `/relay doctor` or setup guidance checks a Telegram messenger intended for shared-room use
- **THEN** it reports dedicated bot identity readiness, group/supergroup requirement, privacy-mode addressed command fallback, Telegram Bot-to-Bot Communication Mode as enabled/unknown/manual-check as appropriate, and optional live smoke-test instructions

#### Scenario: Discord shared-room readiness is diagnosed
- **WHEN** `/relay doctor` or setup guidance checks a Discord messenger intended for shared-room use
- **THEN** it reports dedicated application/bot identity readiness, guild-channel enablement, allowed guild ids, Message Content Intent, channel permissions, reliable `relay <command>` or mention fallback, and slash-command collision caveats

#### Scenario: Slack shared-room readiness is diagnosed
- **WHEN** `/relay doctor` or setup guidance checks a Slack messenger intended for shared-room use
- **THEN** it reports dedicated app/bot identity readiness, Socket Mode or webhook readiness, signing-secret readiness, workspace boundary, channel-message enablement, required scopes/event subscriptions, app mention/channel command fallback, and any runtime parity gaps that remain unsupported

#### Scenario: Shared-room parity gap exists
- **WHEN** any messenger lacks implementation for a capability advertised by shared-room docs or adapter declarations
- **THEN** diagnostics and setup guidance identify that gap as unsupported or experimental until implementation and tests prove the behavior

### Requirement: Slack runtime configuration
The system SHALL load and validate the Slack credentials and non-secret identity settings required for live Slack runtime operation.

#### Scenario: Slack Socket Mode config is loaded
- **WHEN** canonical config or environment variables provide a Slack bot token, signing secret, event mode, app-level Socket Mode token reference, workspace id, and authorization policy
- **THEN** PiRelay resolves the Slack runtime configuration without writing token values into state, diagnostics, session history, or migrated config

#### Scenario: Slack app-level token is missing
- **WHEN** Slack is enabled with Socket Mode but no app-level Socket Mode token or token environment reference is available
- **THEN** setup and doctor diagnostics report that Socket Mode requires an app-level token with the appropriate Slack connection permission
- **AND** PiRelay does not start unsafe Slack ingress for that instance

#### Scenario: Slack bot user id is configured as override
- **WHEN** Slack configuration or environment provides a non-secret bot user id override
- **THEN** PiRelay may use it as a fallback for local mention targeting and diagnostics when runtime discovery is unavailable
- **AND** diagnostics indicate whether the id was discovered or configured manually

### Requirement: Slack runtime readiness diagnostics
The system SHALL report Slack live runtime readiness and shared-room safety without exposing secrets.

#### Scenario: Doctor reports Slack live readiness
- **WHEN** the local user invokes `/relay doctor` and Slack is configured
- **THEN** diagnostics report Slack enabled state, event mode, bot token presence, signing secret presence, app-level token presence when needed, workspace boundary, bot identity discovery, channel-control setting, shared-room room hint, and user allow-list/trust posture
- **AND** diagnostics do not print Slack bot tokens, app-level tokens, signing secrets, response URLs, Socket Mode URLs, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Slack shared-room configuration is unsafe
- **WHEN** Slack shared-room control is enabled without a known local bot user id, workspace boundary, channel membership confidence, or sufficient authorization policy
- **THEN** diagnostics report the missing readiness category and recommend the safer DM-first setup
- **AND** Slack channel prompt routing remains disabled until the unsafe condition is resolved

#### Scenario: Duplicate Slack app identity is detected locally
- **WHEN** two locally configured Slack instances resolve to the same Slack app, bot user id, bot id, or token/account fingerprint
- **THEN** diagnostics report that shared-room mode requires distinct Slack app identities per machine
- **AND** PiRelay refuses or disables duplicate local ingress when safe to do so

### Requirement: Slack setup guidance for complete runtime
The system SHALL guide users through configuring Slack for full PiRelay runtime support rather than receive-only stub testing.

#### Scenario: Slack setup guidance is requested
- **WHEN** the local user invokes `/relay setup slack`
- **THEN** the guidance explains Slack app creation, Bot User OAuth token, signing secret, app-level Socket Mode token, required scopes, event subscriptions, workspace id, app/channel membership, allow-list/trust recommendations, and DM-first pairing
- **AND** it separately explains the additional requirements for shared-channel machine-bot mode

#### Scenario: Slack live test guidance is requested
- **WHEN** docs or diagnostics describe the optional live Slack suite
- **THEN** they explain that live credentials are opt-in, should be disposable, should be supplied through ignored local scripts or CI secrets, and must not be committed
- **AND** they distinguish production runtime behavior from diagnostic/test-only fallbacks such as bounded history polling

### Requirement: Config update from messenger environment variables
The system SHALL provide a canonical config update operation that maps currently defined messenger environment variables into `messengers.<kind>.default` config without persisting secret values.

#### Scenario: Secret env variable is mapped to env reference
- **WHEN** a supported messenger's secret env variable is defined and the config update operation is applied
- **THEN** the written config stores the corresponding env var name in the messenger instance config, such as `tokenEnv`, `signingSecretEnv`, or `appTokenEnv`
- **AND** the written config does not store the resolved secret value

#### Scenario: Non-secret env variable is mapped to config value
- **WHEN** a supported messenger's non-secret env variable is defined and the config update operation is applied
- **THEN** the written config stores the parsed non-secret value in the corresponding messenger instance config field
- **AND** comma-separated identity lists are stored as string arrays and boolean env vars are stored as booleans

#### Scenario: Existing config is merged, not replaced
- **WHEN** a PiRelay config file already contains relay settings, defaults, other messengers, other instances, unsupported messenger sections, or fields not managed by the selected setup flow
- **THEN** the config update operation preserves those unrelated settings
- **AND** it updates only the selected `messengers.<kind>.default` fields that correspond to currently defined supported env vars

#### Scenario: Missing env vars do not erase existing values
- **WHEN** a supported env var is not defined during a config update operation
- **THEN** the operation leaves the corresponding existing config field unchanged
- **AND** it reports the env var as missing when it is required for the selected messenger's common live setup path

#### Scenario: Config file does not yet exist
- **WHEN** the config update operation is applied and the active PiRelay config file does not exist
- **THEN** the system creates the parent directory if needed
- **AND** it writes a canonical config file containing the selected messenger default instance and any env-derived fields
- **AND** it restricts the config file permissions to owner read/write

### Requirement: Config update write safety
The system SHALL apply safe file handling and secret-safe reporting when writing config from environment variables.

#### Scenario: Existing config is backed up before write
- **WHEN** the config update operation writes to an existing config file
- **THEN** the system creates a timestamped backup before replacing the config file
- **AND** the result includes the backup path in a secret-safe form

#### Scenario: Written config has restricted permissions
- **WHEN** the config update operation writes a config file
- **THEN** the system sets the config file mode to `600` or the platform equivalent owner-only restriction
- **AND** diagnostics no longer warn that the written config file is group-readable or world-readable on platforms where POSIX modes apply

#### Scenario: Write result is secret-safe
- **WHEN** the config update operation returns a result for display in setup UI, notifications, logs, or tests
- **THEN** the result names the config path, backup path, messenger kind, instance id, changed field names, and missing env var names
- **AND** the result does not contain token values, signing secret values, app token values, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Runtime config is refreshed after write
- **WHEN** `/relay setup <messenger>` successfully writes config from env vars
- **THEN** the extension invalidates or refreshes its cached resolved config
- **AND** later `/relay doctor`, `/relay setup`, or `/relay connect` commands in the same Pi session observe the updated config

### Requirement: Messenger setup env mapping parity
The system SHALL define environment-to-config mappings for Telegram, Discord, and Slack using shared metadata so snippets and writes remain consistent.

#### Scenario: Telegram env mapping is available
- **WHEN** Telegram setup metadata is requested
- **THEN** it defines the Telegram bot token as a secret env reference mapping
- **AND** it defines supported Telegram authorization identity env vars as non-secret config mappings

#### Scenario: Canonical Telegram token env bootstraps setup
- **WHEN** no config file exists and `PI_RELAY_TELEGRAM_BOT_TOKEN` is defined
- **THEN** PiRelay can load Telegram setup from that env var so the copied setup snippet can bootstrap `/relay setup` and `/relay connect`
- **AND** legacy `TELEGRAM_BOT_TOKEN` remains supported

#### Scenario: Discord env mapping is available
- **WHEN** Discord setup metadata is requested
- **THEN** it defines the Discord bot token as a secret env reference mapping
- **AND** it defines supported Discord application id, user allow-list, guild allow-list, and channel-message env vars as non-secret config mappings

#### Scenario: Slack env mapping is available
- **WHEN** Slack setup metadata is requested
- **THEN** it defines the Slack bot token, signing secret, and app-level Socket Mode token as secret env reference mappings
- **AND** it defines supported Slack App ID, workspace id, bot user id, user allow-list, and channel-message env vars as non-secret config mappings

#### Scenario: Slack app token requirement follows event mode
- **WHEN** Slack config update from env is computed
- **THEN** `PI_RELAY_SLACK_APP_TOKEN` is required for Socket Mode or when event mode is unspecified and no existing webhook mode is configured
- **AND** `PI_RELAY_SLACK_APP_TOKEN` is not required when `PI_RELAY_SLACK_EVENT_MODE=webhook`
- **AND** `PI_RELAY_SLACK_APP_TOKEN` is not required when the existing Slack config already has `eventMode: "webhook"`

#### Scenario: Snippet and writer use the same metadata
- **WHEN** setup env snippets are rendered and config-from-env updates are computed for a messenger
- **THEN** both operations use the same env mapping metadata
- **AND** tests fail if a supported env var appears in the snippet but is ignored by the writer, or appears in the writer but not in the snippet

### Requirement: Slack setup documents file upload permissions
The system SHALL guide users to configure Slack file upload permissions whenever Slack outbound image or document delivery is available.

#### Scenario: Slack setup manifest includes file upload scope
- **WHEN** PiRelay generates or documents a Slack app manifest for live Slack control
- **THEN** the manifest includes the bot scope required to upload files to Slack conversations
- **AND** the setup guidance tells users to reinstall the Slack app after changing scopes

#### Scenario: Slack setup checklist mentions file delivery
- **WHEN** the local user runs `/relay setup slack`
- **THEN** setup guidance lists Slack file upload permission as required for `pirelay images` and `pirelay send-image`
- **AND** distinguishes that text-only remote control can work without file upload permission

#### Scenario: Slack upload failure reports setup action
- **WHEN** Slack file delivery fails because of missing permission or app installation state
- **THEN** diagnostics or chat guidance tells the user to add the Slack file upload scope and reinstall the app without printing tokens, signing secrets, upload URLs, or file contents

