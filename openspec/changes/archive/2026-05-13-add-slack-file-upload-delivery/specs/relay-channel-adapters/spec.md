## ADDED Requirements

### Requirement: Messenger adapters expose document delivery consistently
Telegram, Discord, Slack, and future first-class messenger adapters SHALL either provide normalized outbound document/file delivery or report explicit capability-gated limitations.

#### Scenario: Normalized document payload is sent
- **WHEN** the relay core emits a normalized outbound document payload for a bound messenger conversation
- **THEN** the active adapter sends the equivalent platform file/document upload with filename, bytes, MIME type, caption, and conversation/thread metadata where supported

#### Scenario: Adapter cannot send documents
- **WHEN** an adapter cannot send outbound documents because the platform, runtime operations, or scopes do not support it
- **THEN** the adapter reports a clear limitation instead of pretending delivery succeeded
- **AND** shared relay behavior falls back to text chunks or local guidance when possible

#### Scenario: Adapter applies file limits before upload
- **WHEN** an outbound file exceeds the adapter's declared document or image size limit
- **THEN** the adapter rejects the payload before calling the platform upload API

#### Scenario: Adapter tests can mock file upload
- **WHEN** tests exercise adapter or runtime file delivery
- **THEN** they can inject mocked messenger operations without opening a network connection

### Requirement: Slack live file upload operations are capability-aligned
The Slack live adapter operations SHALL implement outbound file upload when the Slack adapter declares document or image delivery support, and SHALL expose clear limitations when upload cannot be performed.

#### Scenario: Slack outbound payload uses live upload operation
- **WHEN** the Slack channel adapter receives a normalized outbound document or image payload
- **THEN** it calls the Slack live upload operation with bounded file bytes, filename, MIME type, target channel, caption, and thread metadata

#### Scenario: Slack live upload completes through external upload flow
- **WHEN** Slack live operations upload a file
- **THEN** they request an external upload URL, upload the bytes to that URL, and complete the file upload with the target channel and optional initial comment/thread timestamp

#### Scenario: Slack upload response is malformed
- **WHEN** Slack's upload URL or completion response is missing required fields or reports an error
- **THEN** PiRelay treats the upload as failed and returns a safe diagnostic instead of claiming delivery succeeded
