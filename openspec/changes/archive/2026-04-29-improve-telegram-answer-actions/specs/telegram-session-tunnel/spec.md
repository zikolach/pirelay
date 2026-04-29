## ADDED Requirements

### Requirement: Reliable structured answer detection
The system SHALL detect answerable choice or question blocks in the latest completed assistant output using conservative, testable parsing that supports common option formats and avoids presenting misleading actions for ambiguous content.

#### Scenario: Numbered or lettered choices are detected
- **WHEN** the latest completed assistant output ends with a clear choice prompt and options such as `1.`, `1)`, `A.`, `A)`, `(A)`, or `Option A:`
- **THEN** the system stores normalized structured answer metadata containing the prompt, stable option identifiers, option labels, and the latest assistant turn identity

#### Scenario: Bullet choices require a strong prompt
- **WHEN** the latest completed assistant output contains a trailing bullet list
- **THEN** the system treats the list as answer choices only if nearby text clearly asks the user to choose, select, decide, answer, or reply with one of the options

#### Scenario: Ambiguous structured content is declined
- **WHEN** the latest completed assistant output contains a task list, ordinary prose list, malformed partial options, code-like content, or otherwise ambiguous structure
- **THEN** the system SHALL NOT expose option buttons for that content and SHALL fall back to `/full` or normal text reply guidance

### Requirement: Inline Telegram answer actions
The system SHALL expose reliable structured answer choices through Telegram inline keyboard buttons while preserving existing text-based answer fallbacks.

#### Scenario: Choice buttons are sent for detected choices
- **WHEN** a completed assistant response contains reliable structured choice metadata
- **THEN** the Telegram completion or follow-up decision message includes inline buttons for each detected option
- **AND** each option button is scoped to the session, authorized chat, and latest assistant turn without embedding raw option text in callback data

#### Scenario: User taps an option button
- **WHEN** the authorized Telegram user taps an option button for the latest assistant turn
- **THEN** the system injects the selected answer into the bound Pi session using the same delivery and busy-state rules as other authorized remote prompts
- **AND** the system acknowledges the callback without requiring the user to type the option number manually

#### Scenario: Stale option button is tapped
- **WHEN** the authorized Telegram user taps an option button for an assistant turn that is no longer the latest completed turn for that session
- **THEN** the system rejects the stale action, does not inject anything into Pi, and tells the user that the answer action is no longer current

#### Scenario: Text answer fallback remains available
- **WHEN** the Telegram client cannot or does not use inline buttons
- **THEN** the user can still answer by sending an option id, option number, `answer`, or normal text according to the existing guided-answer behavior

### Requirement: Custom Telegram answer capture
The system SHALL let the authorized Telegram user choose a custom-answer action from an inline keyboard and have the next appropriate Telegram text message captured as the answer for the latest completed assistant turn.

#### Scenario: User starts custom answer mode
- **WHEN** the authorized Telegram user taps `Custom answer` for the latest assistant turn
- **THEN** the system records pending custom-answer state scoped to that session, chat, user, and assistant turn
- **AND** the system prompts the user to send their custom answer text

#### Scenario: User sends custom answer text
- **WHEN** pending custom-answer state exists and the same authorized Telegram user sends a non-command text message before expiry
- **THEN** the system injects that text as the custom answer into the bound Pi session using the same delivery and busy-state rules as other authorized remote prompts
- **AND** the system clears the pending custom-answer state

#### Scenario: User cancels custom answer mode
- **WHEN** pending custom-answer state exists and the same authorized Telegram user sends `cancel`
- **THEN** the system clears the pending custom-answer state and does not inject anything into Pi

#### Scenario: Commands bypass custom answer capture
- **WHEN** pending custom-answer state exists and the authorized Telegram user sends a Telegram slash command such as `/status` or `/full`
- **THEN** the system handles the command normally and does not consume it as the custom answer text

#### Scenario: Custom answer state expires or becomes stale
- **WHEN** pending custom-answer state expires or a newer assistant turn completes for the same session
- **THEN** the system clears or rejects the pending custom-answer state and does not inject stale custom text into Pi

### Requirement: One-click latest assistant output retrieval
The system SHALL attach inline full-output actions to Telegram completion and decision messages so the authorized user can retrieve the latest completed assistant message without typing `/full`.

#### Scenario: Full output buttons are sent with a completion summary
- **WHEN** the system sends a Telegram completion notification and latest assistant output is available
- **THEN** the message includes inline actions to show the latest assistant output in chat and to download it as a Markdown document

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

### Requirement: Mobile-friendly Telegram chat formatting
The system SHALL format assistant output sent as Telegram chat messages for mobile readability while preserving the meaning and exact data values of the latest assistant message.

#### Scenario: Markdown table is shown in chat
- **WHEN** the latest assistant output sent through a Telegram chat message contains a Markdown table
- **THEN** the system reformats the table into a readable mobile-friendly monospace representation instead of sending a raw Markdown table that Telegram clients do not render

#### Scenario: Markdown download preserves original formatting
- **WHEN** the authorized Telegram user chooses `Download .md`
- **THEN** the Markdown document preserves the latest assistant message content without applying chat-only table reflow, aside from configured redaction

#### Scenario: Code blocks are preserved
- **WHEN** assistant output sent through a Telegram chat message contains fenced code blocks or code-like content
- **THEN** the system preserves the code content and does not reflow it as prose or as a table

#### Scenario: Formatting does not change meaning
- **WHEN** the system reformats assistant output for Telegram chat readability
- **THEN** it does not invent content, remove table rows, change table cell values, or include content outside the latest assistant message

### Requirement: Callback authorization and broker parity
The system SHALL authorize Telegram callback-query actions with the same binding rules as Telegram messages and SHALL provide equivalent behavior in both in-process and broker runtimes.

#### Scenario: Unauthorized user taps a button
- **WHEN** a Telegram user who is not authorized for the bound session taps an inline keyboard button
- **THEN** the system rejects the callback and does not inject anything into Pi or send protected output

#### Scenario: Callback arrives for offline session
- **WHEN** an authorized Telegram callback action targets a paired session that is currently offline
- **THEN** the system reports that the session is offline and does not silently drop the requested action

#### Scenario: Broker runtime handles callbacks consistently
- **WHEN** the singleton broker owns Telegram polling for the bot token
- **THEN** choice buttons, custom-answer capture, `Show in chat`, and `Download .md` behave the same as they do in the in-process runtime
