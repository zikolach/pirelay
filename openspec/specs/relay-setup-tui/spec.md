# relay-setup-tui Specification

## Purpose
Defines the interactive and fallback setup wizard experience for supported PiRelay messengers, including readiness diagnostics, safe snippets, links, troubleshooting, and secret-safe rendering.
## Requirements
### Requirement: Interactive messenger setup wizard
The system SHALL provide an interactive setup wizard for each supported messenger when `/relay setup <messenger>` is invoked from a Pi context with TUI support.

#### Scenario: Setup command opens TUI when UI is available
- **WHEN** the local user invokes `/relay setup telegram`, `/relay setup discord`, or `/relay setup slack` and the Pi context supports custom UI
- **THEN** PiRelay opens an interactive setup wizard for the selected messenger
- **AND** the wizard shows setup readiness, checklist items, safe links/snippets, troubleshooting notes, and next steps for that messenger

#### Scenario: Setup command falls back to text when UI is unavailable
- **WHEN** the local user invokes `/relay setup <messenger>` from a headless or non-interactive context
- **THEN** PiRelay returns the existing secret-safe plain text setup guidance instead of attempting to render a TUI

#### Scenario: Setup TUI failure falls back safely
- **WHEN** rendering the setup wizard fails or the custom UI API rejects
- **THEN** PiRelay returns the plain text setup guidance and a secret-safe warning rather than failing the setup command entirely

### Requirement: Setup wizard checklist model
The system SHALL build setup wizard content from a messenger-neutral checklist model with adapter-specific setup items.

#### Scenario: Telegram setup checklist is shown
- **WHEN** the setup wizard is opened for Telegram
- **THEN** it shows bot token readiness, BotFather guidance, private-chat pairing guidance, allow-list or trusted-user safety, and `/relay connect telegram` as the next step

#### Scenario: Discord setup checklist is shown
- **WHEN** the setup wizard is opened for Discord
- **THEN** it shows bot token readiness, Application ID/clientId readiness, Message Content Intent guidance, shared-server and DM reachability guidance, allow-list or trusted-user safety, and `/relay connect discord` as the next step
- **AND** if clientId is configured, it exposes the Discord OAuth2 bot invite/open URL and QR-ready link
- **AND** if clientId is missing, it explains that QR redirect is unavailable until Application ID/clientId is configured

#### Scenario: Slack setup checklist is shown
- **WHEN** the setup wizard is opened for Slack
- **THEN** it shows bot token readiness, signing secret readiness, workspace boundary guidance, event mode guidance, DM-first safety, allow-list guidance, and `/relay connect slack` as the next step

#### Scenario: Unsupported messenger setup is requested
- **WHEN** the local user invokes setup for a messenger kind that PiRelay does not support
- **THEN** PiRelay does not open a setup wizard and returns the existing unsupported-channel guidance

### Requirement: Setup wizard actions and navigation
The setup wizard SHALL provide a simple keyboard-driven interface for inspecting setup actions without requiring users to memorize documentation.

#### Scenario: User navigates setup actions
- **WHEN** the setup wizard is open
- **THEN** arrow keys or `j`/`k` move between available actions or sections
- **AND** Enter selects the highlighted action or panel
- **AND** Esc or `q` closes the wizard without changing configuration

#### Scenario: User views config snippet
- **WHEN** the user selects a config or environment snippet action
- **THEN** the wizard shows a copy-pasteable snippet for the selected messenger using placeholder values or environment variable names instead of resolved secret values

#### Scenario: User views invite or QR link
- **WHEN** the user selects an invite, QR, or platform link action
- **THEN** the wizard shows the relevant secret-safe URL and any platform caveats such as Discord shared-server/DM requirements

#### Scenario: User views doctor summary
- **WHEN** the user selects a diagnostics or doctor action in the wizard
- **THEN** the wizard shows secret-safe readiness findings for the selected messenger and shared setup checks

### Requirement: Setup wizard secret safety
The setup wizard SHALL avoid exposing secrets, pairing codes, hidden prompts, tool internals, or transcripts in all rendered setup content.

#### Scenario: Secret-backed config is rendered
- **WHEN** bot tokens, signing secrets, OAuth secrets, peer secrets, or token environment variables are configured
- **THEN** the wizard reports credential categories and env variable names without printing resolved secret values

#### Scenario: Setup screenshot is shared
- **WHEN** a user screenshots or copies visible setup wizard content
- **THEN** the content contains only safe readiness labels, links, config placeholders, env variable names, and troubleshooting steps

### Requirement: Setup wizard parity coverage
The system SHALL test the interactive setup wizard and plain-text fallback across all supported messengers.

#### Scenario: Wizard model is tested per messenger
- **WHEN** unit tests build setup wizard models for Telegram, Discord, and Slack
- **THEN** each model contains the expected checklist items, next steps, and secret-safe snippets for configured and missing credential states

#### Scenario: Runtime setup command is tested with and without UI
- **WHEN** runtime tests invoke `/relay setup <messenger>` with `ctx.hasUI` true and false
- **THEN** the UI case opens the setup wizard and the no-UI case returns plain text guidance

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

#### Scenario: Env vars are present but invalid
- **WHEN** the local user selects the write config from env action and one or more defined env vars cannot be parsed, such as an invalid boolean value
- **THEN** PiRelay does not write config by default
- **AND** the wizard explains which env variable names are invalid so the user can fix them before retrying

#### Scenario: User cancels config write confirmation
- **WHEN** the local user selects the write config from env action and then cancels the confirmation prompt
- **THEN** PiRelay does not write or modify the config file
- **AND** the setup wizard remains secret-safe and reports that no changes were made

### Requirement: Setup wizard tab layout
The setup wizard SHALL present setup content in a tab-like layout that keeps each content category isolated and keeps actions in the footer line.

#### Scenario: Setup wizard shows tab-like navigation
- **WHEN** the setup wizard is rendered for any supported messenger
- **THEN** it shows tab labels for Diagnostics, Env snippet, Config snippet, Links, and Troubleshooting, plus messenger-specific tabs such as Slack App manifest when applicable
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
- **THEN** it includes an App manifest tab (labeled "App manifest") containing a secret-free Slack app manifest with App Home messages enabled, Socket Mode enabled, `chat:write`, `im:history`, `im:read`, `reactions:write`, channel/group history scopes, `message.im` events, interactivity enabled, and a `/relay` slash command entry for PiRelay remote commands
- **AND** it exposes a footer action to copy the manifest to the clipboard without closing the wizard
- **AND** the copied manifest does not include bot tokens, signing secrets, app-level tokens, pairing codes, hidden prompts, tool internals, or transcripts
- **AND** the setup guidance explains that Slack must deliver `/relay` through the installed app manifest before native slash invocations work, while plain `relay <command>` text remains the reliable fallback when slash setup is unavailable

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

#### Scenario: Pairing completion closes local pairing screen
- **WHEN** a Telegram, Discord, or Slack pairing completes while the local pairing QR/dialog screen is open
- **THEN** PiRelay closes the local pairing screen automatically
- **AND** it shows a local messenger-specific notification identifying the paired user and session label even when the user was already allow-listed

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

