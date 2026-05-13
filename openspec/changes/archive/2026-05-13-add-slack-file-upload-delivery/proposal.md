## Why

PiRelay currently treats file delivery as a set of messenger-specific escape hatches: Telegram can offer a Markdown download for full output, Discord can send image attachments, and Slack only recently gained a narrow image upload path. This is confusing because the product requirement is broader: a local Pi user should be able to send an explicit artifact/file to paired messenger conversations, and final answer delivery should behave consistently across Telegram, Discord, and Slack.

## What Changes

- Introduce messenger-neutral outbound file/artifact delivery semantics for local Pi-initiated sends to Telegram, Discord, Slack, and future adapters.
- Add a local `/relay send-file ...` command surface for explicit workspace-relative file delivery to one messenger instance, the active/bound conversation for that session, or every eligible bound messenger conversation.
- Preserve strict safety boundaries: local file delivery is local-user initiated; remote messenger users cannot request arbitrary workspace files through this generic path.
- Keep and complete Slack live file upload support using Slack's external upload flow so Slack can participate in shared file/image delivery.
- Unify final output delivery policy across messengers:
  - quiet mode sends a short completion/summary and points to `/full` or a downloadable file/action;
  - normal and verbose modes send the full final output as message chunks where feasible;
  - completion-only sends terminal output without progress noise.
- Refactor Telegram's “Download .md” full-output workaround into the shared artifact/file delivery model, then expose equivalent fallback behavior for Discord and Slack where platform capabilities allow.
- Update setup guidance, app manifests, docs, diagnostics, and parity tests for file upload permissions and behavior.
- No breaking changes to existing `/images`, `/send-image`, `/full`, or progress-mode commands.

## Capabilities

### New Capabilities

- `relay-file-delivery`: Messenger-neutral explicit local file/artifact delivery, safe target selection, and file validation semantics.

### Modified Capabilities

- `slack-relay-adapter`: Slack live runtime SHALL support safe outbound file/image delivery through Slack where scopes and platform APIs allow it.
- `messenger-relay-sessions`: Final output and artifact retrieval SHALL follow shared mode-aware delivery semantics across Telegram, Discord, Slack, and future messengers.
- `relay-channel-adapters`: Adapter capability declarations SHALL match live operation availability and every first-class adapter SHALL expose document/file delivery or explicit capability-gated limitations.
- `relay-configuration`: Slack setup, manifests, and diagnostics SHALL document `files:write` as required for outbound file delivery.

## Impact

- Affected code: `extensions/relay/runtime/extension-runtime.ts`, `extensions/relay/commands/remote.ts`, `extensions/relay/adapters/*`, `extensions/relay/core/channel-adapter.ts`, Slack setup/config docs and manifests, messenger parity tests.
- Slack app scopes: existing Slack apps must add `files:write` and reinstall to send files/images.
- APIs: Slack uses `files.getUploadURLExternal` and `files.completeUploadExternal`, plus upload to Slack's returned upload URL. Telegram and Discord continue to use their existing document/file APIs through shared contracts.
- State: no file contents are persisted; at most safe audit metadata may record that a local artifact was sent.
- Security: local `/relay send-file` may read workspace-relative files after validation; remote messenger commands MUST NOT gain arbitrary file read capability.
- No new runtime npm dependencies are expected.
