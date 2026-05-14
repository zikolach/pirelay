## ADDED Requirements

### Requirement: Remote file requests resolve to safe internal actions
The relay interaction pipeline SHALL classify authorized remote file requests as internal file-delivery actions that run safety validation and adapter delivery without injecting the raw command as a Pi prompt.

#### Scenario: Remote send-file command is handled by middleware
- **WHEN** an authorized inbound messenger event is parsed as a `send-file <relative-path> [caption]` command
- **THEN** the pipeline resolves it to a file-delivery action for the selected route and requester context
- **AND** it does not deliver the command text to the assistant as an ordinary prompt

#### Scenario: File request authorization precedes path handling
- **WHEN** an inbound messenger event contains a file path request
- **THEN** the pipeline verifies pairing, allow-list/trust policy, selected route, paused state, and shared-room targeting before path resolution or filesystem access
- **AND** unauthorized or non-target events produce only safe refusal behavior

#### Scenario: Assistant tool request enters same action path
- **WHEN** the assistant invokes the relay file-delivery action with a relative path
- **THEN** the pipeline or shared action layer applies the same requester-context, path, type, size, and adapter capability checks used by explicit remote commands
- **AND** emits the same safe result classes for success, validation failure, unsupported capability, stale context, and upload failure

#### Scenario: Action is audited without sensitive content
- **WHEN** a remote or assistant-triggered file-delivery action succeeds, is skipped, or fails
- **THEN** PiRelay records a local safe audit entry with the action source, relative path, requester messenger label, and result class
- **AND** it does not record file bytes, upload URLs, tokens, hidden prompts, or full transcripts

#### Scenario: Stale middleware action is refused
- **WHEN** a delayed button, retried event, duplicate ingress, or assistant action refers to a route or requester context that is no longer active for that user and conversation
- **THEN** the pipeline refuses the file delivery action
- **AND** it does not send the requested file to any fallback destination
