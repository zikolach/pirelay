## ADDED Requirements

### Requirement: Broker reconciliation and restart convergence are diagnosable
PiRelay SHALL record bounded secret-safe broker client reconciliation and restart-convergence events when communication diagnostics are explicitly enabled.

#### Scenario: Client connection lifecycle is traced
- **WHEN** a broker client connects, disconnects, begins reconnecting, observes a broker epoch change, or exhausts a retry interval
- **THEN** diagnostics record the event kind, outcome, bounded attempt/delay metadata, component, and safe broker-scope correlation
- **AND** they do not include socket paths, tokens, raw route descriptors, prompts, outputs, or destination ids

#### Scenario: Route reconciliation is traced
- **WHEN** a client sends a reconciliation snapshot and the broker accepts, partially accepts, or rejects it
- **THEN** diagnostics record bounded route counts, acknowledgement counts, duration, trigger category, and outcome
- **AND** a missing-route repair is distinguishable from initial registration and ordinary route-state publication

#### Scenario: Intentional restart convergence is traced
- **WHEN** `/relay restart` snapshots connected clients, notifies them, starts a replacement broker, and waits for recovery
- **THEN** diagnostics record restart phase, old/new epoch transition category, expected client count, recovered client and route counts, duration, and success or timeout outcome
- **AND** diagnostics remain bounded if multiple clients reconnect concurrently

#### Scenario: Reconciliation is suppressed safely
- **WHEN** reconciliation does not run because the client is stopped, has no live routes, lacks a socket, is backing off, or has stale binding authority
- **THEN** diagnostics may record a deduplicated suppression category useful for troubleshooting
- **AND** they do not repeatedly emit unbounded records for the same timer condition

#### Scenario: Doctor reports diagnostic correlation
- **WHEN** `/relay doctor` detects or repairs an unsynchronized route while communication diagnostics are enabled
- **THEN** it reports a safe event time or correlation label that helps locate the relevant diagnostic records
- **AND** it does not print raw diagnostic records or upload logs automatically
