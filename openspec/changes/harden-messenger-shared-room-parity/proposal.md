## Why

Telegram announced on May 7, 2026 that bots can now respond to other bots when both bots enable Bot-to-Bot Communication. PiRelay already has a shared-room machine-bot model that relies on dedicated bot identities in one Telegram group, but the specs and tests currently describe this mostly as privacy-mode addressed commands and do not explicitly document or verify the new Telegram bot-to-bot capability.

At the same time, Discord and Slack shared-room support are not equally mature. Discord has gated guild-channel shared-room pre-routing and mention/text-prefix handling, while Slack currently has adapter capabilities and mention parsing but lacks an equivalent runtime inventory/implementation path. We need an explicit parity inventory and follow-up implementation work so users know which shared-room behaviors are supported on each messenger and missing gaps are closed deliberately.

## What Changes

- Document Telegram Bot-to-Bot Communication Mode as a supported shared-room option, including what PiRelay requires from BotFather/platform settings and how it differs from privacy-mode addressed commands.
- Add verification coverage for Telegram bot-to-bot/shared-room behavior: unit/integration tests for bot-authored updates, bot-to-bot settings diagnostics, and, where credentials are provided, optional E2E smoke guidance/tests in a real Telegram group.
- Inventory Discord and Slack shared-room feature parity against the shared adapter capability contract.
- Preserve Discord's safe defaults while filling missing documentation, diagnostics, and tests for guild shared-room behavior.
- Implement or explicitly defer Slack shared-room runtime gaps, especially app mention/channel command pre-routing, authorization, active selection, and non-target silence.

## Capabilities

### New Capabilities

<!-- None. This change hardens existing shared-room and messenger adapter capabilities. -->

### Modified Capabilities

- `shared-room-machine-bots`: Documents Telegram Bot-to-Bot Communication Mode and requires testable shared-room bot-to-bot behavior.
- `relay-channel-adapters`: Adds platform parity inventory and capability-test requirements for shared-room behavior across Telegram, Discord, and Slack.
- `slack-relay-adapter`: Defines Slack shared-room runtime behavior and parity gaps to close or explicitly document.
- `relay-configuration`: Adds diagnostics/setup requirements for Telegram bot-to-bot settings and per-platform shared-room readiness.

## Impact

- Affected code: Telegram adapter/runtime tests and docs, setup/doctor diagnostics, shared-room capability matrix, Discord tests/docs, Slack runtime/adapter/tests, optional E2E harness documentation.
- Telegram Bot API behavior is external and must remain feature-gated/diagnostic rather than assumed available for every bot.
- No secrets, bot tokens, pairing codes, hidden prompts, or full transcripts may be printed in docs, diagnostics, or tests.
