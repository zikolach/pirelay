## Why

Paired remote users currently see task progress and completion, but context compaction can happen during long sessions without a clear remote signal. Notifying remote users when compaction starts and ends reduces confusion during pauses, especially for auto-compaction and remote `/compact` requests.

## What Changes

- Send safe messenger notifications when a paired Pi session begins compaction and when compaction completes.
- Deliver compaction start/end notifications according to each binding's progress mode, enabled for normal, verbose, and completion-only modes, and suppressed for quiet mode.
- Apply the behavior consistently across Telegram, Discord, Slack, and broker-mediated delivery paths.
- Keep notification content safe: no transcripts, hidden prompts, pairing codes, raw chat/channel ids, secrets, or compaction summary body.
- Treat delivery as best-effort and nonfatal; compaction must not fail because a messenger notification cannot be delivered.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `messenger-relay-sessions`: Extend shared progress semantics to include compaction start and compaction end notifications across messenger bindings.

## Impact

- Affected runtime hooks: Pi extension `session_before_compact` and `session_compact` handlers in the relay runtime.
- Affected delivery paths: route notification state, broker propagation, Telegram/Discord/Slack progress delivery.
- Affected tests: progress-mode behavior, compaction hook handling, broker parity, and secret-safe notification formatting.
- No new runtime dependencies are expected.
