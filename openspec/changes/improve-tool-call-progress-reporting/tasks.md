## 1. Tool Summary Model

- [ ] 1.1 Add shared tool-progress types for current-turn tool records, lifecycle state, safe labels, aggregate counts, and formatted rows.
- [ ] 1.2 Implement pure allowlisted summarizers for built-in tools: bash, read, edit, write, grep/rg, find, and ls.
- [ ] 1.3 Ensure unknown/custom tools fall back to conservative sanitized tool-name labels without serializing arbitrary args.
- [ ] 1.4 Apply existing redaction, normalization, and progress length bounds before storing tool labels or semantic keys.
- [ ] 1.5 Add unit tests proving tool labels omit outputs, file contents, replacement text, raw transcripts, pairing codes, destination ids, and configured secret patterns.

## 2. Turn-Scoped Accumulator and Formatting

- [ ] 2.1 Implement a current-turn tool progress accumulator keyed by `toolCallId` with active, completed, failed, and count state.
- [ ] 2.2 Reset accumulator state on agent start, terminal end/failure/abort, route unregister, runtime stop/restart, and session changes.
- [ ] 2.3 Implement compact tool-progress card formatting that prioritizes active tools, recent failed/completed tools, and aggregate counts within `maxProgressMessageChars`.
- [ ] 2.4 Preserve existing live-progress coalescing and rate limiting while replacing generic repeated tool milestones with aggregated tool cards.
- [ ] 2.5 Add unit tests for repeated calls, active/recent prioritization, failed tool rows, count formatting, and truncation behavior.

## 3. Runtime Event Integration

- [ ] 3.1 Wire `tool_call` and/or `tool_execution_start` into the accumulator with safe summarized intent.
- [ ] 3.2 Wire `tool_execution_end` into completion/failure state without including raw result payloads.
- [ ] 3.3 Keep `message_end` tool-result bookkeeping volatile/verbose-only or suppress it when a matching tool lifecycle record exists.
- [ ] 3.4 Preserve approval-gate behavior and authorization boundaries in `tool_call` handlers before adding progress side effects.
- [ ] 3.5 Add integration tests for bash, read, edit/write, search/list, failed tools, duplicate tool events, and missing lifecycle fields.

## 4. Adapter and Broker Parity

- [ ] 4.1 Verify Telegram direct runtime edits the improved live tool card in place and falls back safely when edit fails.
- [ ] 4.2 Verify Telegram broker runtime emits equivalent improved tool progress content and does not persist unsafe tool args or outputs.
- [ ] 4.3 Verify Slack and Discord receive the same bounded coalesced tool summaries through snapshot fallback.
- [ ] 4.4 Verify paused, revoked, moved, state-unavailable, and destination-mismatch binding checks still suppress protected progress delivery.
- [ ] 4.5 Add parity tests for Telegram direct, broker, Slack, and Discord progress-mode behavior.

## 5. Progress Mode UX and Documentation

- [ ] 5.1 Verify normal mode receives safe low-noise tool summaries and no repeated generic `Tool completed — <tool>` stream.
- [ ] 5.2 Verify verbose mode can include additional safe tool lifecycle detail while remaining redacted, bounded, and coalesced.
- [ ] 5.3 Verify completion-only suppresses ordinary tool progress while preserving terminal output and allowed compaction notices.
- [ ] 5.4 Verify quiet suppresses all tool progress.
- [ ] 5.5 Update README/help text with examples of improved tool-progress reporting and progress-mode expectations.

## 6. Validation

- [ ] 6.1 Run `npm run typecheck`.
- [ ] 6.2 Run `npm test`.
- [ ] 6.3 Run `openspec validate improve-tool-call-progress-reporting --strict`.
