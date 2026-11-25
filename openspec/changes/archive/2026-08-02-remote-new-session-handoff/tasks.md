## 1. Route Action and Command Context

- [x] 1.1 Add typed new-session route-action outcome types for success, unavailable, busy, unsupported, cancelled, and failure.
- [x] 1.2 Extend `SessionRouteActions` with a narrow `newSession` action that does not expose raw Pi context to adapters.
- [x] 1.3 Capture or derive command-capable session-control context only where Pi provides `ExtensionCommandContext` support.
- [x] 1.4 Return an explicit unsupported-capability outcome when no safe command-capable context is available.
- [x] 1.5 Add route-action unit tests for success, unavailable, busy, unsupported, cancelled, and stale-route outcomes.

## 2. Handoff State and Binding Migration

- [x] 2.1 Add a shared pending-handoff model with old route identity, safe workspace identity, binding summaries, active selections, reason, and TTL.
- [x] 2.2 Implement strict matching helpers for replacement routes: same runtime/machine, same workspace root, active non-revoked binding, no explicit disconnect, no conflicting new binding, unambiguous candidate.
- [x] 2.3 Implement binding migration helpers that create new-session bindings, move active selections, and mark old bindings moved/superseded without breaking older state files.
- [x] 2.4 Ensure old route callbacks/actions/output retrieval become stale after successful handoff.
- [x] 2.5 Add state-store tests for migration, ambiguity, revoked/paused bindings, moved old bindings, and active selection updates.

## 3. Local Session Renewal Lifecycle

- [x] 3.1 On `session_shutdown`, unregister the old route immediately but create a bounded pending handoff when active bindings make renewal possible.
- [x] 3.2 Delay offline lifecycle notification during the handoff window and flush it when the handoff expires or fails.
- [x] 3.3 On `session_start`, migrate eligible bindings to the replacement route and send a safe moved-to-new-session notification.
- [x] 3.4 Preserve normal offline notification behavior for true shutdowns, explicit disconnects, and unsafe/ambiguous handoffs.
- [x] 3.5 Add runtime lifecycle tests for local `/new` success, expiry, ambiguous candidate, explicit disconnect, and stale old actions.

## 4. Remote New-Session Command

- [x] 4.1 Add canonical `/new` command parsing and help text for Telegram, with shared command definition metadata where applicable.
- [x] 4.2 Route remote `/new` through authorization, selected-route resolution, idle/busy checks, and the new-session route action.
- [x] 4.3 Implement safe success, offline, ambiguous, busy, unsupported, cancelled, and failure response text.
- [x] 4.4 Decide and implement initial busy policy, defaulting to refusal with guidance rather than replacing an active turn.
- [x] 4.5 Add Telegram direct runtime tests for authorized, unauthorized, offline, ambiguous, busy, unsupported, cancelled, and successful remote `/new`.

## 5. Broker and Adapter Parity

- [x] 5.1 Extend broker client protocol to request new-session route actions and report typed outcomes without leaking secrets.
- [x] 5.2 Implement Telegram broker `/new` handling with equivalent direct-runtime behavior and active selection migration.
- [x] 5.3 Update Slack and Discord command surfaces to execute shared new-session behavior or return explicit capability fallback.
- [x] 5.4 Ensure paused, revoked, moved, state-unavailable, and destination-mismatch binding checks suppress new-session side effects.
- [x] 5.5 Add broker, Slack, and Discord parity tests for command routing, outcomes, and fallback behavior.

## 6. Documentation and UX

- [x] 6.1 Update README/help text to document `/new`, busy/offline limitations, and handoff behavior.
- [x] 6.2 Add safe lifecycle notification copy for successful session handoff and failed/expired handoff guidance.
- [x] 6.3 Document that remote `/new` starts a replacement session for an online selected route and does not start Pi when the route is offline.
- [x] 6.4 Add smoke-test guidance for local `/new` handoff and remote `/new` through Telegram.

## 7. Validation

- [x] 7.1 Run `npm run typecheck`.
- [x] 7.2 Run `npm test`.
- [x] 7.3 Run `openspec validate remote-new-session-handoff --strict`.
