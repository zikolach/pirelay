## MODIFIED Requirements

### Requirement: Machine-local broker supervisor
The system SHALL run at most one authoritative PiRelay broker per machine for a configured broker scope consisting of the PiRelay state directory, bot/account token hash, and optional broker namespace.

#### Scenario: First Pi session starts on a machine
- **WHEN** a Pi session starts with PiRelay enabled and no local broker is running for the configured broker scope
- **THEN** the system starts one local broker and registers the session route with that broker

#### Scenario: Additional Pi sessions start on the same machine
- **WHEN** another Pi session starts on the same machine with the same broker scope
- **THEN** it connects to the existing local broker instead of starting another broker

#### Scenario: Concurrent Pi sessions start on the same machine
- **WHEN** two or more Pi sessions with the same broker scope attempt to start PiRelay while the local broker socket is not ready
- **THEN** broker startup is serialized with an inter-process supervisor lock
- **AND** only one broker process is spawned for that broker scope
- **AND** all sessions connect to that broker and register their routes there

#### Scenario: Stale broker socket exists
- **WHEN** the local broker socket or pid file exists but the broker is not alive
- **THEN** the system safely removes the stale local coordination file and starts a new broker without losing persisted bindings

#### Scenario: Live pid exists while socket is not ready
- **WHEN** a broker pid for the configured broker scope is live but the socket is not yet accepting connections
- **THEN** later Pi sessions wait for the socket to become ready instead of spawning a competing broker
- **AND** startup failure is reported as a secret-safe diagnostic if readiness times out

## ADDED Requirements

### Requirement: Broker clients re-register routes after broker recovery
Broker clients SHALL re-register every live local session route after connecting or reconnecting to the authoritative broker for their broker scope.

#### Scenario: Broker socket is recreated
- **WHEN** a Pi session has an in-memory route and reconnects after the broker socket is recreated
- **THEN** the client re-registers that route with the broker before reporting the route as synchronized

#### Scenario: Multiple clients reconnect to the same recovered broker
- **WHEN** multiple Pi sessions reconnect after a broker restart or socket recovery
- **THEN** each client registers its own route with the same authoritative broker
- **AND** the broker session list contains all online routes from those clients

#### Scenario: Re-registration contains stale binding metadata
- **WHEN** a reconnecting client re-registers a route whose binding metadata is stale relative to persisted binding authority
- **THEN** the broker applies binding authority before delivery or persisted binding updates
- **AND** stale metadata does not resurrect revoked or moved bindings

### Requirement: Broker scope diagnostics are secret-safe
Broker startup, recovery, and singleton diagnostics SHALL identify the broker scope without exposing tokens, pairing codes, hidden prompts, tool internals, or transcripts.

#### Scenario: Duplicate startup is prevented
- **WHEN** the supervisor prevents a concurrent broker startup for an existing scope
- **THEN** diagnostics may report the state directory category, non-secret namespace, and token hash prefix
- **AND** diagnostics MUST NOT print the bot/account token or full persisted state

#### Scenario: Stale coordination files are cleaned
- **WHEN** stale pid, socket, or lock files are removed
- **THEN** diagnostics describe the cleanup using secret-safe path categories and broker scope labels
- **AND** persisted bindings remain intact
