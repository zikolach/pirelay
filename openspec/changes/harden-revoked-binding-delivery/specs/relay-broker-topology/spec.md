## ADDED Requirements

### Requirement: Broker treats persisted revocation as authoritative
The machine-local broker and broker clients SHALL treat persisted revoked binding state as authoritative over stale in-memory route descriptors, route registrations, route resyncs, and cached recent binding records.

#### Scenario: Stale route registration contains revoked Telegram binding
- **WHEN** a broker receives `registerRoute` for a session whose route descriptor contains a Telegram binding that persisted state marks as revoked
- **THEN** the broker keeps the session route online without reactivating that Telegram binding
- **AND** it does not upsert the stale binding as active in persisted state

#### Scenario: Route resync after reconnect contains revoked binding
- **WHEN** a Pi client reconnects to the broker and resyncs routes after a remote disconnect revoked a messenger binding
- **THEN** the broker rejects or strips the stale binding portion of that route registration
- **AND** future route state reflects the adapter as ready/unpaired for the revoked messenger conversation

#### Scenario: Recent binding cache is stale
- **WHEN** a runtime has a recent binding cache entry for a channel binding that persisted state now marks revoked
- **THEN** outbound completion, progress, file/image delivery, lifecycle delivery, and action responses do not use the cached entry
- **AND** the cache is cleared or ignored for that session and conversation

#### Scenario: Active selection points at revoked binding
- **WHEN** broker active-selection state points a chat/user or conversation at a session binding that has been revoked
- **THEN** PiRelay clears or ignores that active selection for protected session actions
- **AND** it does not use the stale selection to route prompts, controls, or output retrieval to the revoked binding

### Requirement: Outbound broker delivery re-checks active binding state
Broker-mediated outbound delivery SHALL re-check that the destination binding is active and matches the intended conversation immediately before sending protected session feedback.

#### Scenario: Completion races with disconnect
- **WHEN** a session completion notification is queued while a remote disconnect revokes the destination binding
- **THEN** the broker skips delivery to the revoked conversation if revocation is visible before the messenger API call
- **AND** it does not retry through a stale route binding or fallback chat id

#### Scenario: Progress timer fires after disconnect
- **WHEN** a progress/activity timer fires after a messenger binding is revoked
- **THEN** the broker stops the timer for that binding and sends no further progress or activity to the revoked conversation

#### Scenario: Outbound delivery uses wrong conversation
- **WHEN** an outbound payload is about to be sent and persisted state no longer matches the route's conversation id, user id, channel, or instance id
- **THEN** PiRelay refuses that outbound delivery for the stale target
- **AND** it does not substitute another active binding unless the outbound action was explicitly scoped to that other binding
