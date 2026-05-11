## ADDED Requirements

### Requirement: Optional broker namespace isolation
The system SHALL support an optional non-secret broker namespace that scopes local broker coordination so multiple independent PiRelay machine identities can run on the same host without sharing one broker.

#### Scenario: Default broker topology remains unchanged
- **WHEN** PiRelay starts without an explicit broker namespace override
- **THEN** it preserves the existing machine-local broker behavior for the configured state directory
- **AND** additional Pi sessions using the same default broker scope connect to the existing broker instead of starting another broker

#### Scenario: Distinct namespaces run independent brokers
- **WHEN** two PiRelay processes start on the same host with distinct broker namespace values and distinct state directories or machine identities
- **THEN** each process uses namespace-scoped broker socket, pid, lock, and supervision paths
- **AND** each process starts or connects only to the broker for its own namespace
- **AND** route registration, messenger runtime ownership, active selections, and completion notifications do not cross namespace boundaries

#### Scenario: Stale namespace coordination files exist
- **WHEN** a namespace-scoped broker socket, pid, or lock file exists but the broker for that namespace is no longer alive
- **THEN** PiRelay removes or replaces only the stale files for that namespace
- **AND** it does not disturb brokers or state for other namespaces

#### Scenario: Ephemeral namespace owner stops
- **WHEN** a test or live harness owns an ephemeral namespace-scoped broker process
- **THEN** harness teardown terminates the broker process group recorded for that namespace before deleting temporary state
- **AND** default non-namespaced brokers keep their long-lived behavior unless explicitly cleaned up

#### Scenario: Namespace is reported safely
- **WHEN** setup, doctor, tests, or debug logs report broker isolation status
- **THEN** they may include the non-secret namespace label and scoped path category
- **AND** they do not print messenger tokens, broker peer secrets, pairing codes, hidden prompts, or transcripts

### Requirement: Same-host Slack real-agent live isolation
The system SHALL use broker namespace isolation when the Slack live suite runs multiple real LLM-backed Pi agents on the same host.

#### Scenario: Real-agent live suite starts two Slack machine bots
- **WHEN** `PI_RELAY_SLACK_LIVE_REAL_AGENT=true` and the live suite launches bot A and bot B Pi commands on the same host
- **THEN** the harness assigns a unique broker namespace to each bot process
- **AND** each bot process uses its own Slack credentials, state directory, machine identity, and broker namespace
- **AND** neither bot attaches to the other bot's broker or route registry

#### Scenario: Real-agent live suite observes stub output
- **WHEN** real-agent live mode receives a Slack response containing receive-confirmation stub text instead of an agent-routed acknowledgement or model completion
- **THEN** the suite fails with a clear diagnostic that the run did not exercise the real LLM-backed Pi agent path
- **AND** the diagnostic remains redacted for Slack credentials and pairing secrets

#### Scenario: Same-host real-agent live suite validates machine isolation
- **WHEN** the real-agent live suite sends a targeted prompt to one Slack machine app
- **THEN** only the targeted namespace's broker and Pi agent route may accept the prompt
- **AND** the non-target namespace remains silent and does not mutate its route, active selection, or notification state
