## ADDED Requirements

### Requirement: Agent delegation configuration
The system SHALL provide explicit configuration for shared-room agent delegation without enabling autonomous peer-bot work by default.

#### Scenario: Delegation is disabled by default
- **WHEN** PiRelay configuration does not enable agent delegation for a messenger instance or shared room
- **THEN** bot-authored delegation creation, claim, and auto-execution are disabled
- **AND** existing human-directed shared-room commands remain unchanged

#### Scenario: Trusted peer bot is configured
- **WHEN** configuration declares a trusted peer bot identity for delegation
- **THEN** it records only non-secret peer identity metadata, allowed messenger instance/room scope, allowed source/target machines, capabilities, creation/claim permissions, and optional display label
- **AND** diagnostics do not print tokens, pairing codes, hidden prompts, transcripts, or raw task prompt content

#### Scenario: Local capabilities are configured
- **WHEN** configuration declares local machine or session capabilities such as `linux-tests`, `browser`, or `long-running-jobs`
- **THEN** PiRelay uses those non-secret capabilities for delegation eligibility and diagnostics
- **AND** it does not infer broad capabilities from installed tools unless explicitly configured or safely detected by a future opt-in mechanism

#### Scenario: Autonomy level is configured
- **WHEN** configuration sets delegation autonomy to `off`, `propose-only`, `auto-claim-targeted`, or `auto-claim-safe-capability`
- **THEN** PiRelay applies that level as an upper bound on bot-authored task behavior for the configured messenger instance or room
- **AND** unknown autonomy values are rejected by config validation or reported by doctor diagnostics

#### Scenario: Delegation bounds are configured
- **WHEN** configuration enables delegation
- **THEN** PiRelay applies bounded defaults or configured values for task expiry, running timeout, maximum delegation depth, maximum visible summary length, and maximum recent task history

### Requirement: Delegation diagnostics
The system SHALL report shared-room delegation readiness and unsafe configuration without exposing secrets.

#### Scenario: Doctor reports delegation readiness
- **WHEN** the local user invokes `/relay doctor` with delegation enabled
- **THEN** diagnostics report delegation autonomy level, trusted peer count, local capability labels, room/channel readiness, approval-gate dependency status, and platform limitations
- **AND** diagnostics do not print bot tokens, task hidden prompts, full transcripts, pairing codes, or raw tool inputs

#### Scenario: Delegation configuration is unsafe
- **WHEN** delegation is enabled without explicit peer trust, room scope, known local bot identity, human approval path, or required shared-room platform readiness
- **THEN** diagnostics report a warning or blocking finding and recommend propose-only or disabled mode until the unsafe condition is resolved
