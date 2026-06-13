## 1. Progress Semantics

- [ ] 1.1 Add a compaction-progress eligibility helper that returns true for normal, verbose, and completion-only progress modes and false for quiet.
- [ ] 1.2 Add safe formatting or progress activity labels for compaction start and compaction completion without including summary text or internal identifiers.

## 2. Runtime Integration

- [ ] 2.1 Handle Pi `session_before_compact` in the relay extension runtime by recording/publishing a compaction-start progress event for the current route.
- [ ] 2.2 Handle Pi `session_compact` in the relay extension runtime by recording/publishing a compaction-completed progress event for the current route.
- [ ] 2.3 Ensure broker-mediated route updates and direct Telegram, Discord, and Slack delivery paths all apply the compaction-specific progress-mode policy.
- [ ] 2.4 Ensure revoked, paused, stale, or unauthorized bindings do not receive compaction notifications through existing binding authority checks.

## 3. Tests

- [ ] 3.1 Add unit tests for the compaction progress-mode helper, including quiet, normal, verbose, and completion-only.
- [ ] 3.2 Add runtime tests that `session_before_compact` records/publishes a compaction-start notification and `session_compact` records/publishes a compaction-completed notification.
- [ ] 3.3 Add adapter or broker parity tests proving compaction notifications are delivered in normal, verbose, and completion-only modes but suppressed in quiet mode.
- [ ] 3.4 Add safety tests proving compaction notifications omit compaction summaries, raw destination identifiers, and other sensitive content.

## 4. Validation

- [ ] 4.1 Run `npm run typecheck`.
- [ ] 4.2 Run `npm test`.
- [ ] 4.3 Run `openspec validate notify-session-compaction-progress --strict`.
