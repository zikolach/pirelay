## Why

A live Pi session can retain an active messenger binding and an open broker socket while its route is missing from the broker's in-memory registry, causing `/sessions` to report the session offline even though local `/relay status` appears healthy. The recent Sigma incident also showed that restarting the shared broker from one session does not reliably or observably converge every other local client without manual reloads.

## What Changes

- Add bounded automatic reconciliation so connected broker clients detect and repair missing or stale registrations for every live local route.
- Make broker restart and socket recovery converge all local clients without callers manually invoking connection internals or reloading Pi extensions.
- Make broker replacement atomic under supervisor ownership so a restarting client cannot delete the pid/socket files of a replacement broker started by another reconnecting client or split clients across orphan brokers.
- Define route registration ownership and generation rules so late disconnects, duplicate clients, and restart races cannot remove a newer registration.
- Expose broker socket and route-registration health through local status and doctor surfaces without raw destination identifiers or secrets.
- Record secret-safe broker connection, reconciliation, and restart-convergence diagnostics when communication diagnostics are enabled.
- Add real multi-client recovery tests covering autonomous reconnect, missing-route repair, restart races, delayed clients, and partial failures.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `relay-broker-topology`: Require autonomous route reconciliation, multi-client restart convergence, idempotent registration ownership, and bounded recovery behavior.
- `relay-runtime-status-line`: Distinguish local binding health from broker socket and route-registration health, and surface reconnecting or unsynchronized states safely.
- `relay-communication-diagnostics`: Trace broker client connection, route reconciliation, restart generation, and convergence outcomes with bounded secret-safe metadata.

## Impact

- Broker client and process code under `extensions/relay/broker/`, especially connection supervision, route registration, client ownership, and restart behavior.
- Extension runtime status and doctor reporting under `extensions/relay/runtime/`, `extensions/relay/commands/`, and status helpers.
- Communication diagnostic event contracts and troubleshooting documentation.
- Broker namespace, integration, runtime, and multi-client process tests.
- No state schema migration, messenger API change, new dependency, or authorization relaxation is intended.
