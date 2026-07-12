## Context

PiRelay's intended topology is one authoritative broker per machine-local broker scope, with multiple Pi sessions acting as broker clients. In practice, broker startup is currently owned by `BrokerTunnelRuntime`, so two sessions that start at the same time can both observe an unavailable socket and both spawn brokers for the same bot/state namespace. This creates split-brain route state: each broker may know a different live route, while Telegram only interacts with the active ingress owner.

The session list also exposes every persisted binding as a peer choice. When users frequently start new Pi sessions in the same project folder, older bindings remain visible as offline rows even though a newer online session from that same workspace has replaced them for practical routing. The Telegram session menu currently spends button space on `Recent N` and `Offline N` actions, which makes stale rows easier to tap but not easier to clean up.

## Goals / Non-Goals

**Goals:**

- Make the broker singleton model explicit and enforce it through a supervisor-level contract.
- Prevent same-scope broker split-brain during concurrent startup, stale socket/pid recovery, and reconnect.
- Ensure all same-machine Pi sessions register routes with the same broker for the same `{stateDir, bot token hash, brokerNamespace}` scope.
- Reduce stale session-list clutter by identifying older offline sessions from the same machine/workspace as superseded by a newer session.
- Make `/sessions` buttons actionable: use/switch active online sessions, target prompts where practical, and forget stale offline entries.
- Keep `/recent` available as an explicit command for safe activity inspection without making it a default per-row button.

**Non-Goals:**

- Do not change pairing authorization, single-use pairing, or binding revocation semantics.
- Do not delete historical session transcript files.
- Do not automatically revoke active bindings merely because a newer session exists; stale handling is a presentation/cleanup policy unless the user explicitly forgets a binding.
- Do not introduce cross-machine federation in this change.
- Do not remove the `/recent` or `/activity` command aliases.

## Decisions

### 1. Broker ownership belongs in the supervisor

`BrokerTunnelRuntime` should not independently decide how to recover or spawn the broker. It should ask a broker supervisor to ensure the local broker for a scope exists, then connect and register routes.

Scope key:

```text
stateDir + bot token hash + normalized brokerNamespace
```

The supervisor owns:

- control path derivation for socket, pid, and lock files;
- an inter-process startup lock;
- stale pid/socket cleanup;
- spawn decision;
- post-spawn socket readiness probing.

`BrokerTunnelRuntime` owns:

- socket protocol;
- route serialization;
- route re-registration after reconnect;
- bridging broker requests to live Pi route actions.

Alternative considered: keep the lock in `BrokerTunnelRuntime`. This is simpler but keeps ownership policy split across runtime and supervisor, making the architecture harder to reason about. Moving it into the supervisor aligns code with the documented topology.

### 2. Route registration is the source of online state

Persisted bindings prove a messenger conversation has been paired before; they do not prove a Pi session is currently online. A route is online only when the active broker has a live client route registration for that session key.

When a broker restarts or the socket is recreated, clients must reconnect and re-register all local routes held by that runtime. If a client reconnects to a broker with stale persisted binding authority, the broker still applies binding-authority checks before delivery.

### 3. Same-workspace older offline sessions are superseded by default

A session-list entry should carry enough safe identity to group same-machine same-workspace sessions. Existing route state already includes session file/session label; implementation should derive a non-secret workspace key from available route metadata, preferably a normalized project/workspace path when available, falling back to session label only when no safe path is available.

Default `/sessions` behavior:

- Show online sessions.
- Show offline sessions that have no newer online sibling for the same machine/workspace.
- Hide or label as superseded older offline sessions when a newer online sibling exists.
- Provide an explicit way to reveal all entries for cleanup/diagnostics.

Superseded entries remain forgettable and must not be used for prompt routing while offline.

Alternative considered: automatically revoke/delete older bindings immediately. That is too destructive and could remove useful historical bindings if the newer session was temporary or misidentified. Presentation-first supersession is safer.

### 4. Session buttons should reflect useful next actions

Telegram session-list buttons should no longer emit `Recent N` for every row by default. Suggested row actions:

- current online session: `Status` or compact active indicator; optionally context-specific controls when busy;
- online non-current session: `Use N` and/or `To N` where platform constraints allow;
- offline/superseded session: `Forget N` as the primary action;
- busy active session: prioritize `Steer`, `Follow-up`, and `Abort` if exposed in the session dashboard.

`/recent` remains a text command and can still be reachable from a detailed status/dashboard view later.

### 5. Keep cleanup explicit and reversible where possible

Hiding superseded sessions should be deterministic and testable, but forgetting remains an explicit user action. A user should be able to inspect all sessions before deleting stale entries.

## Risks / Trade-offs

- **Risk: workspace grouping hides a session the user still cares about** → Mitigate by hiding only older offline siblings when a newer online sibling for the same machine/workspace exists, and provide an all-sessions view.
- **Risk: path-derived workspace identity leaks local paths into messenger UI** → Mitigate by using path only for grouping/diagnostics and continuing to display labels/aliases, not raw paths.
- **Risk: supervisor locking deadlocks after a crash** → Mitigate with stale lock timeouts and conservative retries, matching existing state-lock patterns.
- **Risk: reconnect storms after broker restart** → Mitigate with existing reconnect backoff and route re-registration idempotency.
- **Risk: button layout differs across messengers** → Mitigate by specifying action semantics separately from platform-specific rendering; adapters may choose equivalent affordances.

## Migration Plan

1. Introduce supervisor-owned broker scope/control-path helpers while preserving existing default socket/pid names for compatibility where possible.
2. Move startup serialization from runtime-level ad-hoc logic to the supervisor.
3. Keep existing persisted binding schema readable; add optional non-secret metadata only if needed for workspace grouping.
4. Update session-list rendering to hide/mark superseded entries by default without deleting state.
5. Update Telegram buttons and cross-adapter tests.
6. Document `/sessions --all` or equivalent reveal behavior and keep `/forget` as the cleanup operation.

Rollback strategy: disable superseded filtering and fall back to existing full session list; broker supervisor changes should be backward-compatible with existing pid/socket files and can reuse stale cleanup if needed.

## Open Questions

- Should the all-sessions reveal command be `/sessions --all`, `/sessions all`, or a platform button from the session list?
- Should workspace grouping use full normalized cwd, repo root, session directory naming, or a stored workspace id from Pi runtime when available?
- Should superseded offline entries be visually marked in all-sessions output, or only hidden by default?
- Should `Forget all stale` be offered, or is one-by-one explicit cleanup safer for the first iteration?
