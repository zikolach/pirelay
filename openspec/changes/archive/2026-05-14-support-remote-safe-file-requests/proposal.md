## Why

PiRelay's current file delivery feature only works as a local Pi slash command, so a remote authorized user can ask for a file in Telegram/Discord/Slack only by hoping the assistant manually finds another execution path. This breaks the remote-control promise of PiRelay and makes safe artifact delivery feel unreliable even though the adapters can already upload documents.

## What Changes

- Add a remote safe file request flow for authorized paired messenger users, so they can request workspace-relative files from the active/targeted online Pi session.
- Support explicit remote command forms such as `/send-file <relative-path> [caption]`, `relay send-file <relative-path> [caption]`, and `pirelay send-file <relative-path> [caption]`, scoped to the requesting conversation and selected session.
- Add an assistant-callable relay file delivery action/tool so natural-language requests like “send me `openspec/.../proposal.md` as a file” can deliver the file without launching a separate Pi process or requiring local slash-command access.
- Reuse the existing safe workspace file validation, MIME allow-list, size limits, adapter document/image upload contracts, and no-file-bytes-persisted rule.
- Keep the safety boundary explicit: only authorized paired users can request files; paths remain workspace-relative and validated; hidden paths, traversal, symlink escapes, directories, unsupported types, and oversized files are refused before upload.
- Preserve local `/relay send-file ...` for local push-to-messenger workflows, while adding remote requester-scoped delivery as a separate first-class path.
- Update help text, docs, tests, and parity expectations so remote `send-file` is documented as supported when file delivery is enabled instead of being rejected as arbitrary download.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `relay-file-delivery`: Remote authorized users and assistant actions can request safe workspace-relative file delivery to the requesting bound conversation, with the same validation guarantees as local send-file.
- `messenger-relay-sessions`: Remote prompt/command source context is preserved so assistant-triggered file delivery targets the originating messenger conversation or an explicitly addressed selected session safely.
- `relay-channel-adapters`: Telegram, Discord, and Slack adapters expose remote file-request command parity and send normalized document/image payloads back to the requesting conversation/thread.
- `relay-interaction-middleware`: The shared interaction pipeline can classify authorized remote file requests as internal safe file-delivery actions rather than ordinary prompts or unsupported commands.

## Impact

- Affected code: remote command parsing/dispatch in `extensions/relay/adapters/*/runtime.ts`, shared command definitions in `extensions/relay/commands/remote.ts`, file helpers in `extensions/relay/core/file-delivery.ts`, local/runtime delivery helpers in `extensions/relay/runtime/extension-runtime.ts`, and adapter document/image delivery paths.
- New extension API surface: likely a PiRelay custom tool or internal action callable by the assistant for safe file delivery to the latest authorized remote prompt source.
- Tests: add unit and runtime tests for explicit remote commands, natural-language assistant tool delivery, authorization, selected-session routing, requester-only delivery, unsafe paths, missing files, unsupported/oversized files, paused/offline bindings, and Telegram/Discord/Slack parity.
- Security: no bot tokens, file bytes, upload URLs, hidden prompts, tool internals, or full transcripts are persisted; remote delivery remains authorization-first and workspace-bounded.
- Dependencies: no new runtime npm dependencies expected.
