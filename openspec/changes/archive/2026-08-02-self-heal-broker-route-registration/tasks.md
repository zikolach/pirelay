## 1. Reconciliation Protocol and Domain Model

- [x] 1.1 Define typed broker epoch, route-reconciliation request/response, accepted-route, and broker-health contracts with bounded route counts and payload sizes.
- [x] 1.2 Add pure validation and normalization helpers for reconciliation snapshots and secret-safe rejection outcomes.
- [x] 1.3 Define client-side transport and per-route synchronization states scoped to a broker epoch.
- [x] 1.4 Add unit tests for valid, malformed, oversized, duplicate, and stale-epoch reconciliation payloads.

## 2. Broker Route Reconciliation

- [x] 2.1 Generate a non-secret broker epoch for each broker process lifetime and expose it only through local client protocol responses and diagnostics.
- [x] 2.2 Implement atomic reconciliation that upserts the requesting socket's declared routes after binding-authority validation.
- [x] 2.3 Remove omitted routes only when they are still owned by the requesting socket, preserving replacement-socket registrations.
- [x] 2.4 Return acknowledged and rejected route outcomes without raw route descriptors, destinations, prompts, outputs, or secrets.
- [x] 2.5 Add broker tests for missing-route restoration, stale binding stripping, omitted-route removal, malformed snapshot rollback, and replacement-socket ownership races.

## 3. Autonomous Broker Client Recovery

- [x] 3.1 Replace one-off reconnect resync with a shared reconciliation operation over the client's current live route map.
- [x] 3.2 Reconcile immediately after initial connection, reconnect, broker epoch change, and local route-map mutation.
- [x] 3.3 Add an unref'ed jittered periodic reconciliation timer that runs only while the client is started with live routes.
- [x] 3.4 Clear current-epoch synchronization immediately on socket close, broker epoch change, route removal, or reconciliation rejection.
- [x] 3.5 Persist reconnect-needed state when close occurs during `connecting`, and enforce that every started client is connected or has a bounded retry scheduled after the attempt settles.
- [x] 3.6 Retry connection and reconciliation failures with bounded backoff while preserving local Pi operation and conservative offline routing.
- [x] 3.7 Ensure stop, explicit disconnect, session replacement, and runtime reload cancel timers and cannot re-register removed routes.
- [x] 3.8 Add client unit tests for timer lifecycle, autonomous reconnect, epoch reset, delayed acknowledgement, overlapping close/connect, backoff, and stop/remove races.

## 4. Shared Broker Restart Convergence

- [x] 4.1 Add an intentional-restart preparation request that captures bounded expected client/route counts and notifies connected clients without persisting live descriptors.
- [x] 4.2 Make notified clients retain live route maps, clear synchronization, and enter autonomous reconnect before the old socket closes.
- [x] 4.3 Move broker kill, ownership verification, control-file cleanup, and replacement startup under broker-scope supervisor serialization.
- [x] 4.4 Make pid/socket cleanup compare the selected old PID/epoch with current authoritative control state and join any replacement already started by another client.
- [x] 4.5 Prevent a client connected to a superseded broker from killing the different live broker named by authoritative scope state.
- [x] 4.6 Reconcile the initiating client's routes and poll bounded broker health for expected client/route convergence.
- [x] 4.7 Return explicit complete, partial-timeout, in-progress, and failed restart outcomes while keeping recovered routes available.
- [x] 4.8 Update `/relay restart` copy to explain shared-machine impact and report secret-safe convergence counts and repair guidance.
- [x] 4.9 Add multi-client process tests for complete recovery, reconnect-during-cleanup, delayed/exited clients, concurrent restart callers, no orphan brokers, and no-manual-reload behavior.

## 5. Broker-Aware Status and Repair

- [x] 5.1 Track local binding authority, broker transport, broker epoch, and per-route synchronization as separate runtime health fields.
- [x] 5.2 Extend `/relay status` with safe connected, reconnecting, synchronized, pending, missing/rejected, and unknown broker-route states.
- [x] 5.3 Update concise Telegram, Discord, and Slack status-line rendering so an active binding with an unsynchronized route does not appear fully connected.
- [x] 5.4 Extend `/relay doctor` to detect active-binding/missing-route mismatches and invoke idempotent reconciliation only for a proven live local route.
- [x] 5.5 Refresh status through the latest matching live extension context after reconciliation success, failure, disconnect, or epoch change.
- [x] 5.6 Add status and doctor tests for healthy, missing, reconnecting, repaired, stale-context, no-live-route, and secret-redaction outcomes.

## 6. Communication Diagnostics and Documentation

- [x] 6.1 Add opt-in metadata-only events for broker connect/disconnect, epoch changes, reconciliation triggers, acknowledgements, rejection, repair, and retry scheduling.
- [x] 6.2 Add restart-phase and convergence diagnostics with bounded expected/recovered counts, durations, outcomes, and safe broker-scope correlation.
- [x] 6.3 Deduplicate periodic suppression/failure diagnostics so reconciliation timers cannot create unbounded diagnostic noise.
- [x] 6.4 Update broker troubleshooting documentation with the active-binding/missing-route symptom, status interpretation, automatic recovery, and safe diagnostics workflow.
- [x] 6.5 Update README and testing guidance for shared restart behavior and expected autonomous multi-session convergence.

## 7. End-to-End Regression Coverage

- [x] 7.1 Add a real-socket regression that removes a broker route while its client socket remains connected and verifies periodic reconciliation restores online session listing.
- [x] 7.2 Add a three-client broker restart regression that races autonomous reconnect against restart cleanup, relies only on public runtime behavior, and verifies one authoritative broker plus every route without `/reload`, `/relay status`, or private `ensureConnected()` calls.
- [x] 7.3 Cover identifiers present and missing, repeated reconciliation, partial and delayed acknowledgements, stale disconnects, authorization denial, binding revocation, and state-unavailable behavior.
- [x] 7.4 Verify reconciliation and restart recovery do not duplicate prompt injection, completion delivery, progress timers, approvals, lifecycle notifications, or messenger ingress ownership.
- [x] 7.5 Run a structured pre-review focused on broker lifecycle, authorization, stale ownership, bounded timers, adapter parity, diagnostics, and restart failure modes.

## 8. Validation

- [x] 8.1 Run `npm run typecheck`.
- [x] 8.2 Run `npm test`.
- [x] 8.3 Run `openspec validate self-heal-broker-route-registration --strict`.
