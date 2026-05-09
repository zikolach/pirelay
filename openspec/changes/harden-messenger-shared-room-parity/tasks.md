## 1. Telegram Bot-to-Bot documentation and diagnostics

- [x] 1.1 Add user-facing docs/setup guidance for Telegram Bot-to-Bot Communication Mode, including enabling it for both bots and how it relates to `/command@bot` privacy-mode fallback.
- [x] 1.2 Add `/relay doctor` or setup findings that report Telegram shared-room readiness, including whether bot-to-bot mode is configured/unknown and which fallbacks remain available.
- [x] 1.3 Document safe setup for test groups with multiple dedicated machine bots and bot privacy mode/bot-to-bot settings.

## 2. Telegram verification coverage

- [x] 2.1 Add unit tests for Telegram bot-authored group updates that target the local bot, target another bot, and target no bot.
- [x] 2.2 Add integration tests that verify bot-to-bot/shared-room messages reuse only authorized pairings or trusted bot identities and do not expose private sessions across users/bots.
- [x] 2.3 Add loop-prevention tests so PiRelay ignores its own bot messages and does not create bot feedback loops.
- [x] 2.4 Add optional live Telegram E2E smoke test or manual checklist gated by environment variables for two bot tokens and one test group.

## 3. Shared-room parity inventory

- [x] 3.1 Create a checked-in parity matrix or diagnostic covering Telegram, Discord, and Slack shared-room capabilities and limitations.
- [x] 3.2 Add tests that assert each adapter's declared shared-room capabilities match documented behavior.
- [x] 3.3 Add setup/doctor output that names reliable command surfaces per platform: Telegram `/command@bot`, Discord `relay <command>`/mentions, Slack app mention/channel command fallback.

## 4. Discord gap closure

- [x] 4.1 Inventory current Discord shared-room runtime behavior against the parity matrix.
- [x] 4.2 Add or extend tests for Discord guild-channel shared-room routing, non-target silence, active selection, unauthorized rejection, and command fallback wording.
- [x] 4.3 Update Discord setup/doctor docs for any missing scopes, intents, channel permissions, and slash-command collision caveats.

## 5. Slack gap closure

- [x] 5.1 Inventory Slack runtime gaps for channel/app-mention shared-room support versus adapter declarations.
- [x] 5.2 Implement Slack shared-room pre-routing for enabled channel contexts, or explicitly mark unsupported cases in capabilities/diagnostics.
- [x] 5.3 Add Slack tests for app mentions, channel-message gating, active selection, non-target silence, unauthorized rejection, and safe action responses.
- [x] 5.4 Update Slack setup/doctor guidance with required scopes/event subscriptions, channel membership, Socket Mode/webhook caveats, and safe defaults.

## 6. Validation

- [x] 6.1 Run unit/integration tests for Telegram, Discord, Slack, setup, and shared-room core paths.
- [x] 6.2 Run optional Telegram live E2E only when disposable credentials are configured. (No disposable live credentials configured; manual checklist added instead.)
- [x] 6.3 Run `openspec validate harden-messenger-shared-room-parity --strict`.
