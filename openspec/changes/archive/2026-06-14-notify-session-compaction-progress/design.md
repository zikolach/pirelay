## Context

Pi exposes compaction to extensions through `session_before_compact` and `session_compact`. `session_before_compact` fires for manual compaction and auto-compaction, including threshold and overflow paths, but it does not expose the compaction reason. `session_compact` fires after a compaction entry is successfully appended.

PiRelay already tracks per-route progress through `SessionRoute.notification.progressEvent` and adapter/broker delivery loops. Progress modes are binding-specific: `quiet`, `normal`, `verbose`, and `completion-only`. Existing non-terminal activity is generally delivered only for normal and verbose, while terminal output is still delivered for completion-only. This change needs a small exception: compaction lifecycle notifications should be visible in every progress mode except quiet.

## Goals / Non-Goals

**Goals:**

- Notify active paired messenger bindings when Pi begins compaction.
- Notify active paired messenger bindings when Pi successfully completes compaction.
- Respect binding-specific progress mode: send in normal, verbose, and completion-only; suppress in quiet.
- Keep notifications messenger-neutral and safe across Telegram, Discord, Slack, and broker delivery.
- Avoid disrupting compaction if remote notification delivery fails.

**Non-Goals:**

- Expose or send the generated compaction summary to messengers.
- Distinguish manual, threshold, and overflow compactions; Pi's extension hook does not currently expose the reason.
- Guarantee an end/failure notification for auto-compaction failures that occur after `session_before_compact` but before `session_compact`; Pi extensions do not currently receive `compaction_end`.
- Change Pi's extension API.

## Decisions

1. **Use existing Pi extension hooks rather than SDK-only events.**
   - Decision: Use `session_before_compact` for start and `session_compact` for successful completion.
   - Rationale: These hooks are available to PiRelay extensions today and cover auto-compaction.
   - Alternative considered: Wait for `compaction_start`/`compaction_end` extension events. That would provide richer status but blocks useful notifications on upstream Pi changes.

2. **Represent compaction as a dedicated progress lifecycle event.**
   - Decision: Add route progress activity such as `Context compaction started` and `Context compaction completed` using existing sanitized progress formatting and recent-activity storage.
   - Rationale: It reuses existing broker and adapter progress transport, redaction, and recent activity behavior.
   - Alternative considered: Add a separate notification channel. That would duplicate rate limiting, binding authority checks, and platform delivery logic.

3. **Use a compaction-specific progress-mode predicate.**
   - Decision: Introduce or apply logic equivalent to `mode !== "quiet"` for compaction notifications instead of `shouldSendNonTerminalProgress()`.
   - Rationale: The requested behavior intentionally includes completion-only mode, while existing non-terminal progress excludes it.
   - Alternative considered: Treat compaction start as ordinary non-terminal progress. That would incorrectly suppress it for completion-only bindings.

4. **Keep notification content minimal.**
   - Decision: Messages mention only the session display label/context and lifecycle state; they must not include compaction summary contents, transcript excerpts, hidden prompts, internal ids, or tokens.
   - Rationale: Compaction summaries can contain sensitive conversation details and should remain in session context, not messenger notifications.

## Risks / Trade-offs

- **No failure end hook for auto-compaction** → Mitigation: document and test the behavior around start and successful completion; continue reporting remote `/compact` action failures through the existing route-action outcome path.
- **Duplicate notifications from direct adapter and broker paths** → Mitigation: publish one route progress event per hook and let the existing owner/broker route delivery rules decide the active outbound path.
- **Completion-only semantics become less literal** → Mitigation: scope the exception narrowly to compaction lifecycle notifications and keep quiet as the only fully suppressed mode.
- **Messenger send failures during compaction** → Mitigation: use best-effort asynchronous delivery and preserve existing nonfatal progress-delivery behavior.
