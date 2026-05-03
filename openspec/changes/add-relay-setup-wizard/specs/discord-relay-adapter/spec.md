## MODIFIED Requirements

### Requirement: Discord setup diagnostics
The system SHALL expose Discord adapter readiness through the generic relay setup wizard and doctor.

#### Scenario: Discord is missing credentials
- **WHEN** the local user invokes `/relay setup discord` or `/relay doctor` and Discord is enabled without a bot token
- **THEN** the system reports the missing Discord bot token using secret-safe guidance

#### Scenario: Discord invite guidance is available
- **WHEN** Discord setup guidance is generated and a Discord client/application id is configured
- **THEN** the system includes a bot invite URL with minimal required scopes or permissions for DM-first operation

#### Scenario: Discord guild channels are enabled
- **WHEN** Discord setup diagnostics run with guild-channel control enabled
- **THEN** the system requires explicit allowed guild ids or reports an actionable warning
