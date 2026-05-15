## 1. Baseline and Inventory

- [x] 1.1 Rebase on or confirm the archived `fix-stale-extension-context` baseline so stale context/API handling is canonical before implementation.
- [ ] 1.2 Inventory current fallible `route.actions.*` call sites in Telegram, Discord, Slack, broker, requester file delivery, media/image delivery, status/session listing, and local runtime callbacks.
- [ ] 1.3 Classify each call site as prompt, abort, compact, media/workspace, status/probe, audit/persist/local side effect, or safe synchronous usage.
- [ ] 1.4 Identify state reserved before each fallible call site, including requester context, pending-turn flags, activity indicators, shared-room output destinations, abort flags, and adapter health fields.

## 2. Core Route-Action Safety Types

- [ ] 2.1 Add typed route action outcome types for success, unavailable, already-idle, and non-unavailable failure.
- [ ] 2.2 Add helper predicates/converters for route-unavailable errors and outcomes without relying on user-facing message string equality.
- [ ] 2.3 Keep existing safe unavailable wording for messenger rendering while separating it from control-flow representation.
- [ ] 2.4 Add focused unit tests for typed outcomes, unavailable detection, and non-unavailable error preservation.

## 3. Coherent Route Probes

- [ ] 3.1 Implement a shared route availability probe that preserves unavailable state across idle, model, and optional workspace checks.
- [ ] 3.2 Update `statusSnapshotForRoute` and `relayRouteStateForRoute` to use the coherent probe instead of independent liveness/model calls.
- [ ] 3.3 Update Telegram, Discord, Slack, and broker session-list/status paths to use the shared probe or snapshot helpers.
- [ ] 3.4 Add tests proving stale idle, model, or workspace probes render routes offline/unavailable rather than online idle, online busy, or online with missing model only.

## 4. Prompt Operation Safety

- [ ] 4.1 Implement a shared prompt operation helper that probes availability, chooses busy delivery mode, reserves requester context, invokes `sendUserMessage`, and returns typed accepted/unavailable/failure outcomes.
- [ ] 4.2 Add rollback hooks for adapter-private side effects such as typing, activity, thinking reactions, and shared-room output destinations.
- [ ] 4.3 Migrate Telegram private prompt, callback/guided answer, and shared-room `/to@bot` prompt paths to the shared prompt operation.
- [ ] 4.4 Migrate Discord prompt, steer, follow-up, image prompt, and shared-room prompt paths to the shared prompt operation.
- [ ] 4.5 Migrate Slack ordinary prompt, `pirelay to`, steer/follow-up equivalents, and channel/shared-room prompt paths to the shared prompt operation.
- [ ] 4.6 Migrate broker `deliverPrompt` handling to the shared prompt operation or a thin equivalent wrapper.
- [ ] 4.7 Add cross-adapter tests proving unavailable prompt races clear requester state, stop activity/typing/reaction refreshes, roll back shared-room destinations, and do not mark messenger runtime health unhealthy.

## 5. Control Operation Safety

- [ ] 5.1 Implement shared abort operation safety with availability precheck, idle outcome, abort-requested commit/rollback, and unavailable race handling.
- [ ] 5.2 Implement shared compact operation safety with availability precheck and unavailable race handling.
- [ ] 5.3 Migrate Telegram abort and compact command/callback paths to shared control helpers.
- [ ] 5.4 Migrate Discord abort and compact command paths to shared control helpers.
- [ ] 5.5 Migrate Slack abort and compact command paths to shared control helpers.
- [ ] 5.6 Migrate broker abort and compact actions to shared control helpers or a thin equivalent wrapper.
- [ ] 5.7 Add tests proving abort unavailable races roll back `abortRequested`, compact unavailable races return safe unavailable responses, and successful/idle control behavior remains unchanged.

## 6. Media, Workspace, and Requester File Safety

- [ ] 6.1 Implement shared workspace/media route safety helpers for latest-image retrieval, explicit image lookup, and requester-scoped workspace file lookup.
- [ ] 6.2 Ensure latest-turn media caches are route/session scoped or cleared on route switch and cannot cross sessions.
- [ ] 6.3 Migrate Telegram latest-image, send-image, and requester file paths to shared workspace/media safety outcomes.
- [ ] 6.4 Migrate Discord and Slack latest-image, send-image, and requester file paths to shared workspace/media safety outcomes.
- [ ] 6.5 Migrate broker latest-image, get-image-by-path, and requester file actions to shared workspace/media safety outcomes.
- [ ] 6.6 Add tests for stale workspace failures, session-switch media isolation, requester file unavailable outcomes, and preservation of existing path/MIME/size validation.

## 7. Architecture Cleanup and Guardrails

- [ ] 7.1 Replace high-risk long-lived direct `route.actions.context` usage with shared probes or narrow route actions.
- [ ] 7.2 Review remaining direct `route.actions.*` calls and document or test why each remaining call does not need operation-level rollback.
- [ ] 7.3 Add or update import/boundary tests to ensure new route-action safety helpers live in shared core modules and adapters do not add new raw context dependencies.
- [ ] 7.4 Update relevant docs or developer comments to explain route-action safety versus binding-authority responsibilities.

## 8. Validation

- [ ] 8.1 Run targeted unit tests for route-action helpers and status probes.
- [ ] 8.2 Run targeted Telegram, Discord, Slack, broker, requester-file, and media runtime tests affected by the migration.
- [ ] 8.3 Run `npm run typecheck`.
- [ ] 8.4 Run `npm test`.
- [ ] 8.5 Run `openspec validate relay-route-action-safety --strict`.
- [ ] 8.6 Run `openspec validate --all --strict` if other active changes are present.
