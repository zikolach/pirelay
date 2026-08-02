## Why

Telegram is often used from a phone, where voice notes and uploaded documents are more natural than typing long prompts. Extending PiRelay beyond images to voice and document inputs would make mobile prompting more flexible while preserving authorization and size/privacy boundaries.

## What Changes

- Accept authorized Telegram voice/audio messages and inject transcribed text prompts when transcription is configured.
- Accept supported document uploads such as text, Markdown, JSON, CSV, PDF, and log files using bounded extraction or safe file references.
- Add clear rejection messages for unsupported, oversized, encrypted, or failed-to-process media.
- Preserve existing authorization, paused-state, offline-state, busy-delivery, and model-capability rules.
- Avoid automatic document browsing or secret leakage; media must be explicitly sent by the authorized user.

## Capabilities

### New Capabilities

### Modified Capabilities
- `telegram-session-tunnel`: adds voice transcription and document input requirements for authorized Telegram prompts.

## Impact

- Affected code: Telegram API parsing/download, runtime prompt delivery, broker IPC, config, MIME/size validation, tests, and documentation.
- Possible dependencies: optional transcription provider or local command; optional PDF/text extraction library or external command.
- No change to existing image bridge behavior except shared media validation utilities may be refactored.
