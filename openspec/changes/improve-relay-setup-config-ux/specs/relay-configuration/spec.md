## ADDED Requirements

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

#### Scenario: Discord env mapping is available
- **WHEN** Discord setup metadata is requested
- **THEN** it defines the Discord bot token as a secret env reference mapping
- **AND** it defines supported Discord application id, user allow-list, guild allow-list, and channel-message env vars as non-secret config mappings

#### Scenario: Slack env mapping is available
- **WHEN** Slack setup metadata is requested
- **THEN** it defines the Slack bot token, signing secret, and app-level Socket Mode token as secret env reference mappings
- **AND** it defines supported Slack App ID, workspace id, bot user id, user allow-list, and channel-message env vars as non-secret config mappings

#### Scenario: Snippet and writer use the same metadata
- **WHEN** setup env snippets are rendered and config-from-env updates are computed for a messenger
- **THEN** both operations use the same env mapping metadata
- **AND** tests fail if a supported env var appears in the snippet but is ignored by the writer, or appears in the writer but not in the snippet
