# relay-setup-tui Specification

## Purpose
TBD - created by archiving change add-interactive-setup-tui. Update Purpose after archive.
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

