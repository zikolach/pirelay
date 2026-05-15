## ADDED Requirements

### Requirement: Broker uses binding authority for route registration and delivery
The broker SHALL treat persisted binding authority as authoritative for route registration, resync, session listing, progress/activity timers, and outbound delivery.

#### Scenario: Stale route registration cannot resurrect revoked binding
- **WHEN** a client registers or re-registers a route descriptor containing a Telegram binding and persisted broker state marks that session binding revoked
- **THEN** the broker keeps the route online without that binding authority
- **AND** it does not upsert the stale binding as active or select it for future delivery

#### Scenario: Stale route registration cannot move delivery without authority
- **WHEN** a client registers a route descriptor whose binding destination differs from an existing persisted binding for the same session
- **THEN** the broker classifies the old route destination as moved or stale through binding authority
- **AND** it avoids sending to the stale destination unless a fresh authorized pairing updates persisted state

#### Scenario: Broker delivery checks authority immediately before sending
- **WHEN** the broker is about to send terminal output, progress, activity, callbacks, full-output content, image content, requester files, or lifecycle notifications
- **THEN** it resolves the route's expected binding through binding authority
- **AND** sends only when the authority outcome permits that protected side effect

### Requirement: Broker state lookup is snapshot-based per operation
The broker SHALL avoid repeated state-file reads for one logical route-selection or delivery operation.

#### Scenario: Sessions lookup reads state once
- **WHEN** the broker handles a `/sessions`, prompt routing, active-session resolution, or equivalent route lookup for a messenger conversation
- **THEN** it loads broker state once for that operation
- **AND** filters all candidate live and persisted routes against that snapshot

#### Scenario: Progress flush reads state once for authority
- **WHEN** a broker progress flush timer fires for a session and destination
- **THEN** the broker loads state at most once for the flush authority decision
- **AND** clears pending state by the captured progress key when authority is revoked, paused, moved, missing, or state-unavailable

#### Scenario: State unavailable blocks broker protected delivery
- **WHEN** the broker cannot read or parse the state file while evaluating protected delivery or route registration authority
- **THEN** it does not use in-memory route bindings to send protected content or resurrect bindings
- **AND** it reports only secret-safe diagnostics while keeping unrelated safe broker behavior available when possible

### Requirement: Broker deferred state uses captured destination keys
The broker SHALL key deferred progress and activity state by the destination captured when the work is scheduled rather than by mutable route binding state.

#### Scenario: Broker clears progress by scheduled key
- **WHEN** broker progress state exists for `session + chat` and the route's binding is later cleared or revoked
- **THEN** the broker clears the progress state by the scheduled key
- **AND** no pending progress entry remains because a route-derived key became unavailable

#### Scenario: Broker activity refresh does not retarget after re-pair
- **WHEN** broker activity refresh was scheduled for one chat and the session is re-paired to another chat before refresh
- **THEN** the refresh validates authority for the original chat
- **AND** does not send activity to the new chat as a side effect of the old timer
