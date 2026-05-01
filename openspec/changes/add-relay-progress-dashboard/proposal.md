## Why

PiRelay is useful for launching and finishing work remotely, but long-running Pi turns can feel opaque from a phone. A compact progress feed and richer session dashboard would make remote supervision easier without requiring the user to open the local Pi TUI.

## What Changes

- Send safe, rate-limited Telegram progress updates during long-running Pi turns.
- Add a richer `/sessions` and `/status` dashboard with inline quick actions for common session operations.
- Add notification preferences such as quiet/verbose progress modes and completion-only delivery.
- Add session aliases so multiple paired sessions are easier to identify from mobile.
- Add lightweight recent-activity retrieval for the latest safe progress/tool summaries.

## Capabilities

### New Capabilities

### Modified Capabilities
- `telegram-session-tunnel`: adds mobile progress, dashboard, notification preference, alias, and recent-activity requirements.

## Impact

- Affected code: Telegram runtime, broker runtime, callback handling, state persistence, summary/progress formatting, tests, and documentation.
- Affected behavior: Telegram users receive optional progress updates and can manage sessions through richer inline actions.
- No breaking changes to existing `/telegram-tunnel` commands; existing commands remain fallbacks.
