# messenger-command-surfaces Specification

## Purpose
Ensure messenger command surfaces (Telegram command menu, Discord native `/relay`, and Slack slash-command surface) remain derived from and aligned with the canonical PiRelay remote command registry.
## Requirements
### Requirement: Canonical command surface metadata
The system SHALL derive messenger command-menu and native slash-command metadata from the canonical PiRelay remote command registry rather than maintaining unrelated per-platform command lists.

#### Scenario: Metadata includes implemented canonical commands
- **WHEN** command-surface metadata is generated for Telegram, Discord, or Slack
- **THEN** it includes every implemented canonical remote command or records a documented platform fallback or explicit exclusion
- **AND** it does not advertise commands that the runtime cannot parse or route

#### Scenario: Aliases do not create duplicate menu entries by default
- **WHEN** platform command-menu metadata is generated from a canonical command that has aliases
- **THEN** the default visible menu entry uses one canonical or platform-preferred command name
- **AND** aliases remain parseable only when the runtime already supports them or the platform-safe mapping explicitly routes them

#### Scenario: Command descriptions are platform safe
- **WHEN** command metadata is prepared for a messenger platform
- **THEN** descriptions and usage hints are bounded to that platform's length and character limits
- **AND** they do not include bot tokens, pairing codes, hidden prompts, transcripts, raw callback data, or internal state keys

### Requirement: Telegram bot command menu
The system SHALL register a Telegram bot command menu for configured Telegram bots using Telegram-safe command names mapped to canonical PiRelay command behavior.

#### Scenario: Telegram commands are registered after setup
- **WHEN** the Telegram runtime starts successfully and bot setup has been validated
- **THEN** PiRelay attempts to register Telegram BotCommands for the supported remote command set
- **AND** startup continues if command registration fails with a secret-safe warning or diagnostic

#### Scenario: Telegram command names are sanitized and mapped
- **WHEN** a canonical command name contains characters Telegram BotCommands do not allow, such as hyphens in `send-file` or `send-image`
- **THEN** the registered menu name uses a Telegram-valid mapping such as an existing alias or underscore form
- **AND** inbound Telegram messages using the registered menu name route to the intended canonical command behavior

#### Scenario: Telegram menu does not weaken authorization
- **WHEN** a Telegram user invokes a command from the Telegram menu
- **THEN** PiRelay authorizes the Telegram identity and binding before route selection, prompt injection, media download, callback execution, or control action execution

#### Scenario: Telegram shared rooms use addressed forms
- **WHEN** Telegram command menu entries are used from a group or supergroup where bot addressing matters
- **THEN** PiRelay supports Telegram-addressed command forms such as `/sessions@<bot_username>` according to existing shared-room routing rules
- **AND** unaddressed or unauthorized group commands do not trigger protected session actions

### Requirement: Discord namespaced native command surface
The system SHALL expose an optional namespaced Discord native application-command surface that routes to the same semantics as reliable Discord text-prefix commands.

#### Scenario: Discord native relay command is defined
- **WHEN** Discord native command metadata is generated
- **THEN** PiRelay defines a namespaced command such as `/relay` with subcommands or equivalent grouped options for supported canonical commands
- **AND** it does not rely on many collision-prone top-level commands such as `/status`, `/full`, `/abort`, or `/sessions` as the primary Discord UX

#### Scenario: Discord native invocation routes through existing command handling
- **WHEN** an authorized Discord user invokes `/relay status`, `/relay sessions`, `/relay full`, `/relay abort`, or another supported native subcommand
- **THEN** PiRelay normalizes the interaction into the same command semantics as `relay status`, `relay sessions`, `relay full`, `relay abort`, or the equivalent text-prefix command
- **AND** responses use the same success, usage, ambiguity, offline, unauthorized, unsupported-capability, or error response class as text commands

#### Scenario: Discord reliable text fallback remains documented
- **WHEN** Discord help, setup guidance, or diagnostics describe remote command usage
- **THEN** they advertise `relay <command>` text-prefix forms as the reliable baseline
- **AND** any mention of bare slash aliases labels them best-effort or platform-dependent

#### Scenario: Discord command registration is non-fatal
- **WHEN** Discord application-command registration or sync is unavailable, disabled, stale, or rate-limited
- **THEN** PiRelay continues running the Discord runtime when normal message ingress is otherwise healthy
- **AND** it reports a secret-safe diagnostic and keeps text-prefix commands functional

#### Scenario: Discord native command does not weaken authorization
- **WHEN** Discord delivers a native interaction for `/relay` or a subcommand
- **THEN** PiRelay authorizes the Discord user, guild/channel policy, and binding before route selection, prompt injection, media download, interaction callback execution, or control action execution

### Requirement: Slack relay slash-command surface
The system SHALL expose a Slack `/relay` slash-command surface that maps subcommands to existing Slack text-command behavior without replacing text fallbacks.

#### Scenario: Slack slash command is declared in setup metadata
- **WHEN** PiRelay generates Slack command-surface or setup metadata
- **THEN** it includes a `/relay` slash command with safe description and usage hint for PiRelay remote commands
- **AND** it does not require many workspace-global slash commands such as `/status` or `/abort`

#### Scenario: Slack Socket Mode slash payload is routed
- **WHEN** Slack delivers a `/relay status`, `/relay sessions`, `/relay full`, `/relay abort`, or another supported slash-command payload over Socket Mode
- **THEN** PiRelay acknowledges the Slack envelope promptly
- **AND** it normalizes the slash payload into the same command semantics as `relay status`, `relay sessions`, `relay full`, `relay abort`, or the equivalent text command

#### Scenario: Slack webhook slash payload is routed when webhook mode is enabled
- **WHEN** Slack delivers a signed slash-command webhook payload for `/relay` in webhook mode
- **THEN** PiRelay verifies the Slack signature before command routing
- **AND** it rejects invalid signatures before route selection, prompt injection, media download, or control actions

#### Scenario: Slack slash command responses are requester-scoped
- **WHEN** Slack command handling can use a response URL or ephemeral response for a native slash invocation
- **THEN** PiRelay uses requester-scoped response behavior for acknowledgements and command errors where the platform supports it
- **AND** protected output, files, images, and control results are delivered only to the authorized conversation/thread according to existing binding and shared-room rules

#### Scenario: Slack slash command does not weaken authorization
- **WHEN** a Slack user invokes `/relay` from a DM, channel, group, or thread
- **THEN** PiRelay authorizes the Slack workspace, user, conversation policy, and binding before route selection, prompt injection, media download, Block Kit action execution, or control action execution

### Requirement: Command-surface parity tests and diagnostics
The system SHALL test and diagnose command-surface parity so registered commands, menu entries, help text, and runtime parsers do not drift apart.

#### Scenario: Registered command metadata matches parser support
- **WHEN** command parity tests run
- **THEN** every Telegram menu command, Discord native subcommand, and Slack `/relay` subcommand maps to a runtime-supported command or documented fallback
- **AND** every canonical runtime-supported command has at least one visible command surface or reliable text fallback per platform

#### Scenario: Native command paths preserve safety invariants
- **WHEN** tests exercise native Telegram menu commands, Discord interactions, or Slack slash payloads from unauthorized, revoked, paused, offline, and valid bindings
- **THEN** PiRelay preserves existing authorization, revocation, pause, offline, and requester-scoping behavior

#### Scenario: Diagnostics explain missing native surface setup
- **WHEN** a platform native command surface cannot be registered or delivered because setup is incomplete
- **THEN** PiRelay setup or doctor output explains the missing non-secret readiness category and the reliable text fallback without printing secrets

