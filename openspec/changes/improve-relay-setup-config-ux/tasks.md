## 1. Setup metadata and snippets

- [x] 1.1 Define shared setup env binding metadata for Telegram, Discord, and Slack with env names, recognizable sample placeholders, parsing kind, required flags, and target config fields, including Slack App ID for App Home links.
- [x] 1.2 Refactor existing env snippet generation to use the shared metadata and keep placeholder values secret-safe.
- [x] 1.3 Add parity tests that each messenger's snippet and writer metadata use the same env variables.

## 2. Config-from-env helpers

- [x] 2.1 Implement a pure helper that computes a canonical `messengers.<kind>.default` config patch from defined env vars without including secret values.
- [x] 2.2 Implement parsing for non-secret string, string-list, and boolean env bindings with missing-required reporting.
- [x] 2.3 Implement safe config merge behavior that preserves unrelated config and leaves fields unchanged when env vars are absent.
- [x] 2.4 Implement file write support with parent directory creation, timestamped backup for existing config, pretty JSON output, and owner-only permissions.
- [x] 2.5 Add unit tests for new-file writes, existing-config merge, backup creation, chmod behavior where supported, missing env handling, and secret-safe result summaries.

## 3. Setup wizard actions

- [x] 3.1 Extend the setup wizard model with explicit action entries for copy env snippet to clipboard and write config from env.
- [x] 3.2 Update the TUI screen to use tab-like navigation, keep selected tab content isolated, expose actions only in the footer line with consistent keyboard semantics across Telegram, Discord, and Slack, show Slack App Home QR/troubleshooting guidance when App ID is available, and provide a copyable Slack app manifest tab/action.
- [x] 3.3 Wire the copy action through `/relay setup` so the selected messenger's env snippet is copied to the clipboard with Pi editor fallback, the wizard remains open after copying, and user-facing messages describe the actual behavior.
- [x] 3.4 Wire the write action through `/relay setup` with confirmation, missing-required-env handling, secret-safe notifications, and config cache refresh after success.
- [x] 3.5 Preserve headless/no-UI fallback behavior and ensure it never writes config implicitly.
- [x] 3.6 Highlight Discord/Slack pairing commands in QR dialogs, add a copy-command shortcut, use short mobile-friendly Slack PIN pairing, and guide users to choose DM QR/link pairing or direct channel pairing.
- [x] 3.7 Add Slack reaction-based thinking indicators with thread-aware ephemeral fallback, channel-binding recovery after pairing, safer pairing command parsing, and local pairing notifications.

## 4. Runtime and integration tests

- [x] 4.1 Add setup wizard model/render tests proving all supported messengers expose the same setup action classes.
- [x] 4.2 Add runtime tests for copy-to-clipboard behavior across Telegram, Discord, and Slack, including fallback when clipboard tools are unavailable.
- [x] 4.3 Add runtime tests for write-config-from-env success, cancel, and missing-required-env paths.
- [x] 4.4 Add tests proving written config does not contain resolved bot tokens, signing secrets, app tokens, pairing codes, hidden prompts, tool internals, or transcripts.
- [x] 4.5 Add Slack adapter/runtime regression tests for non-slash pairing, status command parsing, channel command routing after pairing, thread-aware activity fallback, and reaction cleanup.

## 5. Validation and documentation

- [x] 5.1 Update setup documentation/help text to describe copy-to-clipboard and write-config-from-env actions consistently across messengers.
- [x] 5.2 Run `npm run typecheck`.
- [x] 5.3 Run `npm test`.
- [x] 5.4 Run `openspec validate improve-relay-setup-config-ux --strict`.
