## 1. Progress Model and Formatting

- [x] 1.1 Add shared types/helpers for live progress state, stable milestones, volatile status snapshots, destination keys, and progress-mode eligibility.
- [x] 1.2 Implement semantic deduplication for equivalent progress activities using normalized kind/text/detail or a stable progress key rather than event id alone.
- [x] 1.3 Implement coalescing rules that keep stable milestones, keep only the latest volatile status per category, and drop superseded stream snapshots.
- [x] 1.4 Update progress formatting to support compact one-line and bounded multi-line output without the repetitive `Pi progress` header where the adapter can provide source context.
- [x] 1.5 Add safety filtering tests proving live progress omits hidden thinking, raw transcripts, pairing codes, destination identifiers, tokens, and compaction summaries.

## 2. Runtime Event Classification

- [x] 2.1 Classify assistant/model stream updates as volatile live status rather than stable normal-mode milestones.
- [x] 2.2 Classify compaction start/end as stable lifecycle milestones that remain eligible in every progress mode except quiet.
- [x] 2.3 Collapse overlapping tool lifecycle events so normal mode does not emit both `Processed tool result` and `Tool completed — <tool>` for the same tool call.
- [x] 2.4 Keep verbose mode capable of exposing additional technical progress while still using dedupe and coalescing.
- [x] 2.5 Add integration tests for repeated assistant updates, overlapping tool events, compaction events, and final-output separation.

## 3. Adapter and Broker Delivery

- [x] 3.1 Extend the messenger adapter/runtime contract with optional live-progress edit capability and a fallback snapshot path.
- [x] 3.2 Implement Telegram direct live progress delivery using send-then-edit where possible, with safe fallback to coalesced snapshots when edit fails.
- [x] 3.3 Implement equivalent Telegram broker delivery behavior, including minimal non-secret message-reference handling if required.
- [x] 3.4 Update Slack and Discord delivery paths to use coalesced snapshot fallback while preserving authorization, paused/revoked, and binding authority checks.
- [x] 3.5 Ensure terminal completion, failure, abort, and full-output delivery finalize or clear live progress state without merging final output into live status.

## 4. Progress Mode UX

- [x] 4.1 Verify normal mode delivers only stable milestones and coalesced live status, never duplicate stream snapshots or generic tool-result bookkeeping.
- [x] 4.2 Verify verbose mode can deliver more detailed progress but remains deduplicated, coalesced, rate-limited, and bounded by platform message limits.
- [x] 4.3 Verify completion-only receives final output and allowed compaction notices but no ordinary live progress snapshots.
- [x] 4.4 Verify quiet receives no live progress or compaction progress.
- [x] 4.5 Update README/help text to explain the revised normal, verbose, completion-only, and quiet behavior.

## 5. Tests and Validation

- [x] 5.1 Add unit tests for accumulator/coalescing/deduplication helpers.
- [x] 5.2 Add Telegram runtime tests for edit-in-place delivery, edit failure fallback, terminal finalization, and progress-mode filtering.
- [x] 5.3 Add broker tests for coalesced progress delivery and preservation of authorization/binding authority checks.
- [x] 5.4 Add Slack and Discord parity tests for coalesced snapshot fallback and queued-progress preservation.
- [x] 5.5 Run `npm run typecheck`.
- [x] 5.6 Run `npm test`.
- [x] 5.7 Run `openspec validate coalesce-live-progress-updates --strict`.
