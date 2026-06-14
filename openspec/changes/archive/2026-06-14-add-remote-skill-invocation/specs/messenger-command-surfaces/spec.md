## ADDED Requirements

### Requirement: Remote skill commands are represented in command surfaces
The system SHALL expose remote skill discovery and invocation through stable PiRelay command-surface metadata without dynamically registering every local skill as a platform command.

#### Scenario: Canonical metadata includes skill commands
- **WHEN** command-surface metadata is generated for Telegram, Discord, or Slack
- **THEN** it includes the canonical `skills` and `skill` commands when remote skill invocation is implemented or explicitly documents their disabled/unsupported state
- **AND** it does not generate a separate native command for each local skill by default

#### Scenario: Telegram skill commands use safe names
- **WHEN** Telegram bot command metadata is generated and remote skill invocation is enabled or documented
- **THEN** the Telegram command menu includes safe entries such as `/skills` and `/skill`
- **AND** inbound Telegram skill commands route through the same authorization and policy checks as other protected relay commands

#### Scenario: Discord skill commands use namespaced surface
- **WHEN** Discord native `/relay` command metadata is generated
- **THEN** the metadata includes `skills` and `skill` subcommands or an equivalent namespaced option group
- **AND** reliable text fallback forms such as `relay skills` and `relay skill <name> [input]` remain documented

#### Scenario: Slack skill commands use relay namespace
- **WHEN** Slack slash-command setup metadata is generated
- **THEN** the `/relay` usage hint includes skill discovery/invocation where platform length limits allow
- **AND** `relay skills` and `relay skill <name> [input]` text forms remain supported as reliable fallbacks

#### Scenario: Skill menu entries are bounded
- **WHEN** PiRelay renders a skill list as buttons, menus, or command help
- **THEN** labels and descriptions are truncated or paginated according to platform limits
- **AND** they include only safe skill name, description, and source category metadata permitted by skill exposure policy
