## MODIFIED Requirements

### Requirement: Telegram tunnel setup compatibility
The system SHALL keep existing Telegram setup commands compatible while adding generic relay setup aliases.

#### Scenario: Existing Telegram setup command still works
- **WHEN** the local user invokes `/telegram-tunnel setup` or `/telegram-tunnel connect [name]`
- **THEN** the system performs the existing Telegram setup or pairing behavior without requiring generic `/relay` syntax

#### Scenario: Generic Telegram relay command is used
- **WHEN** the local user invokes `/relay setup telegram` or `/relay connect telegram [name]`
- **THEN** the system performs the equivalent Telegram setup or pairing behavior and uses the same authorization and state rules
