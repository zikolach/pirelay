## Context

Discord and Slack both offer official bot/app APIs, file upload, interaction buttons, and direct messages. They are therefore better first multi-channel targets than Signal, which lacks a comparable official bot API. This change should build on the adapter architecture instead of duplicating Telegram runtime logic.

## Goals / Non-Goals

**Goals:**
- Support Discord DMs for personal/dev-community usage.
- Support Slack app DMs for team/workspace usage.
- Reuse core PiRelay features: pairing, authorization, prompt delivery, full output, images/documents, guided answers, progress/dashboard, and approvals where implemented.
- Keep channel secrets separate and documented.

**Non-Goals:**
- Public Discord server channels or Slack channels by default.
- Multi-user collaborative control policies beyond existing authorization/allow-list rules.
- Supporting every Slack Block Kit or Discord interaction feature.
- Implementing Signal.

## Decisions

1. **DM-first scope.**
   Start with private direct messages to keep authorization, privacy, and UX close to Telegram. Channel/server support can be a later proposal.

2. **Separate config namespaces.**
   Use channel-specific config keys such as `discord.botToken`, `slack.botToken`, `slack.signingSecret`, and channel-specific allow-lists. Avoid overloading Telegram config.

3. **Pairing follows each platform's norms.**
   Discord can use bot DM commands and generated pairing codes/links. Slack may use app home/DM commands and OAuth or bot-token setup, depending on chosen distribution model.

4. **Use platform-native actions conservatively.**
   Map PiRelay buttons to Discord components and Slack Block Kit buttons, with text fallbacks when interactions fail.

5. **Do not auto-enable team channels.**
   For Slack workspaces and Discord servers, default to DMs and reject channel messages unless future policy explicitly enables them.

## Risks / Trade-offs

- Slack setup is heavier than Telegram/Discord because app installation and signing verification can be complex.
- Discord and Slack have different rate limits and file upload APIs; adapter capability limits must be accurate.
- Workspace/server identities are more complex than a single Telegram private chat; authorization must include workspace/guild context.
- Additional dependencies can increase package size and install complexity.

## Migration Plan

1. Confirm adapter core is available and stable.
2. Implement Discord DM adapter with text, buttons, status, full output, and files/images.
3. Implement Slack DM adapter with equivalent features and setup documentation.
4. Add broker/channel routing for multiple enabled adapters.
5. Add end-to-end smoke-test docs for both platforms.
