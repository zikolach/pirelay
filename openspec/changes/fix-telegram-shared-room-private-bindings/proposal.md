## Why

Telegram shared-room machine bots currently require sessions to be paired to the group chat itself, but Telegram pairing only works in private bot chats. With privacy mode enabled, addressed commands like `/sessions@machine_bot` reach the correct bot, yet they report no paired sessions because the runtime looks up bindings by group chat id instead of reusing the same Telegram user's private-chat pairing as authorization.

## What Changes

- Allow Telegram shared-room group commands addressed to a specific bot to use existing private-chat pairings for the same Telegram user as authorization proof.
- Add privacy-mode-compatible Telegram command forms for shared rooms, including `/sessions@bot`, `/use@bot <session>`, and `/to@bot <session> <prompt>`.
- Store group active-session selections separately from private-chat pairings so one group/user can select a machine session without mutating or stealing the DM binding.
- Keep unaddressed Telegram group commands conservative: no session listing, active selection, or prompt injection unless the event is explicitly addressed to the local bot or visibility rules make the target unambiguous.
- Preserve direct-chat behavior and existing pairing flow; no group pairing via `/start` is introduced.

## Capabilities

### New Capabilities

<!-- None. This change tightens existing shared-room and relay session behavior. -->

### Modified Capabilities

- `shared-room-machine-bots`: Adds Telegram-specific privacy-compatible addressed command behavior backed by private-chat pairings.
- `messenger-relay-sessions`: Defines how group active selections can reuse private-chat authorization without requiring sessions to be paired to the group chat id.

## Impact

- Affected code: Telegram adapter/runtime command parsing and routing, session lookup helpers, active selection persistence/use, tests, and user-facing relay documentation.
- No new dependencies are expected.
- No broker-to-broker federation or shared-token behavior is introduced.
- Existing private Telegram pairings remain valid and continue to work in DMs.
