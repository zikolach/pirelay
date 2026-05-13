# relay-file-delivery Specification

## Purpose
Relay file delivery defines messenger-neutral, local-user-initiated delivery of safe workspace files and final-output artifacts, including target selection, file validation, adapter size limits, upload behavior, and Markdown document fallback policy.

## Requirements
### Requirement: Local users can deliver explicit files to paired messengers
PiRelay SHALL allow the local Pi user to send an explicit safe workspace-relative file to active paired messenger conversations through a messenger-neutral local command.

#### Scenario: Local user sends file to one messenger
- **WHEN** the local Pi user invokes `/relay send-file slack <relative-path>` for a file inside the current workspace and the current session has an active non-paused Slack binding
- **THEN** PiRelay validates the file path, type, and size
- **AND** sends the file through the Slack adapter to that session's active Slack conversation

#### Scenario: Local user sends file to all messengers
- **WHEN** the local Pi user invokes `/relay send-file all <relative-path>` and the current session has active non-paused Telegram, Discord, and Slack bindings
- **THEN** PiRelay sends the validated file to every eligible bound messenger conversation
- **AND** reports a safe summary of delivered and skipped messenger targets locally

#### Scenario: Messenger instance is selected
- **WHEN** the local Pi user invokes `/relay send-file slack:work <relative-path>`
- **THEN** PiRelay resolves the `slack:work` messenger instance and sends only to the active binding for that instance
- **AND** it does not send to other Slack instances or other messengers

#### Scenario: No binding exists for selected target
- **WHEN** the local Pi user invokes `/relay send-file discord <relative-path>` but the current session has no active Discord binding
- **THEN** PiRelay does not send the file
- **AND** reports that the selected messenger is not paired for the current session

### Requirement: Local file delivery validates workspace files safely
PiRelay SHALL validate local files before any messenger upload and SHALL NOT persist file contents in relay state.

#### Scenario: Unsafe file path is rejected
- **WHEN** the local Pi user invokes `/relay send-file slack ../secret.txt`, an absolute path, a hidden path, a directory, a symlink escape, or a missing file
- **THEN** PiRelay rejects the request before calling any messenger API
- **AND** returns a safe actionable local error

#### Scenario: Oversized file is rejected
- **WHEN** the requested file exceeds the configured outbound document or image limit for the target messenger adapter
- **THEN** PiRelay rejects or skips that target before upload
- **AND** reports the target-specific size limitation locally

#### Scenario: Unsupported file type is rejected
- **WHEN** the requested file type cannot be safely identified or the target messenger adapter does not support that file type
- **THEN** PiRelay rejects or skips delivery for that target with a clear limitation message

#### Scenario: File contents are not persisted
- **WHEN** PiRelay sends a local file to any messenger
- **THEN** relay state and session metadata do not persist the file bytes, upload URLs, bot tokens, signing secrets, or hidden prompt data

### Requirement: Remote users cannot request arbitrary local files
PiRelay SHALL NOT allow remote messenger users to retrieve arbitrary workspace files by path through the generic local file-delivery capability.

#### Scenario: Remote user sends generic send-file command
- **WHEN** an authorized Slack, Discord, Telegram, or future messenger user sends `pirelay send-file <path>` or an equivalent generic file path command
- **THEN** PiRelay refuses the generic arbitrary file request
- **AND** explains the supported safe alternatives such as `pirelay images`, `pirelay send-image <relative-image-path>`, or `/full` for latest assistant output

#### Scenario: Remote image command remains bounded
- **WHEN** an authorized remote user invokes `pirelay send-image <relative-image-path>`
- **THEN** PiRelay applies the existing image-only path, MIME, size, and workspace safety checks before delivery
- **AND** does not broaden that command into arbitrary file download

### Requirement: Full-output document fallback is messenger-neutral
PiRelay SHALL expose full assistant output as message chunks or a downloadable Markdown document according to shared final-output policy and adapter capabilities.

#### Scenario: Quiet mode offers full output instead of spamming chat
- **WHEN** a paired session completes while a messenger binding is in quiet progress mode
- **THEN** PiRelay sends only a short completion/summary notification
- **AND** provides a command or action to retrieve the full output as chat text or a Markdown file where the adapter supports document delivery

#### Scenario: Normal mode sends full final output
- **WHEN** a paired session completes while a messenger binding is in normal progress mode
- **THEN** PiRelay sends the final assistant output to the messenger conversation as paragraph-aware message chunks when it fits within bounded chunk limits
- **AND** falls back to a Markdown document when chunking would exceed the configured safe threshold and the adapter supports document delivery

#### Scenario: Verbose mode sends progress and full final output
- **WHEN** a paired session completes while a messenger binding is in verbose progress mode
- **THEN** PiRelay sends progress updates according to verbose policy and sends the final assistant output according to the same full-output chunk/file rules as normal mode

#### Scenario: Completion-only mode sends final output without progress
- **WHEN** a paired session completes while a messenger binding is in completion-only mode
- **THEN** PiRelay suppresses non-terminal progress updates and sends the final assistant output according to the same full-output chunk/file rules as normal mode

#### Scenario: Adapter lacks document delivery
- **WHEN** full output is too large for safe message chunks and the target adapter cannot send documents
- **THEN** PiRelay returns an explicit capability limitation instead of silently truncating the output

