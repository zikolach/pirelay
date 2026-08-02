## Context

Pi's local `/new` command replaces the active session with a new session id and session file. PiRelay currently keys bindings and broker routes by `sessionKey = sessionId + sessionFile`, so the old route unregisters and paired messengers see an offline session even though the user often intends to continue working in the same workspace. Pi's extension API exposes `ctx.newSession()` only on command-capable contexts, while many runtime event callbacks expose only base `ExtensionContext`, so remote `/new` must be implemented through a carefully captured route action rather than by assuming every context can start sessions.

The desired UX has two related parts: authorized messenger users can request a new session remotely, and local or remote session replacement can safely carry relay control to the replacement route when it is clearly the same local workspace continuation.

## Goals / Non-Goals

**Goals:**

- Provide canonical remote `/new` semantics for authorized messenger users.
- Use typed route-action outcomes so adapters report unavailable, busy, unsupported, cancelled, and success states consistently.
- Handoff eligible bindings and active selections from old session key to new session key after local or remote `/new`.
- Avoid misleading offline notifications when a shutdown is immediately followed by a safe handoff.
- Preserve authorization, stale-action, binding-authority, and requester-scoping invariants.
- Support Telegram direct and broker paths, plus Slack/Discord command parity or explicit capability fallback.

**Non-Goals:**

- Do not create a new Pi process from a messenger when the selected Pi route is offline.
- Do not migrate bindings across unrelated workspaces, machines, users, or ambiguous sessions.
- Do not expose raw session keys, file paths, chat ids, bot tokens, prompts, or transcripts in messenger output.
- Do not make `/new` bypass busy/approval/custom-answer safeguards.
- Do not implement generic session switching, forking, or tree navigation in this change.

## Decisions

### 1. Implement remote `/new` as a route action

Add a narrow `newSession` route action to `SessionRouteActions` and shared route-action helpers. Adapters invoke this action after authorization and route resolution rather than touching Pi context directly.

Rationale: route actions centralize stale/offline/busy checks and keep adapter behavior consistent.

Alternative considered: directly call `route.actions.context.newSession()` from adapters. Rejected because route context is typed as base `ExtensionContext`, can become stale, and may not expose command-only session controls.

### 2. Capture command-capable context only where Pi provides it

The extension runtime should store a short-lived command-capable context when local command handlers run or otherwise expose a safe command execution wrapper if Pi provides one. `newSession` returns `unsupported` when no current command-capable context is available for the selected live route.

Rationale: Pi distinguishes command contexts from event contexts for safety. PiRelay should respect that boundary and fail explicitly when unsupported.

Alternative considered: type assertion from base context to command context. Rejected because it would be brittle and can throw at runtime.

### 3. Use a pending handoff window for local `/new`

On `session_shutdown`, if the route has active bindings, create an in-memory pending handoff record with old route identity, safe workspace identity, active binding summaries, active selections, and a short TTL. Delay offline lifecycle notification during that TTL. On subsequent `session_start`, if strict matching succeeds, migrate bindings and selections to the new route and send a moved notification; otherwise expire the record and send the normal offline notification.

Rationale: local `/new` emits an old shutdown before the replacement route registers. A short handoff window prevents false offline notifications without hiding real shutdowns indefinitely.

Alternative considered: always migrate by label. Rejected because labels are user-controlled and not unique enough for authorization-sensitive binding movement.

### 4. Require strict migration criteria

A handoff may occur only when all applicable criteria match:

- same local process/machine/runtime instance,
- same workspace root/cwd,
- old binding is active and not revoked,
- new route has no explicit conflicting binding,
- replacement starts within the TTL,
- old shutdown was not an explicit disconnect/revoke,
- no multiple pending candidates match the new route.

Rationale: migration mutates authorization state and must fail closed.

### 5. Mark old session state as moved/superseded

When migration succeeds, create/update bindings for the new session key and mark old bindings as moved/superseded or revoked with safe migration metadata. Active selections for the same messenger conversation/user move to the new session key. Old route buttons/actions become stale because their turn/session identifiers no longer match.

Rationale: the UI should not show duplicate old offline entries as active targets, and old actions must not affect the replacement route accidentally.

### 6. Remote `/new` owns the handoff transaction

Remote `/new` should prepare a handoff record, call `ctx.newSession()` with a `withSession` callback when possible, then sync/register the replacement route and migrate bindings in the same controlled flow. If Pi cancels the new-session operation, PiRelay reports cancellation and leaves old bindings unchanged.

Rationale: remote users need deterministic feedback and should not lose control if Pi refuses or cancels session replacement.

## Risks / Trade-offs

- **Risk: Binding hijack across sessions** → Require same workspace/runtime/machine and unambiguous pending handoff; fail closed to manual reconnect when unsure.
- **Risk: Command context unavailable** → Return explicit unsupported/capability guidance rather than throwing or pretending success.
- **Risk: Busy session replacement loses work** → Refuse while busy by default or require an explicit confirmation path; preserve existing abort/compact controls.
- **Risk: Offline notifications are delayed** → Keep TTL short and flush offline notification on expiry, runtime stop, or process shutdown.
- **Risk: Broker and direct runtime diverge** → Keep migration/state helpers shared under `extensions/relay/` and cover direct and broker parity tests.
- **Risk: Old buttons/actions remain visible in chats** → Existing turn/session action validation must reject stale actions and tests must cover post-handoff old callbacks.

## Migration Plan

- Persisted state changes must be backward-compatible: old states without moved/superseded fields remain valid.
- Existing bindings continue to work without migration until `/new` or remote new-session action is used.
- Rollback is safe: migrated bindings are ordinary active bindings on the new session key; old moved metadata can be ignored by older code except for duplicate display behavior.

## Open Questions

- Should remote `/new` require `/new confirm` when the route is busy, or should it always refuse while busy? The safer initial behavior is refuse while busy and suggest `/abort` first.
- Should migration move all active bindings for the route or only the requester binding? The recommended default is all active bindings for local `/new`, but only the requester binding for remote `/new` unless a later option explicitly requests all.
