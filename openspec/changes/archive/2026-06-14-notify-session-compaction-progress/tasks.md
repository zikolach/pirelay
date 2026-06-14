## 1. Progress Semantics

- [x] 1.1 Add a compaction-progress eligibility helper that returns true for normal, verbose, and completion-only progress modes and false for quiet.
- [x] 1.2 Add safe formatting or progress activity labels for compaction start and compaction completion without including summary text or internal identifiers.

## 2. Runtime Integration

- [x] 2.1 Handle Pi `session_before_compact` in the relay extension runtime by recording/publishing a compaction-start progress event for the current route.
- [x] 2.2 Handle Pi `session_compact` in the relay extension runtime by recording/publishing a compaction-completed progress event for the current route.
- [x] 2.3 Ensure broker-mediated route updates and direct Telegram, Discord, and Slack delivery paths all apply the compaction-specific progress-mode policy.
- [x] 2.4 Ensure revoked, paused, stale, or unauthorized bindings do not receive compaction notifications through existing binding authority checks.

## 3. Tests

- [x] 3.1 Add unit tests for the compaction progress-mode helper, including quiet, normal, verbose, and completion-only.
- [x] 3.2 Add runtime tests that `session_before_compact` records/publishes a compaction-start notification and `session_compact` records/publishes a compaction-completed notification.
- [x] 3.3 Add adapter or broker parity tests proving compaction notifications are delivered in normal, verbose, and completion-only modes but suppressed in quiet mode.
- [x] 3.4 Add safety tests proving compaction notifications omit compaction summaries, raw destination identifiers, and other sensitive content.

## 4. Validation

- [x] 4.1 Run `npm run typecheck`.
- [x] 4.2 Run `npm test`.
- [x] 4.3 Run `openspec validate notify-session-compaction-progress --strict`.
