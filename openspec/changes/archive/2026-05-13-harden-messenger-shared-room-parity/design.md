## Context

Telegram's May 7, 2026 announcement adds Bot-to-Bot Communication: bots may send messages to or reply to other bots when both bots enable the feature. The Bot API changelog also says messages can be sent to other bots via username if both bots enable bot-to-bot communication, and business bots can reply to other bots when enabled.

PiRelay's existing no-federation shared-room design already puts one dedicated machine bot per broker into the same messenger room. Before this Telegram update, the reliable Telegram fallback was user-addressed commands such as `/sessions@machine_bot`, because bots normally did not talk to each other and group privacy could hide ordinary text. The new Telegram feature may make automated bot-to-bot workflows and verification possible, but it is opt-in on both bots and still has platform limits.

Discord and Slack have different constraints:

- Discord: live runtime exists; guild-channel shared-room behavior is intentionally gated by `allowGuildChannels`, allowed guild ids, shared-room enablement, message content intent, and reliable `relay <command>` text-prefix or mention forms.
- Slack: adapter operations, capabilities, signed webhooks/socket mode, allow-list checks, and mention parsing exist; a Discord-like shared-room runtime pre-routing path is not clearly implemented yet.

## Goals

- Make Telegram Bot-to-Bot Communication Mode an explicit documented PiRelay shared-room capability.
- Test Telegram bot-authored inbound events safely so future regressions do not break bot-to-bot shared rooms.
- Provide optional real-platform E2E smoke tests or a documented manual smoke checklist for Telegram groups when bot credentials are supplied.
- Produce a concrete feature inventory for Telegram, Discord, and Slack rather than relying on assumptions.
- Close Slack shared-room runtime gaps or mark unsupported behaviors with explicit diagnostics and tests.

## Non-Goals

- Do not weaken authorization to let arbitrary bots inject prompts.
- Do not require Telegram bot-to-bot communication for the existing privacy-mode `/command@bot` user workflow.
- Do not enable Discord guild-channel or Slack channel control by default.
- Do not create broker federation in this change.
- Do not depend on live platform credentials for the normal unit/integration test suite.

## Design Decisions

1. **Bot-to-bot is an additional Telegram capability, not a replacement.**
   - Existing user-driven `/sessions@bot`, `/use@bot`, and `/to@bot` flows remain the reliable privacy-mode fallback.
   - Bot-authored events are accepted only when explicitly configured/authorized and explicitly targeted to the local machine bot.

2. **Authorization must distinguish human users, trusted bot identities, and local machine bots.**
   - PiRelay should not treat every Telegram bot author as a trusted user.
   - Tests should cover allowed bot identities, disallowed bot identities, and non-target bots staying silent.

3. **E2E tests are opt-in.**
   - Normal CI uses mocked adapters/runtimes.
   - Live Telegram E2E can run only when required environment variables point to disposable test bots and a test group.
   - E2E output must redact tokens and avoid hidden prompts/transcripts.

4. **Parity inventory is a deliverable, not just implementation work.**
   - A checked-in doc or generated diagnostic should list each messenger's support for private chats, shared rooms, ordinary text, mentions, replies, platform commands, media, buttons, activity, command fallback, authorization, and E2E status.

5. **Slack should fail explicitly where incomplete.**
   - If Slack channel/app-mention shared-room pre-routing is not implemented in this change, setup and doctor output must say so instead of implying parity.
   - If implemented, tests should mirror Discord shared-room cases: local target routes, remote target silence, active selection, unauthorized rejection, and channel disabled rejection.

## Risks / Trade-offs

- Telegram bot-to-bot behavior is new and may have BotFather or API-level setting propagation delays.
- Allowing bot-authored messages increases loop risk; tests and runtime logic must avoid bot feedback loops and self-bot messages.
- Slack has multiple inbound surfaces (events, app mentions, slash commands, interactions); implementing all parity in one change may be too large, so the inventory must identify any deferred items precisely.
- Discord and Slack channel contexts are multi-user spaces; defaults must remain conservative.
