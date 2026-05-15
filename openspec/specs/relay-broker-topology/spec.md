# relay-broker-topology Specification

## Purpose
Defines the local and federated PiRelay broker topology for route registration, ingress ownership, peer communication, failover, and duplicate-bot safety across machines and sessions.
## Requirements
### Requirement: Machine-local broker supervisor
The system SHALL run at most one authoritative PiRelay broker per machine for a configured PiRelay state directory.

#### Scenario: First Pi session starts on a machine
- **WHEN** a Pi session starts with PiRelay enabled and no local broker is running for the configured state directory
- **THEN** the system starts one local broker and registers the session route with that broker

#### Scenario: Additional Pi sessions start on the same machine
- **WHEN** another Pi session starts on the same machine with the same PiRelay state directory
- **THEN** it connects to the existing local broker instead of starting another broker

#### Scenario: Stale broker socket exists
- **WHEN** the local broker socket or pid file exists but the broker is not alive
- **THEN** the system safely removes the stale local coordination file and starts a new broker without losing persisted bindings

### Requirement: Broker hosts all enabled messenger instances
The system SHALL let the machine-local broker own lifecycle and ingress for every enabled local messenger instance that it is allowed to operate.

#### Scenario: Multiple messenger instances are configured
- **WHEN** Telegram default, Discord personal, and Discord work messenger instances are enabled on the same machine
- **THEN** the local broker evaluates ownership and starts the eligible adapters from one broker process

#### Scenario: Session pairs to any configured messenger
- **WHEN** a local Pi session invokes `/relay connect <messenger-ref> [label]` for an enabled configured messenger instance
- **THEN** the local broker creates a pairing scoped to that messenger kind, instance id, machine id, and session route

#### Scenario: Messenger is disabled
- **WHEN** a user attempts to pair a session to a disabled messenger instance
- **THEN** the system refuses to create pairing state and reports the disabled instance through secret-safe guidance

### Requirement: Bot-scoped ingress ownership
The system SHALL ensure that each configured bot/account has no more than one active ingress owner in a broker group.

#### Scenario: Broker is the configured owner
- **WHEN** a broker starts a messenger instance whose ingress policy names that machine as owner
- **THEN** that broker starts platform polling, gateway, socket, or webhook ownership for the instance

#### Scenario: Broker is not the configured owner
- **WHEN** a broker starts with a messenger instance owned by another machine
- **THEN** it does not poll or connect to platform ingress for that bot/account and instead registers routes through the owner when federation is configured

#### Scenario: Ownership is ambiguous
- **WHEN** the same bot/account is configured on multiple machines and ownership cannot be determined safely
- **THEN** the system reports a blocking diagnostic and MUST NOT start duplicate ingress clients for that bot/account

### Requirement: Cross-machine route federation
The system SHALL support authenticated broker-to-broker route federation so one shared bot/account can route to Pi sessions on multiple machines.

#### Scenario: Non-owner broker registers local route
- **WHEN** a non-owner broker has an online paired session for a shared messenger instance
- **THEN** it registers a bounded route descriptor with the ingress owner without sending bot tokens, hidden prompts, tool internals, or full transcripts

#### Scenario: Ingress owner receives remote prompt
- **WHEN** the ingress owner receives an authorized prompt targeting a route hosted by another machine
- **THEN** it forwards a normalized delivery request to the owning broker and relays the resulting acknowledgement or failure back to the messenger

#### Scenario: Remote turn completion returns through ingress owner
- **WHEN** a remote owning broker reports completion, failure, abort, progress, full-output, image, or guided-action response for a session whose messenger ingress is owned by another broker
- **THEN** the ingress owner sends the normalized outbound response through the correct messenger adapter and preserves the originating messenger binding and platform limits

#### Scenario: Federation peer is unauthorized
- **WHEN** a broker receives a route registration, prompt delivery, notification, or action request from an unauthenticated peer
- **THEN** it rejects the request and does not expose session state or inject anything into Pi

### Requirement: Federated offline and failover behavior
The system SHALL report offline and failover states explicitly instead of silently dropping cross-machine interactions.

#### Scenario: Remote route owner is offline
- **WHEN** an authorized messenger user sends a prompt to a paired session whose owning machine is offline or disconnected from federation
- **THEN** the ingress owner reports that the target session or machine is offline and does not acknowledge successful delivery

#### Scenario: Ingress owner changes
- **WHEN** the configured ingress owner changes or an explicit failover lease is acquired
- **THEN** the new owner refreshes route registrations and ignores stale update offsets, callbacks, or action leases that belonged to the old owner

#### Scenario: Duplicate ingress is detected
- **WHEN** a messenger platform reports a conflict indicating another broker is already polling or connected as the same bot/account
- **THEN** the broker stops that adapter, records a diagnostic, and keeps local non-ingress session routing available when possible

### Requirement: Isolated shared-room broker topology
The system SHALL support an isolated multi-machine topology in which brokers do not communicate directly and each broker owns only its local sessions plus its locally configured dedicated messenger bot/app identities.

#### Scenario: Independent brokers share a messenger room through distinct bots
- **WHEN** multiple machines run PiRelay brokers with distinct bot/app tokens for the same messenger and those bots are members of one shared room
- **THEN** each broker starts only its own eligible adapter ingress, registers only local session routes, and relies on shared-room command visibility rather than broker federation for active-session coordination

#### Scenario: Shared-room mode does not imply route federation
- **WHEN** a broker is configured for shared-room machine-bot operation without broker peers or an ingress-owner policy for another machine
- **THEN** it does not attempt route registration, prompt forwarding, outbound forwarding, peer discovery, NAT traversal, or failover with other machines

#### Scenario: Shared token requires federation or refusal
- **WHEN** a broker is configured to use the same bot/account token as another unaware broker or detects platform conflict caused by another active consumer
- **THEN** the system reports that a shared bot/account requires explicit broker federation or one ingress owner and stops duplicate local ingress when safe

### Requirement: Shared-room safe silence
The system SHALL make safe silence the default behavior for non-target brokers that observe shared-room messages.

#### Scenario: Non-target broker observes prompt
- **WHEN** a broker observes an authorized shared-room message whose explicit target or active selection belongs to another machine
- **THEN** the broker does not inject the prompt, acknowledge delivery, execute controls, send typing/progress, or alter unrelated local session state

#### Scenario: Target cannot be determined
- **WHEN** a shared-room message is visible to a broker but the target machine/session cannot be determined and the message is not explicitly addressed to that broker
- **THEN** the broker remains silent rather than guessing a local route

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

### Requirement: Broker uses shared route-action safety
Broker-mediated prompt delivery, requester file delivery, image retrieval, abort, and compact actions SHALL use the same route-action safety outcomes as in-process messenger adapters.

#### Scenario: Broker prompt race reports unavailable
- **WHEN** the broker forwards an authorized prompt to a registered route and the route becomes unavailable during delivery
- **THEN** the broker responds with a safe unavailable error and does not report successful delivery to the ingress adapter

#### Scenario: Broker abort rolls back unavailable race
- **WHEN** the broker marks a route abort-requested and the route abort action reports unavailable
- **THEN** the broker clears the abort-requested state and returns an unavailable error to the requester

#### Scenario: Broker compact race is contained
- **WHEN** the broker receives a compact request for a route that becomes unavailable during compaction
- **THEN** the broker returns an unavailable error instead of allowing an uncaught rejection or claiming compaction succeeded

#### Scenario: Broker file action fails closed on unavailable workspace
- **WHEN** a broker-mediated requester file or image action cannot prove the target route workspace is available
- **THEN** the broker returns a safe unavailable error and does not fall back to stale route workspace data

### Requirement: Broker route status uses coherent probes
Broker route registration, status snapshots, and session lists SHALL preserve route unavailable state when any route-action probe detects stale or unavailable session-bound objects.

#### Scenario: Broker status detects unavailable route
- **WHEN** broker status rendering probes a route whose live context has become unavailable
- **THEN** the route is reported offline or unavailable rather than online idle or online busy

#### Scenario: Broker does not use stale model data
- **WHEN** a route model lookup fails because the route is unavailable
- **THEN** broker status does not keep the route online using stale or missing model data

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
- **AND** clears pending state by the captured progress key when authority is revoked, paused, moved, missing, or unavailable

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
