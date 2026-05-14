## MODIFIED Requirements

### Requirement: Remote users cannot request arbitrary local files
PiRelay SHALL allow authorized paired messenger users to request bounded safe workspace-relative files through the generic file-delivery capability, while still refusing arbitrary local filesystem access and unsafe paths.

#### Scenario: Authorized remote user sends safe send-file command
- **WHEN** an authorized Telegram, Discord, Slack, or future messenger user sends `/send-file docs/report.md`, `relay send-file docs/report.md`, `pirelay send-file docs/report.md`, or an equivalent remote file request for a supported file inside the selected session's workspace
- **THEN** PiRelay validates the selected route, requester binding, file path, type, and size before reading or uploading the file
- **AND** sends the file only to the requesting bound conversation or thread through the active messenger adapter

#### Scenario: Unauthorized remote user sends send-file command
- **WHEN** an unpaired, revoked, disallowed, or otherwise unauthorized platform user sends a remote file request
- **THEN** PiRelay refuses the request before path resolution, file read, media download, or messenger upload
- **AND** returns only safe authorization guidance when the platform permits a response

#### Scenario: Remote unsafe path is rejected
- **WHEN** an authorized remote user requests `../secret.txt`, an absolute path, a hidden path, a directory, a symlink escape, a missing file, an unsupported file type, or an oversized file
- **THEN** PiRelay rejects the request before calling any messenger upload API
- **AND** returns a safe actionable error without exposing absolute filesystem paths, tokens, hidden prompts, or file bytes

#### Scenario: Remote request cannot target arbitrary destinations
- **WHEN** an authorized remote user includes a messenger target, raw chat id, channel id, user id, or `all` fan-out target in a remote file request
- **THEN** PiRelay ignores or rejects that destination input
- **AND** limits delivery to the authorized requesting conversation for the selected session

#### Scenario: Remote image command remains bounded
- **WHEN** an authorized remote user invokes `pirelay send-image <relative-image-path>` or an equivalent platform form
- **THEN** PiRelay applies the existing image-only path, MIME, size, and workspace safety checks before delivery
- **AND** does not broaden that command into unrestricted arbitrary file download

## ADDED Requirements

### Requirement: Assistant can deliver requested files to the originating remote requester
PiRelay SHALL provide an assistant-callable safe file-delivery action that sends validated workspace files to the latest authorized remote requester for the active turn.

#### Scenario: Assistant sends file requested in remote prompt
- **WHEN** an authorized remote user asks the assistant to send `openspec/changes/foo/proposal.md` as a file and the assistant invokes the relay file-delivery action with that relative path
- **THEN** PiRelay validates the path, type, size, requester context, and active binding
- **AND** sends the file to the originating messenger conversation or thread without requiring a separate local `/relay send-file` command

#### Scenario: Assistant file action has no remote requester
- **WHEN** the assistant invokes the relay file-delivery action in a local-only turn or a turn whose remote requester context is unavailable, ambiguous, revoked, paused, or stale
- **THEN** PiRelay refuses delivery
- **AND** returns guidance to use local `/relay send-file ...` or re-request the file from an authorized messenger conversation

#### Scenario: Assistant file action does not expose internals
- **WHEN** the assistant file-delivery action completes, fails validation, or encounters an adapter upload failure
- **THEN** its tool result and local audit output include only safe delivery status, relative path, target messenger label, and redacted error information
- **AND** they do not include bot tokens, upload URLs, raw hidden prompts, file bytes, or full transcript content
