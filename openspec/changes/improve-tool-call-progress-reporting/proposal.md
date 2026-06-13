## Why

PiRelay's current normal-mode tool progress is too noisy and too low-signal: users see repeated messages such as `Tool completed — bash` without knowing what is actually happening. The recent live-progress coalescing work gives us the delivery foundation; now tool reporting needs human-readable, safe summaries and aggregation.

## What Changes

- Replace generic normal-mode tool milestones with compact tool-call progress summaries that describe the operation safely, such as `bash: npm test`, `read: extensions/relay/runtime/extension-runtime.ts`, or `edit: tests/integration.test.ts`.
- Track tool-call lifecycle by `toolCallId` so starts, completions, failures, and repeated calls collapse into a bounded live status card instead of separate repeated messages.
- Add allowlisted summarizers for built-in tools (`bash`, `read`, `edit`, `write`, `grep`/`rg`, `find`, `ls`) that expose useful intent without relaying tool output, hidden prompts, raw transcripts, secrets, or unbounded arguments.
- Keep normal mode focused on stable, human-readable tool progress while verbose mode can include more technical tool details under the same redaction and bounding rules.
- Preserve completion-only and quiet semantics: completion-only does not receive ordinary tool progress; quiet receives no progress.
- Maintain Telegram edit-in-place behavior and Slack/Discord coalesced snapshot fallback for the improved tool summaries.

## Capabilities

### New Capabilities

<!-- None. This improves existing relay-session progress behavior. -->

### Modified Capabilities

- `messenger-relay-sessions`: Progress reporting SHALL summarize and aggregate tool-call activity in a safe, bounded, human-readable form instead of emitting repeated generic tool-completed milestones.

## Impact

- Affected runtime code: `extensions/relay/runtime/extension-runtime.ts` tool event handling and progress-state helpers.
- Affected notification code: `extensions/relay/notifications/progress.ts` formatting/coalescing and new tool-summary helpers.
- Affected adapters: Telegram direct/broker progress delivery, Slack runtime, and Discord runtime should continue using the shared coalesced output.
- Affected tests: progress helper tests, runtime integration tests for tool-call lifecycle, Telegram edit/fallback tests, broker tests, and Slack/Discord parity tests.
- No new runtime dependencies are expected.
