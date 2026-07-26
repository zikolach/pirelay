## Context

PiRelay keeps live session routes only in the machine-local broker's memory. Each `BrokerTunnelRuntime` also keeps its own live `SessionRoute` objects and re-registers them when it connects. Existing recovery tests prove that `resyncRoutes()` works when tests explicitly reconnect clients, but they do not exercise autonomous recovery after a real shared-broker restart or the case where a client socket remains connected while the broker no longer has the corresponding route.

During the Sigma incident, the Pi process was alive and idle, persisted Telegram authority was active, and a Unix client socket was open, yet the broker session list reported Sigma offline. Restarting the shared broker also showed that clients converged at different times and one session needed an extension reload/status interaction before all three routes were present again. Local `/relay status` could not expose the mismatch because it reported only local route and binding state.

Investigation also found a concrete restart race. `restartBrokerProcess()` kills the PID read from shared control state and then unconditionally unlinks the shared pid/socket files outside the supervisor lock. During that wait, another disconnected client can acquire supervision and start a replacement broker; the restarting client can then delete the replacement broker's control files and start another process. Clients may split between an unreachable orphan broker and the broker named by the new pid/socket files. Reconnect scheduling can also be skipped when a socket closes while `connecting` is set, without an unconditional retry after that connection attempt settles.

The design must preserve authorization-before-side-effect rules, persisted binding authority, one broker per scope, current namespace isolation, and bounded secret-safe state. It must not persist live route actions or full route descriptors because those contain process-local behavior and become stale across process lifetimes.

## Goals / Non-Goals

**Goals:**

- Repair a missing broker registration automatically while the owning Pi session remains live.
- Make autonomous multi-client recovery after broker restart an exercised lifecycle, not a path that requires callers to invoke private connection helpers.
- Keep route ownership idempotent when old and replacement sockets overlap or disconnect out of order.
- Make local status and doctor output distinguish binding, transport, and broker-registration health.
- Produce enough opt-in, secret-safe evidence to diagnose registration loss and convergence failures.
- Bound retry rate, timers, payloads, and recovery time without weakening binding authority.

**Non-Goals:**

- Persisting executable route actions or reconstructing a live Pi route after the Pi process exits.
- Treating an active persisted binding as proof that a session is online.
- Starting an offline Pi process from the broker.
- Changing cross-machine federation, messenger authorization, pairing, or route selection semantics.
- Adding a new dependency or requiring a state-schema migration.

## Decisions

### 1. Add an idempotent client route-reconciliation request

Each connected broker client will periodically send one bounded reconciliation request containing its `clientId` and serialized descriptors for its current live route map. The broker will atomically upsert those routes for the requesting socket, remove only registrations still owned by that same socket that are no longer in the client's declared set, and return a broker epoch plus the accepted route keys.

The client will consider a route synchronized only after its key is acknowledged for the current broker epoch. Missing acknowledgements cause safe local unsynchronized state and a bounded retry; they do not cause prompt delivery, binding mutation, or optimistic online reporting.

Reconciliation will run:

- immediately after the socket connects,
- after a broker epoch change or reconnect,
- after local route add/remove or material route-state changes through the existing publish path,
- periodically with an unref'ed, jittered interval while live routes exist.

The broker will continue applying persisted binding authority to every reconciled descriptor before storing or using its binding.

**Alternative considered:** Send only a lightweight `hasRoute` heartbeat. Rejected because recovering a missing route would require a second protocol round trip and separate race handling, while the existing serialized route descriptor is already bounded and registration is idempotent.

**Alternative considered:** Persist live route descriptors in `state.json`. Rejected because route actions and availability belong to a live client process; persisted online descriptors would create zombie routes and stale action authority.

### 2. Use broker epochs and socket ownership for stale-event safety

A broker process will generate a non-secret random epoch at startup. Reconciliation responses and client synchronization state are scoped to that epoch. A client clears synchronized status when its socket closes or an epoch changes.

The broker route owner remains the concrete client socket. A replacement socket may take ownership by reconciling the same route. Later unregister or disconnect events from an older socket MUST NOT remove the replacement registration. Atomic reconciliation removes only routes whose current owner is the requesting socket.

**Alternative considered:** Use timestamps to choose the newest registration. Rejected because clock order is unnecessary on one host and socket ownership provides a stronger causal boundary.

### 3. Make broker replacement atomic before coordinating convergence

Before an intentional restart, the initiating client will request a bounded restart snapshot from the old broker. The broker will return a non-secret expected connected-client count and notify connected clients that the broker is restarting. Clients retain their local route maps, clear current synchronization, and enter reconnecting state immediately.

Kill, cleanup, and replacement startup will execute under the broker-scope supervisor lock. Cleanup will be conditional: the client may remove control files only when they still identify the broker PID/epoch selected for replacement. If another reconnecting client has already installed a live replacement broker, the restart path will join that broker instead of deleting its socket/pid files or spawning a competitor. A caller connected to an orphan or superseded broker will never kill the different live broker currently named by authoritative control state merely because both share a scope.

The initiating client will stop the old broker, start or connect to the replacement, reconcile its routes, and wait for a bounded convergence result from broker health: expected client count, connected client count, and registered route count. Success requires the initiating route to be acknowledged and all still-running clients to have had an opportunity to reconnect; timeout reports partial convergence without marking missing routes online.

Unexpected broker death follows the same autonomous reconnect and periodic reconciliation path but has no prior expected-client snapshot. Socket closure during an in-flight connection or resynchronization attempt will set a deferred reconnect requirement; after `connecting` settles, the client MUST either be connected and synchronized or have a bounded retry scheduled.

The local restart message will state that the broker is shared across local sessions and report safe convergence counts or a partial-recovery warning.

**Alternative considered:** Restart each messenger runtime or force `/reload` in every Pi session. Rejected because a broker restart must not require user coordination across sessions and extension reloads invalidate unrelated contexts.

**Alternative considered:** Unconditionally remove the known socket and pid paths after the selected PID exits. Rejected because those paths are scope-owned mutable coordination state and may already belong to a replacement broker started by another client.

### 4. Track three separate health dimensions locally

The runtime will maintain bounded broker health state:

1. local binding authority (`active`, `paused`, `revoked`, or absent),
2. broker transport (`connected`, `reconnecting`, or unavailable),
3. route registration (`synchronized`, `pending`, `missing/rejected`, or unknown) for the current broker epoch.

`/relay status`, `/relay doctor`, and concise status-line rendering will use these dimensions. An active local binding with a missing broker route will never be described simply as connected. Doctor may trigger the same idempotent reconciliation request and report whether repair succeeded; it will not synthesize a route if the runtime has no live local route.

Raw session keys, session files, socket paths, chat/user ids, tokens, and route payloads remain excluded from normal status UX.

### 5. Extend opt-in communication diagnostics

When communication diagnostics are enabled, clients and broker will record metadata-only events for connection open/close, broker epoch change, reconciliation request/ack/rejection, missing-route repair, intentional restart notice, convergence success/timeout, and retry scheduling. Fields are bounded to safe counts, outcomes, namespace labels, hashed or existing safe correlation identifiers, and durations.

Diagnostics remain disabled by default and MUST NOT contain serialized route payloads, prompt/output content, messenger secrets, pairing data, or raw destination ids.

### 6. Test real autonomous lifecycle sequences

Tests will use real socket close/recreation and public runtime methods/timers rather than manually invoking private `ensureConnected()` as the recovery mechanism under test. Fake timers or configurable short intervals will keep periodic reconciliation deterministic.

A multi-client integration sequence will cover:

```text
broker epoch A: routes A, B, C
        │ intentional or unexpected restart
        ▼
broker epoch B: clients reconnect independently
        │ reconciliation acknowledgements
        ▼
routes A, B, C online without /reload or local commands
```

Separate tests will delete or omit one broker route while leaving its socket connected, then assert that periodic reconciliation restores it and session lists become online again.

## Risks / Trade-offs

- **[Periodic reconciliation increases local IPC and state checks]** → Use one bounded batch per client, jittered intervals, no timer when no routes exist, and idempotent broker handling.
- **[A malicious or buggy client repeatedly overwrites a route]** → Scope ownership to the socket/client, retain persisted binding authority, bound payload size/count, and preserve replacement-socket stale-disconnect checks.
- **[Restart convergence waits for a client that exited concurrently]** → Bound the wait and report partial convergence; do not block the replacement broker or claim missing clients are online.
- **[A reconnecting client starts a broker during intentional cleanup]** → Hold the supervisor lock across ownership verification and cleanup; compare PID/epoch before deletion and join any already-authoritative replacement.
- **[A close event occurs while connection setup suppresses reconnect scheduling]** → Persist a reconnect-needed flag and enforce the post-connection invariant that a started client is connected or has a retry timer.
- **[Status can become stale between acknowledgements]** → Clear synchronized state immediately on socket close/epoch change and display unknown/reconnecting conservatively.
- **[Reconciliation races with session replacement or disconnect]** → Serialize against local route-map mutations, snapshot descriptors per request, and ensure a later snapshot removes only routes still owned by that client socket.
- **[Always-on observability could expose identifiers]** → Keep detailed records within the existing opt-in diagnostics capability and expose only safe categorical health in normal UX.

## Migration Plan

1. Add protocol types and broker epoch/reconciliation handling while preserving existing `registerRoute`/`unregisterRoute` compatibility during the change.
2. Move client startup and reconnect resync onto the reconciliation primitive.
3. Add periodic reconciliation and health-state tracking.
4. Add coordinated restart snapshot/notice/convergence reporting.
5. Update local status, doctor, status-line copy, diagnostics, and documentation.
6. Remove redundant one-off resync code only after direct, reconnect, and restart paths share tested reconciliation behavior.

Rollback is code-only: older clients continue using existing registration requests, and no persisted state migration is required. New clients must treat a broker that lacks reconciliation support as an explicit unsupported/legacy condition and fall back to existing reconnect registration without reporting enhanced convergence guarantees.

## Open Questions

- Choose the final default reconciliation interval and restart convergence timeout from tests and local IPC measurements; initial targets are 15–30 seconds and 10 seconds respectively.
- Decide whether normal status-line space permits a distinct `syncing` glyph or whether detailed broker health remains in `/relay status` and `/relay doctor` while the status line shows only a warning state.
