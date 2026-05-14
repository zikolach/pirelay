## ADDED Requirements

### Requirement: Voice prompt transcription
The system SHALL route authorized Telegram voice or supported audio messages into the paired Pi session as text prompts when transcription is configured.

#### Scenario: Authorized voice message is transcribed
- **WHEN** an authorized Telegram user sends a voice message while the paired session is online, unpaused, and delivery is allowed
- **THEN** the system downloads the voice file after authorization, transcribes it using the configured backend, and injects the transcript as a user prompt

#### Scenario: Transcription is not configured
- **WHEN** an authorized Telegram user sends a voice message but no transcription backend is configured
- **THEN** the system rejects the voice prompt with setup guidance and does not inject an empty prompt

#### Scenario: Transcription fails
- **WHEN** a supported authorized voice message cannot be transcribed
- **THEN** the system does not inject a partial prompt and replies with a retry-safe failure message

### Requirement: Document prompt ingestion
The system SHALL accept supported Telegram document uploads as bounded prompt context after authorization and validation.

#### Scenario: Authorized text document is sent
- **WHEN** an authorized Telegram user sends a supported text-like document within configured byte and extracted-text limits
- **THEN** the system injects a prompt containing the caption or safe fallback text plus the bounded document content or safe file reference

#### Scenario: Authorized PDF document is sent
- **WHEN** an authorized Telegram user sends a supported PDF within configured limits and extraction succeeds
- **THEN** the system injects the caption or safe fallback text plus bounded extracted text or a safe file reference according to configured behavior

#### Scenario: Unsupported document is sent
- **WHEN** an authorized Telegram user sends a document whose MIME type is not accepted for image or document prompt ingestion
- **THEN** the system rejects the document and replies with the accepted media types

### Requirement: Media validation and privacy boundaries
The system SHALL enforce authorization, size, MIME, extraction, and privacy boundaries before injecting voice or document media into Pi.

#### Scenario: Unauthorized media is sent
- **WHEN** an unbound or unauthorized Telegram user sends voice, audio, or document media to the bot
- **THEN** the system rejects the update using existing authorization behavior and MUST NOT download the referenced Telegram file

#### Scenario: Extracted document text exceeds limit
- **WHEN** a supported document downloads successfully but extracted text exceeds the configured extraction limit
- **THEN** the system does not inject the full extracted content and replies with an actionable size-limit message

#### Scenario: Busy session receives media prompt
- **WHEN** an authorized Telegram user sends supported voice or document media while the Pi session is processing
- **THEN** the system queues the resulting prompt using the configured busy delivery mode unless an explicit `/steer` or `/followup` caption selects a delivery mode
