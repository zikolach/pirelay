## ADDED Requirements

### Requirement: Broker clients autonomously reconcile live route registrations
Broker clients SHALL reconcile every live local session route with the authoritative broker after connection and at a bounded interval while routes remain live.

#### Scenario: Initial connection reconciles all client routes
- **WHEN** a broker client connects with one or more live local routes
- **THEN** it sends a bounded reconciliation snapshot for all routes it currently owns
- **AND** it does not report a route synchronized until the broker acknowledges that route for the current broker process epoch

#### Scenario: Connected client route is missing from broker memory
- **WHEN** a client socket remains connected and the client retains a live route that is absent from the broker route registry
- **THEN** periodic reconciliation restores the route without requiring `/reload`, `/relay restart`, another local command, or messenger re-pairing
- **AND** broker-backed session lists report the route online after acknowledgement

#### Scenario: Broker restarts unexpectedly
- **WHEN** a broker client loses its socket because the broker exits or its socket is recreated unexpectedly
- **THEN** the client clears synchronized route status, reconnects with bounded backoff, and reconciles every still-live route automatically
- **AND** it does not require callers or tests to invoke private connection helpers to recover

#### Scenario: Socket closes during an in-flight connection attempt
- **WHEN** a broker socket closes while the client is connecting, resynchronizing routes, or otherwise suppressing duplicate reconnect timers
- **THEN** the client records that reconnect is still required
- **AND** after the in-flight attempt settles it is either connected and reconciled or has a bounded reconnect attempt scheduled

#### Scenario: Client has no live routes
- **WHEN** a broker client has no live local routes
- **THEN** it does not run an unnecessary periodic route-reconciliation timer
- **AND** it does not keep the broker alive solely for an empty reconciliation snapshot

#### Scenario: Reconciled descriptor contains stale binding metadata
- **WHEN** a reconciliation snapshot contains binding metadata that persisted binding authority marks revoked, moved, paused, missing, or destination-mismatched
- **THEN** the broker applies binding authority before accepting protected delivery state
- **AND** reconciliation does not resurrect, retarget, unpause, or otherwise weaken the persisted authority outcome

### Requirement: Route reconciliation is atomic and ownership-safe
The broker SHALL process one client's route reconciliation snapshot atomically with respect to that client's socket ownership and SHALL reject stale ownership effects.

#### Scenario: Replacement socket takes route ownership
- **WHEN** a replacement socket reconciles a route previously owned by an older socket for the same live client/session
- **THEN** the broker assigns the route to the replacement socket
- **AND** a later unregister, stale snapshot, or disconnect from the older socket does not remove the replacement registration

#### Scenario: Client removes a route from its snapshot
- **WHEN** a connected client reconciles a snapshot that no longer contains a route previously owned by that same socket
- **THEN** the broker removes that socket's stale route registration
- **AND** it does not remove an equivalent route currently owned by another socket

#### Scenario: Broker process epoch changes
- **WHEN** a client receives a reconciliation response from a new broker process epoch
- **THEN** it discards synchronization acknowledgements from the previous epoch
- **AND** it requires current-epoch acknowledgement before presenting its routes as synchronized

#### Scenario: Reconciliation request is oversized or malformed
- **WHEN** a client sends a reconciliation snapshot exceeding configured route-count or payload bounds or containing invalid route descriptors
- **THEN** the broker rejects the invalid request with a secret-safe error
- **AND** it does not partially mutate route ownership or persisted binding state

#### Scenario: Reconciliation repeatedly fails
- **WHEN** broker connection or reconciliation attempts repeatedly fail
- **THEN** the client retries with bounded backoff and jitter rather than a tight loop
- **AND** local Pi operation continues while broker-backed remote actions remain conservatively unavailable

### Requirement: Intentional broker restart converges active local clients
An intentional restart of a shared machine-local broker SHALL coordinate bounded reconnection and route reconciliation for active clients in the same broker scope.

#### Scenario: One session restarts a broker shared by multiple sessions
- **WHEN** a local session invokes `/relay restart` while multiple live Pi clients share that broker scope
- **THEN** the old broker provides a bounded non-secret restart snapshot and notifies connected clients that restart is beginning
- **AND** clients retain their local route maps, clear old synchronization state, and reconnect to the replacement broker automatically

#### Scenario: All clients recover after restart
- **WHEN** all previously connected clients remain alive and can reach the replacement broker
- **THEN** each client reconciles its routes without manual `/reload` or unrelated local commands
- **AND** the replacement broker reports convergence with every recovered route present in broker-backed session lists

#### Scenario: One client reconnects late
- **WHEN** one live client reconnects after other clients have already registered with the replacement broker
- **THEN** its late reconciliation adds its routes without replacing or removing routes owned by earlier clients
- **AND** convergence health updates when the late client is acknowledged

#### Scenario: Restart convergence times out partially
- **WHEN** one or more expected clients do not reconnect before the bounded convergence timeout
- **THEN** the replacement broker remains available for clients that did recover
- **AND** `/relay restart` reports a safe partial-convergence warning with counts and repair guidance
- **AND** missing clients and routes remain offline rather than being synthesized from persisted bindings

#### Scenario: Concurrent restart requests occur
- **WHEN** two clients request restart for the same broker scope concurrently
- **THEN** broker supervision serializes the restart lifecycle
- **AND** at most one replacement broker becomes authoritative
- **AND** both callers receive a consistent success, in-progress, or safe failure outcome without deleting the live replacement socket

#### Scenario: Reconnecting client starts replacement during restart cleanup
- **WHEN** one client is waiting for the selected old broker PID to exit and another reconnecting client starts or discovers a replacement broker for the same scope
- **THEN** restart cleanup verifies the authoritative PID and broker epoch under the supervisor lock before deleting control files
- **AND** it joins the valid replacement instead of deleting its socket or pid file or spawning a competing broker

#### Scenario: Caller is connected to a superseded broker
- **WHEN** a client connected to an orphaned or superseded broker requests restart while authoritative control state names a different live broker
- **THEN** the client does not kill the different authoritative broker based only on the shared scope paths
- **AND** it disconnects from the superseded process and converges on the authoritative broker safely

#### Scenario: Restart leaves no orphan broker
- **WHEN** intentional restart completes or reports partial convergence
- **THEN** exactly one live broker owns the authoritative pid/socket files for the broker scope
- **AND** no displaced broker continues messenger ingress or retains reachable route ownership for that scope
