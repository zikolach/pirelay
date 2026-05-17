## Context

Shared-room delegation now works end-to-end in Slack, but the visible task card is a single plain-text blob combining lifecycle state, participants, goal, expiry, latest result, and fallback commands. That format is useful for logs and tests but hard for humans to scan, especially when several machine bots share one channel.

The code already exposes the core pieces needed for richer UI:

- `renderDelegationTaskCard()` returns safe bounded text plus canonical actions.
- `delegationTaskActionsForStatus()` maps task states to claim/approve/decline/cancel/status actions.
- `delegationActionId()` and `parseDelegationActionId()` provide stable callback payloads.
- Slack, Discord, and Telegram adapters already support normalized button layouts.
- Discord delegation already maps task actions to buttons; Slack currently sends only the text task card.

The design should therefore avoid changing task semantics and instead make presentation explicit, testable, and platform-aware.

## Goals / Non-Goals

**Goals:**

- Create a shared presentation layer for delegation task cards so status, fields, latest result, and actions are represented structurally before platform rendering.
- Render Slack delegation cards using platform-native button actions where supported, with readable fallback text for copied/manual command use.
- Preserve existing text commands (`relay task claim ...`, `relay task status ...`) for platforms without callbacks, stale cards, debugging, and accessibility.
- Make lifecycle states visually distinct: claimable/awaiting approval, claimed/running, completed, blocked/failed/cancelled/expired.
- Preserve all authorization, task-state, and shared-room silence semantics; UI improvements must not authorize new actions.
- Add unit tests for presentation mapping, Slack/adapter button rendering, fallback text, and stale/non-owner callback behavior.

**Non-Goals:**

- Updating previous task messages in place by storing Slack timestamps or Telegram message ids.
- Changing delegation lifecycle semantics, autonomy policy, peer trust, or prompt handoff behavior.
- Removing plain-text command handling.
- Introducing new dependencies or a separate hosted service.
- Redesigning unrelated Slack status, progress, or final-output messages.

## Decisions

### Decision: Add a shared delegation task presentation model

Create a messenger-neutral presentation object derived from `DelegationTaskRecord`, for example:

```ts
interface DelegationTaskPresentation {
  title: string;
  status: { value: DelegationTaskStatus; label: string; icon: string };
  fields: Array<{ label: string; value: string }>;
  latest?: { label: string; value: string };
  actions: DelegationTaskAction[];
  fallbackText: string;
  accessibilityText: string;
}
```

The exact shape can be adjusted during implementation, but it should keep domain semantics separate from Slack/Telegram/Discord formatting.

Rationale: duplicating status/field/result selection in each adapter would drift over time. A shared presentation layer gives adapters a consistent source of truth while still allowing platform-specific rendering.

Alternatives considered:

- Keep `renderDelegationTaskCard()` as a text-only function and let adapters parse text. Rejected because parsing rendered text is brittle and loses semantic action/status data.
- Implement only a Slack-specific renderer. Rejected because Discord and Telegram already have button support and should share the same action semantics even if their visual polish differs.

### Decision: Preserve append-only task updates for this change

Each lifecycle update should continue to send a new task card/update message. Do not store platform message ids for edit-in-place behavior in this change.

Rationale: append-only updates are simple, auditable, and match current live-test behavior. Updating in place requires storing platform-specific message references, handling race conditions, and deciding how to preserve audit visibility.

Alternative considered:

- Update the original Slack task card in place. Deferred as a future change because it requires persisted per-platform message metadata and stale-update conflict handling.

### Decision: Use existing normalized button layout and callback ids

Task actions should be rendered as `ChannelButtonLayout` using existing `pirelay:delegation:<action>:<task-id>` action ids. Slack should attach buttons to the task card instead of posting a separate generic `Actions:` message when possible.

Rationale: callback ids already route through delegation action parsing and preserve authorization checks. Reusing the adapter button contract keeps Telegram, Discord, and Slack aligned.

Alternative considered:

- Add Slack-only Block Kit action ids and handlers. Rejected because it forks semantics and makes cross-adapter parity harder.

### Decision: Fallback commands are secondary but always present or recoverable

When native buttons are available, the card should not lead with inline fallback commands. It may include compact fallback text in a context/footer section or expose it in tests/accessibility text. When buttons are unavailable, fallback commands become the visible action surface.

Rationale: users should see clear buttons first, but text commands remain valuable for manual live tests, copy/paste, accessibility, and platforms or contexts where callbacks are unavailable.

### Decision: Terminal cards must highlight the result summary

Completed, failed, blocked, cancelled, declined, and expired states should visually emphasize the terminal result/reason rather than burying it among command text. Real-agent live tests should assert that a completed card includes the run marker and latest result.

Rationale: live testing showed that `Status: running` is only handoff confirmation; users need to see whether work actually completed and what the result was.

## Risks / Trade-offs

- **Risk: native buttons trigger duplicate or stale actions** → Keep existing task lookup, authorization, idempotency, and stale-action checks; add tests for unknown/non-owner task ids remaining silent in shared rooms.
- **Risk: richer Slack rendering accidentally removes useful text fallback** → Keep `accessibilityText`/fallback output and test that fallback commands are still generated.
- **Risk: platform-specific markup mentions users/channels unexpectedly** → Reuse existing safe text helpers and adapter escaping/formatting behavior; bound all user-provided fields.
- **Risk: cards become inconsistent across Slack, Discord, and Telegram** → Centralize task status/field/action selection in the presentation model; adapters only map it to platform UI.
- **Risk: append-only cards create channel noise** → Accept for this change; consider edit-in-place as a later scoped change once message reference storage is designed.
- **Risk: adding buttons changes perceived authorization** → Treat buttons as transport for existing commands only; all runtime authorization and state-transition checks remain authoritative.
