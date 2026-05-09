## Context

PiRelay v0.3.0 supports the isolated shared-room topology conceptually, and Telegram privacy mode can deliver bot-addressed slash commands such as `/sessions@mini_builder_bot` to the named bot. However, Telegram pairing is currently limited to private chats. The runtime stores Telegram bindings with the private chat id and user id, while group commands search only for bindings attached to the group chat id. As a result, two correctly paired Telegram bots in the same group both receive addressed `/sessions@bot` commands but report that no paired sessions exist.

This is a Telegram-specific gap in the bridge between private authorization and shared-room group control.

## Goals / Non-Goals

**Goals:**

- Let an already paired Telegram user control that same machine from a shared group using privacy-compatible addressed bot commands.
- Keep private-chat pairing as the authorization source of truth.
- Scope group active selections by Telegram group conversation id and Telegram user id.
- Ensure only the addressed bot responds to `/sessions@bot`, `/use@bot`, and `/to@bot` in groups.
- Keep unaddressed group behavior conservative when privacy mode prevents ordinary text delivery.

**Non-Goals:**

- Do not implement Telegram group `/start` pairing; pairing remains private-chat only.
- Do not make one bot aggregate sessions from other machine bots.
- Do not require disabling Telegram privacy mode for addressed command workflows.
- Do not introduce broker federation or shared bot tokens.

## Decisions

1. **Private binding as authorization proof**
   - For Telegram group messages, the runtime should look for active, non-revoked bindings for the same Telegram user across private chats owned by the local bot.
   - Rationale: Telegram user ids are stable across private and group chats, while chat ids differ. The private pairing already completed local confirmation/trust checks.
   - Alternative rejected: require each group to be paired separately. Current pairing explicitly refuses non-private chats, and group pairing creates noisier security UX.

2. **Group active selections are separate from Telegram binding records**
   - `/use@bot <session>` in a group should persist a `channel=telegram`, `conversationId=<group id>`, `userId=<telegram user id>` active selection to the selected local session.
   - It should not rewrite the private-chat binding's `chatId`, because notifications and DM behavior should remain intact.
   - Alternative rejected: clone bindings into the group chat. That conflates authorization with routing state and risks sending future notifications to unintended rooms.

3. **Addressed slash commands are the primary privacy-compatible syntax**
   - `/sessions@BotUserName`, `/use@BotUserName <session>`, and `/to@BotUserName <session> <prompt>` should be treated as explicit local targets only by the bot whose username matches the suffix.
   - The parser should keep existing `/sessions`, `/use`, and `/to` behavior for direct/private chats.
   - Alternative considered: mention-prefix text like `@bot relay sessions`. Telegram privacy mode usually does not deliver those messages, so support can be best-effort only and must not be the main path.

4. **Safe silence for non-targets and unaddressed group events**
   - If a Telegram group event is not explicitly addressed to the local bot and is not otherwise known to target a local active selection, the bot should remain silent.
   - This prevents both bots from answering and avoids leaking session existence in unrelated groups.

## Risks / Trade-offs

- **Risk: private pairing reuse grants group control in groups where the user did not intend to use PiRelay** → Mitigation: only respond to commands explicitly addressed to that exact bot username, and keep ordinary unaddressed group text disabled unless shared-room visibility/routing explicitly supports it.
- **Risk: output destination confusion between DM and group** → Mitigation: use group active-selection records for group-originated prompts while preserving private binding records for DM-originated prompts and existing notification preferences.
- **Risk: username changes or missing bot username** → Mitigation: refresh local bot identity via `getMe()` at startup and fall back to conservative no-target behavior if the command suffix cannot be matched.
- **Risk: multiple private sessions for the same user** → Mitigation: `/sessions@bot` lists all local sessions authorized by that user's private pairings; `/use@bot` and `/to@bot` require an unambiguous session selector.

## Migration Plan

- No data migration is required.
- Existing private Telegram pairings remain valid.
- After deployment, users can invite multiple machine bots to a group and use `/sessions@bot` directly without re-pairing in the group.
- Rollback returns to current behavior where group commands cannot see private-chat sessions.

## Open Questions

- Should `/help@bot` in a Telegram group show shared-room-specific syntax when shared-room mode is enabled? Recommended: yes, but it can be implemented as documentation/help text only.
