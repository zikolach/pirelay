## Why

Telegram completion messages can become noisy when long-output actions appear on both the completion summary and the follow-up decision block. This makes mobile chats harder to scan and pushes the actionable answer choices down.

## What Changes

- Prefer a single full-output action surface per completed turn.
- When a structured answer/decision message is sent, place long-output actions on that decision message and omit them from the preceding completion summary.
- Keep long-output actions on ordinary completion summaries when there is no structured decision message.
- Preserve `/full` as a command fallback.
- Leave room for future response-layout polish under the same UX-focused change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `telegram-session-tunnel`: refine Telegram completion and decision-message UX for long assistant outputs.

## Impact

- Telegram tunnel runtime and broker notification keyboard placement.
- Telegram action/answer workflow tests and documentation.
- No API, dependency, or breaking changes.
