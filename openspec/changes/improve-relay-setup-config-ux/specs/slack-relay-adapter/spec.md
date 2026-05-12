## ADDED Requirements

### Requirement: Slack pairing command parsing and guidance
The Slack runtime SHALL use explicit non-slash pairing commands while keeping safe compatibility for legacy pairing text.

#### Scenario: Slack help advertises non-slash commands
- **WHEN** a paired Slack user requests help
- **THEN** PiRelay shows commands in the `pirelay <command>` form
- **AND** the help text explains that leading slash text is not recommended in Slack because Slack treats it as app slash commands

#### Scenario: Slack status command is not parsed as pairing
- **WHEN** a paired Slack user sends `pirelay status`
- **THEN** PiRelay treats the message as a Slack command
- **AND** it does not report the word `status` as an invalid or expired pairing code

#### Scenario: Slack runtime guidance uses non-slash commands
- **WHEN** PiRelay sends Slack guidance for post-pairing status, paused delivery, progress usage, one-shot sends, or unknown commands
- **THEN** the guidance uses the `pirelay <command>` form instead of leading-slash command text

#### Scenario: Slack pairing accepts safe legacy forms
- **WHEN** a Slack user sends `pirelay pair <pin>` for an active pending pairing
- **THEN** PiRelay completes the Slack pairing
- **AND** legacy `pirelay <pin>` and `/pirelay <pin>` text are accepted only when `<pin>` matches a real pending PIN or nonce format
- **AND** Discord-style `relay pair <pin>` text is not treated as a Slack pairing command

#### Scenario: Unpaired Slack channel receives channel-specific guidance
- **WHEN** a Slack channel or thread message reaches the runtime without a usable binding
- **THEN** PiRelay explains that channel control requires `slack.allowChannelMessages`, a local `/relay connect slack`, and sending the highlighted `pirelay pair <pin>` command in that channel/thread
- **AND** it also explains that the user can use the paired Slack app DM instead

### Requirement: Slack channel routing after pairing
The Slack runtime SHALL keep explicit channel pairings usable for follow-up commands after pairing.

#### Scenario: Channel command routes through the paired channel binding
- **WHEN** a Slack channel has an active non-revoked binding and `slack.allowChannelMessages` is enabled
- **AND** the sender's per-user active channel selection is missing
- **THEN** a command such as `pirelay status` uses the latest active binding for that Slack conversation
- **AND** PiRelay restores the active selection for that sender

#### Scenario: Slack busy follow-up preserves thread ownership
- **WHEN** a Slack prompt arrives while the target Pi route is already busy
- **THEN** PiRelay queues the message using the configured busy delivery mode
- **AND** the current in-progress turn's completion remains targeted to the thread that started that turn

### Requirement: Slack and messenger pairing notifications
The runtime SHALL make successful remote pairings visible locally with messenger-specific labels.

#### Scenario: Slack pairing notifies the local Pi session
- **WHEN** Slack pairing completes
- **THEN** the local Pi session receives a notification identifying the Slack user and session label
- **AND** the local audit entry uses the Slack/Relay label rather than a Telegram-only label

#### Scenario: Other messenger pairings keep label parity
- **WHEN** Discord or Telegram pairing completes
- **THEN** the local Pi session receives the same style of messenger-specific pairing notification

### Requirement: Slack progress notifications
The Slack runtime SHALL deliver non-terminal progress updates for paired Slack bindings according to each binding's progress mode.

#### Scenario: Verbose Slack binding receives progress updates
- **WHEN** a Slack binding has progress mode `verbose` and the paired Pi route reports running progress events
- **THEN** PiRelay sends coalesced `Pi progress` updates to the bound Slack conversation using the verbose progress interval
- **AND** thread context is preserved when the binding was associated with a Slack thread

#### Scenario: Quiet Slack binding suppresses non-terminal progress
- **WHEN** a Slack binding has progress mode `quiet` or `completion-only`
- **THEN** PiRelay suppresses non-terminal progress updates while still allowing terminal completion notifications

### Requirement: Slack thinking indicator
The Slack runtime SHALL prefer reaction-based thinking indicators for accepted Slack prompts and fall back safely when reactions are unavailable.

#### Scenario: Accepted Slack prompt receives a thinking reaction
- **WHEN** an authorized Slack DM or channel prompt is accepted for immediate delivery to Pi
- **THEN** PiRelay adds a `thinking_face` reaction to the Slack user message that triggered the prompt
- **AND** the reaction is removed when the Pi turn completes, fails, aborts, the route is unregistered, or the Slack runtime stops

#### Scenario: Slack reaction scope is unavailable
- **WHEN** PiRelay cannot add the thinking reaction because Slack rejects the reaction call or the operation is unavailable
- **THEN** PiRelay falls back to its ephemeral `Pi is working…` activity message in the same thread when thread context is available
- **AND** prompt delivery still proceeds

#### Scenario: Slack setup manifest includes reaction scope
- **WHEN** the Slack setup wizard renders or copies the Slack app manifest
- **THEN** the manifest includes `reactions:write` so reaction-based thinking indicators can be enabled after app reinstall
