## 1. Presentation Model

- [x] 1.1 Add a shared delegation task presentation helper that derives status labels/icons, fields, latest result/reason, actions, fallback commands, and accessibility text from `DelegationTaskRecord`.
- [x] 1.2 Refactor existing plain-text task-card rendering to consume the presentation helper without changing safe redaction or text-command fallback behavior.
- [x] 1.3 Add unit tests for presentation output across claimable, awaiting-approval, running, completed, blocked, failed, cancelled, declined, and expired task states.

## 2. Adapter Action Rendering

- [x] 2.1 Add or reuse a shared mapping from `DelegationTaskAction` to `ChannelButtonLayout`, including primary/danger/default styles for claim/approve/cancel/status actions.
- [x] 2.2 Update Slack delegation task sends to include native buttons when actions are available and callbacks are supported.
- [x] 2.3 Ensure Slack cards keep safe fallback text or accessibility text while avoiding the current dense inline action paragraph as the primary UI.
- [x] 2.4 Review Discord and Telegram delegation task sends for parity with the shared presentation model; update only where needed to avoid regressions.

## 3. Shared-Room and Callback Safety

- [x] 3.1 Preserve existing authorization, task lookup, idempotency, and lifecycle checks for both button callbacks and fallback text commands.
- [x] 3.2 Ensure shared-room non-owner machine bots remain silent for unknown task ids observed in action callbacks or fallback text commands.
- [x] 3.3 Add regression tests covering stale/unknown task actions, non-target bot silence, and owning-bot task update rendering.

## 4. Live and Documentation Coverage

- [x] 4.1 Update Slack live delegation assertions to require completed cards with latest results in real-agent mode and not just running handoff cards.
- [x] 4.2 Update Slack live integration documentation to explain button-first task controls and text-command fallback.
- [x] 4.3 Run targeted validation: `npm run typecheck`, `npm test -- tests/slack-runtime.test.ts tests/slack-adapter.test.ts tests/relay/delegation-commands.test.ts tests/slack-live-delegation.test.ts`, and `openspec validate improve-delegation-task-card-ux --strict`.
