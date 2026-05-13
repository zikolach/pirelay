## 1. Domain and State

- [x] 1.1 Add pure lifecycle event types and message formatting helpers for offline, restored-online, and local-disconnect events.
- [x] 1.2 Add backward-compatible persisted lifecycle notification metadata to relay state with helpers to read/update per session, channel, and instance binding.
- [x] 1.3 Add deduplication/rate-limit decision helpers that initialize missing metadata silently and emit restored-online only after a recorded offline state.

## 2. Messenger Delivery

- [x] 2.1 Add Telegram lifecycle notification delivery for active non-revoked bindings using existing safe send paths.
- [x] 2.2 Add Discord lifecycle notification delivery scoped to the matching configured instance and active channel binding.
- [x] 2.3 Add Slack lifecycle notification delivery scoped to the matching configured instance and active channel binding, using Slack-safe command wording.
- [x] 2.4 Ensure lifecycle delivery failures are caught and treated as nonfatal diagnostics without changing runtime health.

## 3. Extension Lifecycle Integration

- [x] 3.1 Send best-effort offline lifecycle notifications during normal `session_shutdown` before route unregister where possible.
- [x] 3.2 Send restored-online lifecycle notifications after `session_start` restores and registers an existing previously-offline binding.
- [x] 3.3 Send local-disconnect lifecycle notifications before local `/relay disconnect` revokes bindings and unregisters routes.
- [x] 3.4 Preserve existing remote command behavior while ensuring offline bindings cannot inject prompts until a live route is registered again.

## 4. Tests and Validation

- [x] 4.1 Add unit tests for lifecycle formatting, safe content, Slack command wording, and deduplication decisions.
- [x] 4.2 Add state-store tests for backward-compatible lifecycle metadata persistence and rate-limit updates.
- [x] 4.3 Add integration tests for Telegram startup/offline/local-disconnect lifecycle notifications and failure containment.
- [x] 4.4 Add integration or runtime tests for Discord and Slack instance-scoped lifecycle notifications.
- [x] 4.5 Run `npm run typecheck`, `npm test`, and `openspec validate notify-relay-lifecycle-events --strict`.
