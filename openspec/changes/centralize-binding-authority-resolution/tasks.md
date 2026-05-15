## 1. Shared Binding Authority Model

- [x] 1.1 Define shared authority outcome types for `active`, `paused`, `revoked`, `moved`, `missing`, and `state-unavailable` Telegram/channel binding decisions.
- [x] 1.2 Add pure Telegram binding resolution helpers that classify a state snapshot, expected destination, and optional volatile candidate without filesystem or messenger side effects.
- [x] 1.3 Add pure channel binding resolution helpers that include messenger kind, instance id, session key, conversation id, and user id matching.
- [x] 1.4 Add bounded volatile fallback rules that allow exact fallback only when state loaded successfully, no persisted record exists, and the call site explicitly permits fallback.
- [x] 1.5 Add shared stable destination-key helpers for Telegram and channel deferred work.
- [x] 1.6 Add unit tests covering active, paused, revoked, moved, missing, state-unavailable, exact fallback, stale fallback, and key collision cases.

## 2. State Snapshot Loading

- [x] 2.1 Introduce a state-loading result or snapshot API that distinguishes missing state from unreadable, corrupt, or unavailable state.
- [x] 2.2 Update protected delivery call paths to use fail-closed snapshot loading rather than treating every load error as an empty store.
- [x] 2.3 Preserve fresh-install/setup behavior where a truly missing state file is treated as empty.
- [x] 2.4 Audit synchronous state-store helpers and either remove unused ones or restrict them to explicit non-runtime call paths.
- [x] 2.5 Add tests proving corrupt or unreadable state blocks protected delivery fallback while missing state still permits setup-safe behavior.

## 3. Adapter Runtime Migration

- [x] 3.1 Migrate Telegram outbound completion, callbacks, full-output, latest-image, activity, and progress paths to authority snapshots and stable destination keys.
- [x] 3.2 Migrate Discord completion, file/image delivery, lifecycle, typing refresh, and recent-binding fallback paths to shared authority semantics.
- [x] 3.3 Migrate Slack completion, file/image delivery, lifecycle, progress flush, thread metadata, and recent-binding fallback paths to shared authority semantics.
- [x] 3.4 Ensure adapter timer callbacks clear by captured key and never retarget to a new conversation after re-pair or overwrite.
- [x] 3.5 Ensure adapter platform send/upload/typing/reaction operations are not called when authority is paused, revoked, moved, missing without allowed fallback, or state-unavailable.

## 4. Broker Migration

- [x] 4.1 Migrate broker route registration and resync handling to classify incoming route bindings with binding authority before upserting persisted state.
- [x] 4.2 Migrate broker `/sessions`, prompt routing, and active-route lookup to load state once per operation and resolve candidates from that snapshot.
- [x] 4.3 Migrate broker `sendToBoundChat`, callback/full-output/image delivery, requester-file delivery, and lifecycle paths to shared authority checks.
- [x] 4.4 Migrate broker progress and activity timers to captured destination keys with key-based cleanup.
- [x] 4.5 Add broker parity tests proving stale registrations, moved bindings, revoked bindings, corrupt state, and timer cleanup behave like adapter runtimes.

## 5. Cross-Cutting Delivery Integrations

- [x] 5.1 Update local lifecycle notification delivery to use authority snapshots before messenger sends and lifecycle bookkeeping.
- [x] 5.2 Update remote requester file delivery to verify requester authority before reading workspace files or invoking adapter upload APIs.
- [x] 5.3 Update shared final-output/file/media delivery helpers to accept authority-checked destinations or perform authority checks at their edge.
- [x] 5.4 Add safe local diagnostics for state-unavailable delivery suppression without exposing tokens, hidden prompts, paths outside workspace, or transcript content.

## 6. Regression and Parity Coverage

- [x] 6.1 Add table-driven authority matrix tests shared across Telegram, Discord, Slack, and broker behavior where practical.
- [x] 6.2 Preserve PR #44 revoked-binding regressions and extend them to state-unavailable and moved-binding cases.
- [x] 6.3 Add tests proving recent/in-memory caches cannot override persisted revoked, paused, moved, or unavailable state.
- [x] 6.4 Add tests proving timer cleanup uses captured keys even when route bindings are cleared before the callback runs.
- [x] 6.5 Add import or usage checks preventing synchronous state helpers in runtime timer/delivery hot paths if sync helpers remain.

## 7. Documentation and Validation

- [x] 7.1 Update developer documentation or code comments to describe binding authority, state-unavailable fail-closed behavior, and bounded volatile fallback.
- [x] 7.2 Run targeted state, adapter, broker, lifecycle, file-delivery, and revoked-binding tests.
- [x] 7.3 Run `npm run typecheck`.
- [x] 7.4 Run `npm test`.
- [x] 7.5 Run `openspec validate centralize-binding-authority-resolution --strict`.
