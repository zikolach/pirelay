## MODIFIED Requirements

### Requirement: One-click latest assistant output retrieval
The system SHALL attach inline full-output actions to Telegram completion or decision messages when the inline notification is too short to contain the whole latest assistant message, so the authorized user can retrieve longer completed output without typing `/full`. For any single completed assistant turn, the system SHALL avoid presenting duplicate full-output action keyboards across the completion and decision notification flow.

#### Scenario: Full output buttons are sent with a completion summary
- **WHEN** the system sends a Telegram completion notification with no structured decision message and the latest assistant output is longer than the inline preview
- **THEN** the message includes inline actions to show the latest assistant output in chat and to download it as a Markdown document

#### Scenario: Decision message owns full output buttons
- **WHEN** the system sends a Telegram completion notification followed by a structured decision message for the same latest assistant output
- **AND** the latest assistant output is longer than the inline preview
- **THEN** the completion summary does not include full-output inline actions or a redundant `/full` hint
- **AND** the structured decision message includes the full-output inline actions alongside the answer actions

#### Scenario: Short completion output avoids redundant buttons
- **WHEN** the system sends a Telegram completion notification whose preview already contains the small latest assistant message
- **THEN** the message does not include redundant full-output buttons
- **AND** `/full` remains available as a command fallback

#### Scenario: User chooses show in chat
- **WHEN** the authorized Telegram user taps `Show in chat` for the latest assistant turn
- **THEN** the system sends the full latest assistant message in Telegram-sized chunks using existing redaction and size-limit handling

#### Scenario: User chooses Markdown download
- **WHEN** the authorized Telegram user taps `Download .md` for the latest assistant turn
- **THEN** the system sends a Markdown document attachment containing the full latest assistant message after applying configured redaction rules

#### Scenario: Full output action is unavailable
- **WHEN** the authorized Telegram user taps a full-output action but no latest assistant output is available for that session
- **THEN** the system replies that no completed assistant output is available and does not send an empty document or empty chunks

#### Scenario: Full output action uses assistant message only
- **WHEN** the system handles `/full`, `Show in chat`, or `Download .md`
- **THEN** the returned content is limited to the latest completed assistant message and does not include tool logs, hidden prompts, or the whole session transcript
