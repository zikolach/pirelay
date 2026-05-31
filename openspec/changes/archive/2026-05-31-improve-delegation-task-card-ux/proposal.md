## Why

Delegation task cards currently render as dense plain text that is technically human- and machine-readable but difficult to scan during live Slack shared-room workflows. The task lifecycle already exposes canonical actions, and several adapters already support buttons, so PiRelay should present delegation state and actions through platform-native UI with text commands only as a fallback.

## What Changes

- Introduce a first-class delegation task presentation model that separates task semantics from messenger-specific rendering.
- Render delegation task state with clear status, participants, goal, expiry, and latest result sections instead of one long text paragraph.
- Expose claim, approve, decline, cancel, and status actions as platform-native buttons when the messenger supports callbacks.
- Preserve safe plain-text fallback commands for platforms or contexts where buttons are unavailable, stale, or unsupported.
- Improve Slack delegation task cards using Block Kit-compatible text/actions while keeping shared-room multi-bot silence and authorization rules intact.
- Add parity-oriented tests for presentation, action rendering, fallback text, and non-target/stale action behavior.

## Capabilities

### New Capabilities
- `delegation-task-card-ux`: Covers platform-native delegation task presentation, action buttons, safe fallbacks, and lifecycle-state rendering for shared-room delegation tasks.

### Modified Capabilities
- None.

## Impact

- Affected code: `extensions/relay/commands/delegation.ts`, shared delegation presentation helpers, Slack/Discord/Telegram adapter/runtime task-card send paths, and related unit/live tests.
- APIs: No public command syntax changes; existing `relay task ...` text commands remain supported as fallback.
- Dependencies: No new runtime dependencies expected; Slack rendering should use existing Block Kit support, Discord components, and Telegram inline keyboard support.
- Systems: Slack shared-room delegation UX improves first; Discord and Telegram should either use the same presentation model where supported or retain explicit fallback behavior with tests.
