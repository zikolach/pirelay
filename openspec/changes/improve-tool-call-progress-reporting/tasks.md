## 1. Tool Summary Model

- [x] 1.1 Add shared tool-progress types for current-turn tool records, lifecycle state, safe labels, aggregate counts, and formatted rows.
- [x] 1.2 Implement pure allowlisted summarizers for built-in tools: bash, read, edit, write, grep/rg, find, and ls.
- [x] 1.3 Ensure unknown/custom tools fall back to conservative sanitized tool-name labels without serializing arbitrary args.
- [x] 1.4 Apply existing redaction, normalization, and progress length bounds before storing tool labels or semantic keys.
- [x] 1.5 Add unit tests proving tool labels omit outputs, file contents, replacement text, raw transcripts, pairing codes, destination ids, and configured secret patterns.

## 2. Turn-Scoped Accumulator and Formatting

- [x] 2.1 Implement a current-turn tool progress accumulator keyed by `toolCallId` with active, completed, failed, and count state.
- [x] 2.2 Reset accumulator state on agent start, terminal end/failure/abort, route unregister, runtime stop/restart, and session changes.
- [x] 2.3 Implement compact tool-progress card formatting that prioritizes active tools, recent failed/completed tools, and aggregate counts within `maxProgressMessageChars`.
- [x] 2.4 Preserve existing live-progress coalescing and rate limiting while replacing generic repeated tool milestones with aggregated tool cards.
- [x] 2.5 Add unit tests for repeated calls, active/recent prioritization, failed tool rows, count formatting, and truncation behavior.

## 3. Runtime Event Integration

- [x] 3.1 Wire `tool_call` and/or `tool_execution_start` into the accumulator with safe summarized intent.
- [x] 3.2 Wire `tool_execution_end` into completion/failure state without including raw result payloads.
- [x] 3.3 Keep `message_end` tool-result bookkeeping volatile/verbose-only or suppress it when a matching tool lifecycle record exists.
- [x] 3.4 Preserve approval-gate behavior and authorization boundaries in `tool_call` handlers before adding progress side effects.
- [x] 3.5 Add integration tests for bash, read, edit/write, search/list, failed tools, duplicate tool events, and missing lifecycle fields.

## 4. Adapter and Broker Parity

- [x] 4.1 Verify Telegram direct runtime edits the improved live tool card in place and falls back safely when edit fails.
- [x] 4.2 Verify Telegram broker runtime emits equivalent improved tool progress content and does not persist unsafe tool args or outputs.
- [x] 4.3 Verify Slack and Discord receive the same bounded coalesced tool summaries through snapshot fallback.
- [x] 4.4 Verify paused, revoked, moved, state-unavailable, and destination-mismatch binding checks still suppress protected progress delivery.
- [x] 4.5 Add parity tests for Telegram direct, broker, Slack, and Discord progress-mode behavior.

## 5. Progress Mode UX and Documentation

- [x] 5.1 Verify normal mode receives safe low-noise tool summaries and no repeated generic `Tool completed — <tool>` stream.
- [x] 5.2 Verify verbose mode can include additional safe tool lifecycle detail while remaining redacted, bounded, and coalesced.
- [x] 5.3 Verify completion-only suppresses ordinary tool progress while preserving terminal output and allowed compaction notices.
- [x] 5.4 Verify quiet suppresses all tool progress.
- [x] 5.5 Update README/help text with examples of improved tool-progress reporting and progress-mode expectations.

## 6. Validation

- [x] 6.1 Run `npm run typecheck`.
- [x] 6.2 Run `npm test`.
- [x] 6.3 Run `openspec validate improve-tool-call-progress-reporting --strict`.
