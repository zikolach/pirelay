## 1. Discord client operations

- [x] 1.1 Confirm Discord client dependency choice, add the runtime dependency, and document why it is required.
- [x] 1.2 Implement a Discord live operations module that satisfies `DiscordApiOperations` for connect/disconnect, message send, typing, file upload, interaction acknowledgement, and attachment download.
- [x] 1.3 Add unit tests for Discord gateway/message/interaction mapping using mocked Discord client objects and no network calls.
- [x] 1.4 Add secret-safe error handling/redaction tests for Discord authentication and REST failures.

## 2. Runtime lifecycle and routing

- [x] 2.1 Wire the Discord live operations and `DiscordChannelAdapter` into the broker/runtime startup path only when Discord is enabled and a bot token is configured.
- [x] 2.2 Ensure optional Discord startup failure is reported safely without breaking configured Telegram behavior.
- [x] 2.3 Implement Discord inbound event handling for pairing commands, authorized DM text, unsupported/unauthorized events, and bot/webhook/self-message ignores.
- [x] 2.4 Persist Discord bindings with channel-qualified keys and non-secret metadata only.
- [x] 2.5 Add runtime/integration tests for Discord disabled state, startup failure, pairing success, expired/wrong-channel pairing, unauthorized user rejection, and guild-channel rejection by default.

## 3. Discord relay behavior

- [x] 3.1 Route authorized Discord DM text into the bound Pi session with idle and busy delivery behavior.
- [x] 3.2 Implement Discord DM command handling for `/status`, `/abort`, `/disconnect`, and safe unsupported-command help.
- [x] 3.3 Deliver Discord outbound text with chunking, typing activity, completion/failure notifications, and safe error responses.
- [x] 3.4 Validate and deliver Discord documents/images within configured size and MIME limits, including unsupported attachment responses.
- [x] 3.5 Implement Discord button/interaction acknowledgement behavior for current actions and stale/unauthorized actions.
- [x] 3.6 Add tests for prompt routing, busy queueing, remote controls, outbound chunking, file/image limits, and interaction acknowledgements.

## 4. Setup, docs, and validation

- [x] 4.1 Extend `/relay doctor` and `/relay setup discord` with live runtime readiness guidance, required invite scopes, Developer Portal settings, and DM troubleshooting notes.
- [x] 4.2 Update README, config docs, adapter docs, testing checklist, and skill guidance for live Discord pairing and known limitations.
- [x] 4.3 Add manual smoke-test steps for creating/inviting a Discord bot, running `/relay connect discord`, completing DM pairing, sending `/status`, sending a prompt, and disconnecting.
- [x] 4.4 Run `npm run typecheck`, `npm test`, and `openspec validate add-discord-runtime-client --strict`.
