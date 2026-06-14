## Context

Pi emits a live session event stream with message start/update/end, tool lifecycle, queue, compaction, and terminal events. The local Pi terminal renders much of this as mutable UI state: one assistant message component is updated in place, and tool components are updated as execution progresses.

PiRelay currently flattens selected events into messenger chat messages. This works for stable milestones and final output, but it is a poor fit for volatile stream snapshots. Recent experiments with relaying safe assistant text showed the problem clearly: identical or superseded model updates can become many Telegram messages because each update is a distinct relay progress event. Tool lifecycle handling can also report overlapping internal events such as `Processed tool result` and `Tool completed — bash`.

The relay should treat Pi progress as session state first and messenger messages second. The delivery strategy should depend on messenger capability: edit a single live status message when supported, or send a coalesced snapshot at a controlled cadence when not.

## Goals / Non-Goals

**Goals:**
- Prevent duplicate progress messages caused by repeated stream snapshots or overlapping lifecycle events.
- Make normal progress mode useful and low-noise by delivering stable milestones and coalesced live status only.
- Preserve verbose progress for users who want more detail, while still deduplicating and rate-limiting it.
- Use edit-in-place for live progress when the messenger adapter supports it, starting with Telegram as the primary target.
- Fall back to sending coalesced snapshots where editing is unsupported or fails.
- Keep final completion/failure/abort output as separate terminal notifications.
- Preserve existing authorization, paused/revoked binding, progress-mode, and secret-safety boundaries.

**Non-Goals:**
- Relaying hidden thinking, chain-of-thought, raw transcript content, hidden prompts, tool internals, or full streaming deltas.
- Replacing Pi's local terminal rendering.
- Removing existing progress modes in this change.
- Implementing rich threaded dashboards for every messenger platform in the first iteration.

## Decisions

1. **Represent progress as coalesced session state, not a list of raw events.**
   - Introduce a progress accumulator that accepts safe progress activities and produces a current live status snapshot plus optional stable milestones.
   - Rationale: Pi's terminal is stateful; messenger delivery should mirror that concept instead of posting every intermediate event.
   - Alternative considered: Deduplicate individual messages by text hash only. This helps immediate spam but does not solve superseded updates or tool lifecycle overlap.

2. **Use progress classes to distinguish milestones from volatile live status.**
   - Stable milestones include start, compaction start/end, explicit failures, and meaningful tool boundaries.
   - Volatile live status includes assistant/model stream snapshots and rapidly changing tool-output/progress details.
   - Rationale: normal mode should not depend on low-level event timing.
   - Alternative considered: Keep the existing `kind` enum as-is. It is too coarse: `status` can mean either stable or volatile status.

3. **Normal mode sends low-noise milestones and coalesced snapshots; verbose can include more detail.**
   - Normal SHALL suppress generic stream snapshots unless they are folded into a live status update that replaces or coalesces earlier state.
   - Verbose MAY include additional technical details but MUST still deduplicate repeated content.
   - Rationale: a remote chat should remain readable during long tasks.

4. **Prefer edit-in-place where available.**
   - Adapter contract should expose optional live-progress update capability, for example `sendOrUpdateProgress(address, state)` or equivalent methods that return/update a platform message reference.
   - Telegram can use `sendMessage` then `editMessageText` for the live status message.
   - Slack and Discord can use edit APIs if wired later; until then they can use snapshot fallback.
   - Rationale: edit-in-place best matches Pi's terminal live component.
   - Alternative considered: Always send snapshots. This is simpler but still creates chat history noise during long runs.

5. **Keep terminal notifications separate from live progress.**
   - Completion/failure/abort final output remains a distinct message and should clear or finalize live progress state.
   - Rationale: final output is durable user content; live status is ephemeral operational feedback.

6. **Persist only minimal non-sensitive live message references if needed.**
   - Editable message ids may be stored per binding/session if needed for broker/runtime restarts.
   - Stored state MUST NOT include raw transcript text or hidden content.
   - Rationale: edit-in-place may need a platform message id, but progress text can be recomputed from safe current state or safely dropped.

## Risks / Trade-offs

- **Risk: Editable message state becomes stale after messenger deletion or restart.** → Treat edit failures as non-fatal, clear the stored reference, and fall back to sending a new coalesced snapshot.
- **Risk: Coalescing hides useful detail.** → Keep verbose mode for additional technical progress and preserve `/recent` for bounded recent activity.
- **Risk: Platform parity differs because edit support varies.** → Define messenger-neutral behavior as coalesced delivery; edit-in-place is an optimization, not a correctness requirement.
- **Risk: Progress accumulator accidentally retains sensitive text.** → Accept only sanitized safe progress activities and add tests proving hidden thinking, raw identifiers, pairing codes, and summaries are omitted.
- **Risk: Implementation touches multiple adapters and broker path.** → Implement via shared helpers and adapter capability methods to avoid divergent policy.

## Migration Plan

1. Add shared accumulator/formatter helpers and tests without changing delivery behavior.
2. Route runtime progress events through the accumulator and preserve current progress modes.
3. Update Telegram direct and broker delivery to edit or coalesce live progress messages.
4. Update Slack and Discord to use coalesced snapshot fallback, with optional edit support left for a later platform-specific enhancement.
5. Validate with typecheck, full tests, and OpenSpec validation.
6. Rollback strategy: disable edit-in-place and use snapshot fallback while retaining dedupe/coalescing helpers.

## Open Questions

- What exact visual format should the compact live status use: session color marker, session label, both, or platform-specific prefix?
- Should successful short-lived tool completions be omitted entirely in normal mode, or shown only when they take longer than a threshold?
- Should `/recent` show coalesced live status history, raw bounded milestones, or both?
- Should Telegram live progress messages be deleted, finalized, or left as-is after final output is delivered?
