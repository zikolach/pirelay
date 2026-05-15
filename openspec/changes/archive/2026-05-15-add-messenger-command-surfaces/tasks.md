## 1. Command Surface Metadata

- [x] 1.1 Add pure command-surface helpers derived from `CANONICAL_REMOTE_COMMANDS` for Telegram, Discord, and Slack metadata.
- [x] 1.2 Implement platform name/description sanitization, length bounds, alias handling, and collision checks without changing command semantics.
- [x] 1.3 Add unit tests proving generated metadata contains implemented canonical commands and excludes or maps aliases intentionally.
- [x] 1.4 Update help/setup copy to reference generated metadata or shared constants where practical.

## 2. Telegram Command Menu

- [x] 2.1 Extend the Telegram API client with a secret-safe BotCommand registration operation.
- [x] 2.2 Register Telegram menu commands after bot setup validation during runtime startup, with non-fatal failure handling.
- [x] 2.3 Map Telegram-safe menu names back to canonical command handlers, using registry-backed aliases such as existing `sendfile` and a new `sendimage` alias or explicit underscore forms such as `send_image`.
- [x] 2.4 Add Telegram runtime tests for menu registration success, registration failure continuing startup, and sanitized command parsing.
- [x] 2.5 Add authorization/regression tests showing menu-originated commands do not bypass pairing, revocation, pause, or shared-room targeting checks.

## 3. Discord Native `/relay` Surface

- [x] 3.1 Add Discord native command metadata for one namespaced `/relay` command with supported canonical subcommands or equivalent grouped options.
- [x] 3.2 Implement Discord live-client registration/sync with bounded, non-fatal startup behavior and secret-safe diagnostics.
- [x] 3.3 Normalize Discord native chat-input interactions into existing `relay <command>` command routing.
- [x] 3.4 Preserve and document `relay <command>` text-prefix commands as the reliable Discord fallback when native sync is unavailable.
- [x] 3.5 Add Discord tests for metadata parity, interaction normalization, sync failure behavior, and authorization before command execution.

## 4. Slack `/relay` Slash Surface

- [x] 4.1 Add Slack `/relay` command metadata and usage text for generated setup and manifest content.
- [x] 4.2 Extend the Slack app manifest generator to include `/relay`, interactivity settings, safe description, and usage hint without secrets.
- [x] 4.3 Normalize Slack Socket Mode slash-command payloads into existing Slack command routing after Socket Mode envelope acknowledgement.
- [x] 4.4 Normalize signed Slack webhook slash-command payloads when webhook mode is enabled, rejecting invalid signatures before routing.
- [x] 4.5 Use response URL or ephemeral requester-scoped acknowledgements where available without changing protected output delivery semantics.
- [x] 4.6 Add Slack tests for manifest content, slash payload routing, signature rejection, requester scoping, and authorization before command execution.

## 5. Documentation and Setup UX

- [x] 5.1 Update `README.md`, `docs/adapters.md`, `docs/config.md`, and relevant setup/testing docs with Telegram menu, Discord `/relay`, and Slack `/relay` guidance.
- [x] 5.2 Update setup wizard Slack manifest panel and troubleshooting copy to explain reinstall/update requirements for `/relay`.
- [x] 5.3 Ensure Discord and Slack docs continue to recommend reliable text fallbacks first for shared-room or unsynced native-command contexts.
- [x] 5.4 Add or update smoke checklist entries for validating command menus/slash surfaces without exposing secrets.

## 6. Validation

- [x] 6.1 Run `npm run typecheck`.
- [x] 6.2 Run `npm test`.
- [x] 6.3 Run `openspec validate add-messenger-command-surfaces --strict`.
- [x] 6.4 Review changed files for unrelated edits and secret leakage before preparing the implementation PR.
