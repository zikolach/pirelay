## 1. Telegram command targeting and authorization

- [x] 1.1 Add tests proving `/sessions@<local-bot-username>` in a Telegram group lists sessions paired in private chat for the same Telegram user.
- [x] 1.2 Add tests proving `/sessions@<local-bot-username>` in a Telegram group does not list sessions for an unpaired Telegram user.
- [x] 1.3 Add tests proving `/sessions@<other-bot-username>` and unaddressed group `/sessions` do not make the local bot respond in shared-room/privacy-mode scenarios.
- [x] 1.4 Extend Telegram command parsing to preserve the optional `@botusername` command suffix and classify whether it targets the local bot.
- [x] 1.5 Load and cache the local Telegram bot username from `getMe()` so runtime routing can compare addressed command suffixes safely.

## 2. Private-pairing reuse for group sessions

- [x] 2.1 Add a store/runtime helper that returns active non-revoked Telegram bindings for a Telegram user id regardless of chat id, filtered to local online routes.
- [x] 2.2 Update Telegram group `/sessions@bot` handling to list sessions from the same user's private-chat bindings instead of only `groupChatId + userId` bindings.
- [x] 2.3 Ensure the group sessions list includes normal online/offline/busy/paused/active markers and does not expose raw internal session keys unnecessarily.
- [x] 2.4 Return private-chat pairing guidance when an explicitly addressed group command has no private pairing for that Telegram user.

## 3. Group active selection and prompt routing

- [x] 3.1 Add failing tests for `/use@bot <session>` in a group selecting a private-paired local session for that group/user only.
- [x] 3.2 Add failing tests showing private-chat active selection remains independent after group `/use@bot`.
- [x] 3.3 Implement group active selection persistence via channel active-selection records keyed by `telegram`, group conversation id, and Telegram user id.
- [x] 3.4 Add failing tests for `/to@bot <session> <prompt>` in a group injecting one prompt into a private-paired local session without changing active selection.
- [x] 3.5 Implement group `/to@bot` prompt injection and make acknowledgements/completions target the originating group conversation.

## 4. Safe silence and Telegram privacy-mode UX

- [x] 4.1 Ensure unaddressed Telegram group messages remain silent unless a future visibility-aware rule explicitly permits local active-selection routing.
- [x] 4.2 Update Telegram shared-room help/docs to advertise privacy-compatible commands: `/sessions@bot`, `/use@bot <session>`, and `/to@bot <session> <prompt>`.
- [x] 4.3 Add regression tests for two fake Telegram machine bots in the same group where only the addressed bot responds.

## 5. Validation

- [x] 5.1 Run focused Telegram runtime/adapter tests.
- [x] 5.2 Run `npm run typecheck`.
- [x] 5.3 Run `npm test`.
- [x] 5.4 Run `openspec validate fix-telegram-shared-room-private-bindings --strict`.
- [x] 5.5 Run `openspec validate --all --strict`.
