## ADDED Requirements

### Requirement: New-session command is part of canonical messenger surfaces
The system SHALL expose a canonical new-session command through messenger command metadata, help text, and platform-specific command surfaces when the adapter can route the command to shared session-control semantics.

#### Scenario: Help advertises remote new command where supported
- **WHEN** an authorized user requests help through Telegram, Discord, Slack, or a future live messenger adapter that supports remote session-control commands
- **THEN** the help text includes the new-session command such as `/new` or the platform's equivalent invocation form
- **AND** it explains that the command starts a replacement Pi session for the selected live route

#### Scenario: Command menu includes new session command
- **WHEN** PiRelay derives Telegram bot commands, Discord native command metadata, Slack command metadata, or another platform command menu for an adapter that supports remote new-session routing
- **THEN** the metadata includes the new-session command or equivalent namespaced subcommand
- **AND** unsupported adapters document the limitation rather than silently omitting an implemented command

#### Scenario: Unsupported new command is explicit
- **WHEN** a messenger adapter receives `/new` or an equivalent new-session command but the selected route or adapter cannot execute session replacement
- **THEN** the response is a clear capability-specific limitation or route-state message
- **AND** it does not fall through to generic unknown-command help

#### Scenario: Reliable Discord invocation remains namespaced
- **WHEN** Discord exposes the new-session command
- **THEN** PiRelay documents a reliable invocation such as `relay new` or `/relay new`
- **AND** any bare `/new` alias is treated as best-effort only
