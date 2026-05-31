## ADDED Requirements

### Requirement: Approval gate enablement is explicit and disableable
PiRelay configuration SHALL make approval gates opt-in and SHALL provide a clear disable path through config and environment overrides.

#### Scenario: Approval config omits enabled flag
- **WHEN** approval gate rules, timeouts, grant settings, or audit settings are present but no config or environment value explicitly enables approval gates
- **THEN** PiRelay reports approval gates as disabled
- **AND** it does not block local or remote tool calls through approval gates

#### Scenario: Config disables approval gates
- **WHEN** `approvalGates.enabled` is set to `false`
- **THEN** PiRelay reports approval gates as disabled
- **AND** configured rules remain inert until the user explicitly enables approval gates again

#### Scenario: Environment disables approval gates
- **WHEN** `PI_RELAY_APPROVAL_ENABLED=false` is present in the environment
- **THEN** PiRelay resolves approval gates as disabled regardless of file-configured rules
- **AND** local diagnostics identify approval gates as disabled without printing raw rule patterns or secrets

#### Scenario: Documentation explains default and scope
- **WHEN** users read README, config docs, doctor output, or setup guidance for approval gates
- **THEN** the docs explain that approval gates are disabled by default, require explicit enablement, and apply only to remote messenger-owned turns
- **AND** the docs state that local Pi prompts never require messenger approval
