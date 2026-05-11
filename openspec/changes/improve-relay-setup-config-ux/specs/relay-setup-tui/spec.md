## ADDED Requirements

### Requirement: Setup wizard copy-to-clipboard actions
The setup wizard SHALL provide a consistent copy-to-clipboard action for each supported messenger's placeholder environment-variable snippet with Pi editor fallback when clipboard access is unavailable.

#### Scenario: Telegram env snippet is copied to clipboard
- **WHEN** the local user opens `/relay setup telegram` in a TUI context and selects the copy env snippet action
- **THEN** PiRelay copies a Telegram env snippet with placeholder credential values to the system clipboard, or places it into the Pi editor when clipboard access is unavailable
- **AND** the snippet includes the Telegram bot token environment variable and any supported Telegram authorization env variables
- **AND** the snippet does not include resolved token values, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Discord env snippet is copied to clipboard
- **WHEN** the local user opens `/relay setup discord` in a TUI context and selects the copy env snippet action
- **THEN** PiRelay copies a Discord env snippet with placeholder credential values to the system clipboard, or places it into the Pi editor when clipboard access is unavailable
- **AND** the snippet includes the Discord bot token, application id or client id, and supported Discord authorization env variables
- **AND** the snippet does not include resolved token values, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Slack env snippet is copied to clipboard
- **WHEN** the local user opens `/relay setup slack` in a TUI context and selects the copy env snippet action
- **THEN** PiRelay copies a Slack env snippet with placeholder credential values to the system clipboard, or places it into the Pi editor when clipboard access is unavailable
- **AND** the snippet includes the Slack bot token, signing secret, app-level token, App ID, workspace, and supported Slack authorization env variables
- **AND** placeholder values use recognizable sample shapes such as `xoxb-…`, `xapp-…`, `A…`, `T…`, and `U…` so token fields are easy to distinguish from app, workspace, and user ids
- **AND** the snippet does not include resolved token values, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Copy action names clipboard behavior accurately
- **WHEN** the setup wizard presents the env snippet copy action
- **THEN** the action label and success message describe copying the snippet to the clipboard and documenting the Pi editor fallback when clipboard access is unavailable

#### Scenario: Copy action keeps setup wizard open
- **WHEN** the local user selects the copy env snippet action in the setup wizard
- **THEN** PiRelay copies the snippet or performs the editor fallback without closing the wizard
- **AND** the user can continue switching tabs or select write config from env afterwards

### Requirement: Setup wizard config-from-env action
The setup wizard SHALL provide a consistent action for Telegram, Discord, and Slack that writes or updates canonical PiRelay config from currently defined environment variables.

#### Scenario: User writes Telegram config from env
- **WHEN** the local user opens `/relay setup telegram` in a TUI context and selects the write config from env action while the Telegram token env var is defined
- **THEN** PiRelay asks for confirmation before writing config
- **AND** after confirmation writes or updates `messengers.telegram.default` with an env reference for the Telegram token and non-secret supported Telegram env-derived fields
- **AND** the wizard reports the config path, backup path when one was created, and secret-safe changed-field summary

#### Scenario: User writes Discord config from env
- **WHEN** the local user opens `/relay setup discord` in a TUI context and selects the write config from env action while the Discord required env vars are defined
- **THEN** PiRelay asks for confirmation before writing config
- **AND** after confirmation writes or updates `messengers.discord.default` with an env reference for the Discord bot token and non-secret supported Discord env-derived fields
- **AND** the wizard reports the config path, backup path when one was created, and secret-safe changed-field summary

#### Scenario: User writes Slack config from env
- **WHEN** the local user opens `/relay setup slack` in a TUI context and selects the write config from env action while the Slack required env vars are defined
- **THEN** PiRelay asks for confirmation before writing config
- **AND** after confirmation writes or updates `messengers.slack.default` with env references for the Slack bot token, signing secret, and Socket Mode app token, plus non-secret supported Slack env-derived fields
- **AND** the wizard reports the config path, backup path when one was created, and secret-safe changed-field summary

#### Scenario: Required env vars are missing
- **WHEN** the local user selects the write config from env action and required env vars for that messenger are missing
- **THEN** PiRelay does not write config by default
- **AND** the wizard explains which env variable names are missing and offers the copy-to-clipboard env snippet action as the next step

#### Scenario: User cancels config write confirmation
- **WHEN** the local user selects the write config from env action and then cancels the confirmation prompt
- **THEN** PiRelay does not write or modify the config file
- **AND** the setup wizard remains secret-safe and reports that no changes were made

### Requirement: Setup wizard tab layout
The setup wizard SHALL present setup content in a tab-like layout that keeps each content category isolated and keeps actions in the footer line.

#### Scenario: Setup wizard shows tab-like navigation
- **WHEN** the setup wizard is rendered for any supported messenger
- **THEN** it shows tab labels for Diagnostics, Env snippet, Config snippet, Links, and Troubleshooting
- **AND** it renders only the selected tab's content in the body
- **AND** it does not also render a duplicate vertical panel list, duplicate next-step section, or duplicate action section in the body

#### Scenario: Setup actions are shown in footer
- **WHEN** the setup wizard is rendered for any supported messenger
- **THEN** copy and write actions are shown in the bottom help/action line
- **AND** the body content remains dedicated to the selected tab

#### Scenario: Slack setup shows App Home QR guidance
- **WHEN** the setup wizard is rendered for Slack with a configured Slack App ID
- **THEN** the Links tab renders a Slack App Home open link and QR code
- **AND** the troubleshooting guidance explains that Slack App Home Messages Tab, `message.im`, `im:history`, `im:read`, `reactions:write`, and app reinstall are required when Slack says sending messages to the app is turned off

#### Scenario: Slack setup exposes a copyable app manifest
- **WHEN** the setup wizard is rendered for Slack
- **THEN** it includes an App manifest tab containing a secret-free Slack app manifest with App Home messages enabled, Socket Mode enabled, `chat:write`, `im:history`, `im:read`, `reactions:write`, channel/group history scopes, and `message.im` events
- **AND** it exposes a footer action to copy the manifest to the clipboard without closing the wizard
- **AND** the copied manifest does not include bot tokens, signing secrets, app-level tokens, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Slack setup explains missing App ID
- **WHEN** the setup wizard is rendered for Slack without a configured Slack App ID
- **THEN** the Links tab explains that `slack.appId` or `PI_RELAY_SLACK_APP_ID` is required for an App Home QR link

### Requirement: Pairing command copy affordance
The TUI pairing screens SHALL make copy/paste pairing commands easy to identify and copy for messengers that require manual text entry after opening a QR/deep link.

#### Scenario: Discord pairing command is highlighted and copyable
- **WHEN** `/relay connect discord` renders a QR pairing screen
- **THEN** the screen highlights the exact `relay pair <pin>` command to send
- **AND** it exposes a keyboard shortcut to copy that command to the clipboard without closing the dialog

#### Scenario: Slack pairing command is highlighted and copyable
- **WHEN** `/relay connect slack` renders an App Home QR pairing screen
- **THEN** the screen highlights the exact `pirelay pair <pin>` command to send without a leading slash
- **AND** it exposes a keyboard shortcut to copy that command to the clipboard without closing the dialog
- **AND** it clearly offers both supported pairing paths: open the app DM via QR/link or paste the pairing command directly in an invited Slack channel/thread after enabling channel-message control

#### Scenario: Slack pairing uses short mobile-friendly PINs
- **WHEN** `/relay connect slack` creates a pending pairing
- **THEN** the pairing command uses the same short PIN format as Discord instead of a long nonce
- **AND** the pairing remains expiring, single-use, channel-scoped, and subject to the same authorization/local-confirmation rules

### Requirement: Setup wizard action parity
The setup wizard SHALL expose the same action classes, keyboard semantics, and secret-safety guarantees for Telegram, Discord, and Slack.

#### Scenario: Supported messengers expose the same setup action classes
- **WHEN** setup wizard models are built for Telegram, Discord, and Slack
- **THEN** each model includes diagnostics, env snippet, config snippet, copy env snippet to clipboard, write config from env, links, troubleshooting, and next-step guidance where applicable

#### Scenario: Setup action keyboard semantics are consistent
- **WHEN** the setup wizard is open for any supported messenger
- **THEN** the same keys or selection controls navigate setup panels and invoke copy-to-clipboard or write-config-from-env actions
- **AND** Esc or `q` closes the wizard without changing configuration

#### Scenario: Setup TUI failure remains safe
- **WHEN** the setup wizard fails while preparing copy-to-clipboard or write-config-from-env actions
- **THEN** PiRelay falls back to secret-safe plain text setup guidance and does not write config implicitly
