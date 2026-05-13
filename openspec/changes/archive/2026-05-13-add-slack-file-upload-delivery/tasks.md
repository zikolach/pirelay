## 1. Slack Upload Operations

- [x] 1.1 Implement Slack external upload URL request, byte upload, and completion flow in live operations.
- [x] 1.2 Validate Slack upload API response shapes and produce secret-safe errors for malformed, permission-denied, or failed responses.
- [x] 1.3 Preserve caption and thread timestamp metadata through `SlackUploadFilePayload` and file completion.
- [x] 1.4 Add live-client unit tests for successful upload, Slack API failure, upload URL HTTP failure, and malformed responses.

## 2. Slack Runtime Image/File Commands

- [x] 2.1 Replace Slack runtime hard-coded `/images` and `/send-image` limitation with latest-image retrieval and safe explicit path delivery.
- [x] 2.2 Reuse shared route image actions and outbound validation so unsafe paths, unsupported MIME types, and oversized images are rejected before upload.
- [x] 2.3 Keep Slack channel/thread delivery scoped to authorized active bindings and preserve originating thread context.
- [x] 2.4 Add runtime tests for `pirelay images`, `pirelay send-image <path>`, no-images guidance, partial skips, and upload failure guidance.

## 3. Local Messenger-Neutral File Delivery

- [x] 3.1 Add shared local file loading and validation helpers for workspace-relative document/image delivery.
- [x] 3.2 Add local `/relay send-file <messenger|messenger:instance|all> <relative-path> [caption]` parsing and help text.
- [x] 3.3 Resolve send-file destinations from the current session's active non-revoked, non-paused Telegram/Discord/Slack bindings without exposing raw ids in normal UX.
- [x] 3.4 Send normalized document/image payloads through Telegram, Discord, and Slack adapters with per-adapter size/type checks.
- [x] 3.5 Add local command integration tests for single messenger target, instance target, all target, missing binding, paused binding, unsafe path, unsupported type, and oversized file.

## 4. Unified Final Output Delivery Policy

- [x] 4.1 Extract shared final-output delivery policy for quiet, normal, verbose, and completion-only modes.
- [x] 4.2 Implement paragraph-aware message chunking with bounded chunk counts before document fallback.
- [x] 4.3 Refactor Telegram full-output Markdown download to use shared document delivery semantics.
- [x] 4.4 Add Discord and Slack document fallback for full output when chunking would exceed safe limits.
- [x] 4.5 Add parity tests covering final output in quiet, normal, verbose, and completion-only modes across Telegram, Discord, and Slack where practical.

## 5. Capabilities, Setup, and Documentation

- [x] 5.1 Align Slack adapter/runtime capability behavior so declared file/image support matches live upload availability and failure fallbacks.
- [x] 5.2 Add `files:write` to generated Slack manifests and checked-in live-test manifests.
- [x] 5.3 Update Slack setup checklist/guidance, config docs, adapter docs, live integration docs, and testing docs with file upload scope and reinstall instructions.
- [x] 5.4 Add or update tests covering Slack setup manifest/guidance changes.
- [x] 5.5 Update README/docs for local `/relay send-file`, generic remote file restrictions, and mode-aware final-output behavior.

## 6. Validation

- [x] 6.1 Run `npm run typecheck` for current Slack upload implementation.
- [x] 6.2 Run targeted Slack adapter/runtime/setup tests for current Slack upload implementation.
- [x] 6.3 Run `npm test` for current Slack upload implementation.
- [x] 6.4 Run `openspec validate add-slack-file-upload-delivery --strict` for the initial Slack upload scope.
- [x] 6.5 Re-run `npm run typecheck` after messenger-neutral file delivery and final-output policy changes.
- [x] 6.6 Re-run targeted file-delivery/final-output tests.
- [x] 6.7 Re-run `npm test`.
- [x] 6.8 Re-run `openspec validate add-slack-file-upload-delivery --strict`.
