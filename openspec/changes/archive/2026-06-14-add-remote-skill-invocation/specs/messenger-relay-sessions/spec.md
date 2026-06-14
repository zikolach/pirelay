## MODIFIED Requirements

### Requirement: Canonical remote command parity
The system SHALL expose the canonical PiRelay remote command set through every first-class messenger adapter with equivalent behavior, using text commands, slash commands, buttons, menus, or documented fallbacks according to platform capabilities.

#### Scenario: Canonical commands are supported on every live adapter
- **WHEN** a live Telegram, Discord, Slack, or future messenger adapter receives `/help`, `/status`, `/sessions`, `/use`, `/to`, `/alias`, `/forget`, `/progress`, `/recent`, `/summary`, `/full`, `/skills`, `/skill`, `/images`, `/send-image`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, or `/disconnect` from an authorized user
- **THEN** the adapter routes the command through shared relay semantics and returns the same success, usage, ambiguity, offline, unauthorized, unsupported-capability, or error response class as the other live adapters

#### Scenario: Unsupported-command help does not catch implemented commands
- **WHEN** an authorized user sends any canonical command through any live messenger adapter
- **THEN** the adapter SHALL NOT fall through to a generic "supported commands" or unknown-command response unless that command is explicitly disabled by configuration or unsupported by declared platform capability

#### Scenario: Capability-gated command fallback is explicit
- **WHEN** a canonical command depends on a platform capability such as file upload, image delivery, inline buttons, typing indicators, slash commands, or message chunking that the active adapter does not support
- **THEN** the system returns a clear capability-specific fallback or limitation message and records that limitation in adapter parity tests rather than omitting the command

#### Scenario: Help lists the same canonical command set
- **WHEN** an authorized user requests `/help` through any live messenger adapter
- **THEN** the response lists the same canonical PiRelay command set, with only platform-specific invocation hints or capability notes differing

#### Scenario: Platform slash command registration matches runtime support
- **WHEN** a messenger platform requires command registration, such as Discord application commands or Slack slash commands
- **THEN** every registered command is implemented by the runtime and every implemented canonical command has a registered slash command, interaction equivalent, or documented text fallback

#### Scenario: Discord text-prefix commands avoid slash interception
- **WHEN** an authorized Discord DM user sends `relay status`, `relay sessions`, `relay full`, `relay skills`, `relay skill`, `relay abort`, or another canonical command using the `relay <command>` text-prefix form
- **THEN** PiRelay handles the command as an ordinary Discord message without depending on Discord application-command routing or top-level slash-command selection

#### Scenario: Discord bare slash aliases are best-effort
- **WHEN** Discord delivers a bare slash-like message such as `/status`, `/full`, or `/sessions` as ordinary message text
- **THEN** PiRelay MAY handle it as a convenience alias
- **AND** correctness, documentation, tests, and smoke guidance MUST NOT rely on Discord delivering bare slash aliases because Discord may route those names to another application or reject them before PiRelay receives the event

#### Scenario: Native Discord application command is namespaced
- **WHEN** PiRelay registers native Discord application commands
- **THEN** it registers a namespaced PiRelay command surface such as `/relay <subcommand>` with canonical subcommands or an equivalent grouped command
- **AND** it does not rely on many collision-prone top-level commands such as `/status`, `/full`, `/abort`, or `/sessions` as the primary Discord UX

#### Scenario: Discord help advertises reliable invocation first
- **WHEN** an authorized Discord user requests help through `relay help`, `/help`, or a platform-native help interaction
- **THEN** the response advertises `relay <command>` forms as the reliable Discord invocation surface and labels bare slash aliases as optional/best-effort when mentioned
