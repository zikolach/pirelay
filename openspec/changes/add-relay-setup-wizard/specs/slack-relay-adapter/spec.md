## MODIFIED Requirements

### Requirement: Slack setup diagnostics
The system SHALL expose Slack adapter readiness through the generic relay setup wizard and doctor.

#### Scenario: Slack is missing credentials
- **WHEN** the local user invokes `/relay setup slack` or `/relay doctor` and Slack is enabled without a bot token or signing secret
- **THEN** the system reports the missing Slack credential category without printing any secret value

#### Scenario: Slack mode guidance is generated
- **WHEN** Slack setup guidance is generated
- **THEN** the system explains the configured event mode, preferring Socket Mode for local use when available and explaining webhook signing requirements when webhook mode is used

#### Scenario: Slack channel control is enabled
- **WHEN** Slack setup diagnostics run with channel control enabled
- **THEN** the system reports that DM-first mode is safer and requires explicit workspace/user authorization checks before channel events can control Pi
