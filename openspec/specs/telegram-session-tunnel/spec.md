# telegram-session-tunnel Specification

## Purpose
Defines Telegram-backed pairing, notifications, remote prompt delivery, guided answers, and lifecycle handling for Pi sessions.
## Requirements
### Requirement: Session-scoped Telegram pairing
The system SHALL allow a local Pi user to pair exactly the active Pi session with a Telegram private chat by invoking a tunnel setup command or skill workflow from that session.

#### Scenario: Pairing link is generated for active session
- **WHEN** the local user invokes the Telegram tunnel connect workflow in a Pi session
- **THEN** the system displays a Telegram bot deep link and QR code whose payload is scoped to that session

#### Scenario: Pairing token is validated
- **WHEN** Telegram delivers `/start <payload>` for a generated pairing payload before expiry
- **THEN** the system binds the Telegram private chat to the session associated with the payload

#### Scenario: Expired pairing token is rejected
- **WHEN** Telegram delivers `/start <payload>` after the payload expiry time
- **THEN** the system refuses to bind the chat and sends a safe retry instruction

### Requirement: Pairing authorization and revocation
The system SHALL authorize every inbound Telegram update before it can affect a Pi session, and SHALL support revoking an existing binding.

#### Scenario: Unauthorized chat sends a command
- **WHEN** a Telegram chat that is not bound to the session sends any tunnel command or message
- **THEN** the system rejects the update without injecting anything into Pi

#### Scenario: Local confirmation is required for first pairing
- **WHEN** a new Telegram user completes the deep-link handshake and no allow-list entry already authorizes that user
- **THEN** the system asks the local Pi user to confirm the Telegram identity before activation

#### Scenario: Binding is revoked
- **WHEN** the local user or the authorized Telegram user invokes disconnect
- **THEN** the system revokes the binding and refuses future updates from that chat until a new pairing is completed

### Requirement: Remote prompt delivery
The system SHALL route authorized Telegram text messages into the bound Pi session using the correct Pi delivery mode for the session state.

#### Scenario: Idle session receives a Telegram message
- **WHEN** an authorized Telegram user sends non-command text while the Pi session is idle
- **THEN** the system injects the text into the session as a user prompt and starts an agent turn

#### Scenario: Busy session receives a default Telegram message
- **WHEN** an authorized Telegram user sends non-command text while the Pi session is processing
- **THEN** the system queues the text as a follow-up message unless configuration selects a different default delivery mode

#### Scenario: Busy session receives a steering command
- **WHEN** an authorized Telegram user sends `/steer <text>` while the Pi session is processing
- **THEN** the system queues `<text>` as a steering message for that session

#### Scenario: Local Pi prompt after pairing still works
- **WHEN** a Telegram chat is paired to a Pi session and the local user submits a normal prompt or invokes a skill from the same Pi session
- **THEN** the session remains locally interactive and processes the local input without being blocked by tunnel synchronization or guided-answer state

### Requirement: Remote control commands
The system SHALL expose Telegram commands for common tunnel and Pi session controls without forwarding those command messages to the model.

#### Scenario: Status command
- **WHEN** an authorized Telegram user sends `/status`
- **THEN** the system replies with the bound session identity, online state, idle or busy state, current model when available, and last activity time

#### Scenario: Abort command
- **WHEN** an authorized Telegram user sends `/abort` while the bound session is processing
- **THEN** the system requests cancellation of the active Pi operation and reports the result to Telegram

#### Scenario: Compact command
- **WHEN** an authorized Telegram user sends `/compact` for an online bound session
- **THEN** the system triggers Pi context compaction for that session and reports completion or failure to Telegram

### Requirement: Completion notifications and summaries
The system SHALL notify the bound Telegram chat when a remotely controlled or locally started Pi task finishes, fails, or is aborted, and SHALL include a concise result summary by default.

#### Scenario: Agent turn completes successfully
- **WHEN** the Pi session emits an agent completion event with a final assistant response
- **THEN** the system sends Telegram a completion notification containing a concise summary or excerpt and an option to request full output

#### Scenario: Agent turn fails
- **WHEN** the Pi session emits a terminal error or failure state for the active task
- **THEN** the system sends Telegram a failure notification containing a safe error summary

#### Scenario: Agent turn is aborted
- **WHEN** the active Pi operation is aborted
- **THEN** the system sends Telegram an aborted notification and does not claim successful completion

### Requirement: Full output retrieval
The system SHALL let the authorized Telegram user request full output for the latest completed turn without sending oversized Telegram messages.

#### Scenario: Full output requested
- **WHEN** an authorized Telegram user sends `/full` after a completed turn
- **THEN** the system sends the latest full assistant output in one or more Telegram-sized chunks

#### Scenario: Full output is unavailable
- **WHEN** an authorized Telegram user sends `/full` before any completed output is available
- **THEN** the system replies that no full output is available for the bound session

### Requirement: Actionable long-output delivery
The system SHALL preserve access to important trailing content when assistant output is too long to fit comfortably in a single Telegram notification.

#### Scenario: Decision block appears near the end of a long response
- **WHEN** a completed assistant response contains an actionable tail section such as numbered choices or a final “Choose” prompt near the end
- **THEN** the system sends Telegram a notification strategy that still exposes that decision block, such as chunking into multiple messages, sending an explicit continuation, or attaching a clear full-output affordance

#### Scenario: Preview omits critical trailing content
- **WHEN** a concise completion preview would hide the most important concluding instructions or options
- **THEN** the system avoids head-only truncation and preserves access to the omitted portion in the same notification flow

#### Scenario: Accepted remote prompt starts visible Telegram activity
- **WHEN** an authorized remote prompt or guided-answer submission is accepted for delivery to Pi
- **THEN** the system attempts to surface Telegram-native recipient activity status for the bound chat while Pi is processing, or clearly falls back when the client-visible indicator is unavailable

### Requirement: Interactive answer workflow
The system SHALL make it easy for the authorized Telegram user to answer the latest structured assistant question or choice set from mobile using a guided workflow rather than manual copy/paste.

#### Scenario: Latest assistant output contains structured options
- **WHEN** the latest assistant response contains numbered or clearly separated answer options
- **THEN** the system exposes a Telegram-side guided answer flow such as inline buttons, question-by-question prompts, or both

#### Scenario: User answers through the Telegram workflow
- **WHEN** the authorized Telegram user advances through the guided Telegram answer flow and submits one or more answers
- **THEN** the system injects the selected answers into the bound Pi session using the same authorization and delivery rules as other remote prompts
- **AND** the workflow operates on a normalized answer draft derived from the latest completed assistant output, such as a stable choice list or `Q1`/`A1` template, rather than requiring the user to respond against raw assistant prose alone

#### Scenario: Guided answer parsing is ambiguous or malformed
- **WHEN** the latest assistant output looks partially structured but cannot be parsed into a reliable question or option set
- **THEN** the system declines to enter the guided answer flow and directs the user to `/full` or a normal text reply instead of presenting misleading choices

#### Scenario: No structured question metadata is available
- **WHEN** the user tries to enter the guided answer flow but no recent structured question or option set is available
- **THEN** the system explains that there is nothing to answer yet and suggests `/full` or a normal text reply instead

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

### Requirement: Session lifecycle handling
The system SHALL keep tunnel routing consistent with Pi session lifecycle events.

#### Scenario: Bound session starts
- **WHEN** a Pi session with active tunnel metadata starts or is resumed
- **THEN** the system restores the binding metadata and registers the session as an online route

#### Scenario: Bound session shuts down
- **WHEN** a Pi session with an active tunnel binding shuts down
- **THEN** the system unregisters the online route and marks the session unavailable for remote prompt delivery

#### Scenario: Telegram message arrives for offline session
- **WHEN** an authorized Telegram user sends a message for a bound session that is not online
- **THEN** the system reports that the session is offline and does not drop the user's instruction silently

### Requirement: Secret-safe persistence
The system SHALL persist only non-secret tunnel metadata in Pi session history and SHALL keep bot tokens and pairing secrets out of exported sessions.

#### Scenario: Binding metadata is persisted
- **WHEN** a session is paired successfully
- **THEN** the system records non-secret metadata sufficient to identify and restore the binding

#### Scenario: Session history is exported or shared
- **WHEN** a session containing tunnel metadata is exported or shared
- **THEN** the exported history does not include the Telegram bot token, raw pairing nonce, or other active authentication secret

### Requirement: Telegram transport constraints
The system SHALL respect Telegram Bot API operational constraints during all outbound delivery.

#### Scenario: Outbound message exceeds Telegram size limit
- **WHEN** a summary or full output chunk would exceed Telegram's message size limit
- **THEN** the system splits or truncates the content and clearly indicates how to retrieve remaining content

#### Scenario: Bot cannot message user before start
- **WHEN** the local user generates a pairing QR code but the Telegram user has not started the bot
- **THEN** the system waits for the Telegram `/start` update instead of attempting unsolicited private messages

### Requirement: Remote image prompt delivery
The system SHALL route authorized Telegram photo messages and supported image documents into the bound Pi session as image-capable user prompts while preserving the same authorization, paused-state, offline-state, and busy-delivery rules used for text prompts.

#### Scenario: Authorized Telegram photo becomes Pi image prompt
- **WHEN** an authorized Telegram user sends a photo message with a caption while the bound Pi session is online, unpaused, idle, and using an image-capable model
- **THEN** the system downloads an accepted photo size after authorization and injects a user prompt containing the caption text and an image content block for the photo

#### Scenario: Authorized image document becomes Pi image prompt
- **WHEN** an authorized Telegram user sends a document whose MIME type is an accepted image type while the bound Pi session is online, unpaused, idle, and using an image-capable model
- **THEN** the system downloads the document after authorization and injects a user prompt containing the caption or a safe image-inspection fallback text plus an image content block for the document

#### Scenario: Image-only prompt uses fallback text
- **WHEN** an authorized Telegram user sends a supported image without text or caption while delivery to Pi is otherwise allowed
- **THEN** the system injects the image with a default text prompt that asks Pi to inspect the attached image

#### Scenario: Busy session receives image prompt
- **WHEN** an authorized Telegram user sends a supported image while the Pi session is processing
- **THEN** the system queues the image-bearing prompt using the configured busy delivery mode unless an explicit `/steer` or `/followup` caption selects a delivery mode

#### Scenario: Current model does not support images
- **WHEN** an authorized Telegram user sends a supported image but the bound Pi session's current model does not accept image input
- **THEN** the system rejects the image-bearing prompt, does not inject a partial text-only prompt, and explains how to switch to an image-capable model or resend text only

#### Scenario: Unauthorized image is not downloaded
- **WHEN** an unbound or unauthorized Telegram user sends a photo or document to the bot
- **THEN** the system rejects the update using the existing authorization behavior and MUST NOT download the referenced Telegram file

### Requirement: Telegram image transport validation
The system SHALL enforce safe Telegram image transport constraints before injecting inbound images into Pi or sending outbound images to Telegram.

#### Scenario: Unsupported document type is sent
- **WHEN** an authorized Telegram user sends a non-image document or an image document with an unsupported MIME type
- **THEN** the system does not inject the attachment into Pi and replies with the accepted image formats

#### Scenario: Inbound image exceeds size limit
- **WHEN** an authorized Telegram user sends a photo or image document whose metadata or downloaded byte size exceeds the configured inbound image limit
- **THEN** the system does not inject the image into Pi and replies with a size-limit explanation

#### Scenario: Telegram file download fails
- **WHEN** a supported authorized image cannot be fetched from Telegram after the update is accepted
- **THEN** the system does not inject an incomplete image prompt and replies with a retry-safe error message

#### Scenario: Multiple image candidates are present
- **WHEN** Telegram provides multiple sizes for a photo
- **THEN** the system selects the best supported size within configured limits rather than sending duplicate photo sizes to Pi

### Requirement: Latest turn image retrieval
The system SHALL let the authorized Telegram user explicitly retrieve supported image outputs from the latest completed Pi turn without automatically sending local user images or arbitrary workspace files.

#### Scenario: Latest turn has image outputs
- **WHEN** the latest completed Pi turn produced one or more supported image content blocks from tool results
- **THEN** the Telegram completion notification indicates that images are available and exposes an explicit retrieval action such as `/images` or an inline button

#### Scenario: User requests latest images
- **WHEN** the authorized Telegram user invokes the latest-image retrieval action for the current assistant turn
- **THEN** the system sends the bounded latest-turn images to Telegram as documents with safe filenames and MIME types

#### Scenario: Latest turn references a generated image file
- **WHEN** the latest completed Pi turn references a local workspace image file with an accepted image extension and the authorized Telegram user invokes the latest-image retrieval action
- **THEN** the system validates that the file is a regular accepted image within the workspace and sends it to Telegram as a document with a safe filename

#### Scenario: User explicitly sends a workspace image path
- **WHEN** the authorized Telegram user invokes an explicit image-send command with a relative workspace path to an accepted image file
- **THEN** the system validates workspace containment, MIME type, and outbound size before sending the file as a Telegram document

#### Scenario: Referenced image path is unsafe or invalid
- **WHEN** latest-image retrieval or an explicit image-send command targets an absolute path, a path with traversal, a symlink outside the workspace, a missing file, a non-image, or an oversized image
- **THEN** the system does not send the file and replies with an actionable validation failure message

#### Scenario: No latest images are available
- **WHEN** the authorized Telegram user invokes the latest-image retrieval action before any retrievable latest-turn images exist
- **THEN** the system replies that no images are available, explains that only captured image outputs or safe latest-turn workspace image files can be sent, and does not send empty documents

#### Scenario: Outbound image exceeds size limit
- **WHEN** a latest-turn image exceeds the configured outbound Telegram image limit
- **THEN** the system skips that image, reports that it was too large to send, and continues sending any remaining images that fit the limits

#### Scenario: Local user image is not echoed by default
- **WHEN** the local Pi user or a remote Telegram user supplied an input image during the latest turn
- **THEN** the system does not include that input image in latest-image retrieval unless it was separately emitted as a tool-result image output

#### Scenario: Arbitrary workspace images are not discoverable
- **WHEN** the authorized Telegram user invokes latest-image retrieval
- **THEN** the system does not browse arbitrary workspace images and only considers captured image outputs or safe image file references associated with the latest turn

#### Scenario: Stale image retrieval action is used
- **WHEN** the authorized Telegram user invokes an inline image retrieval action for an assistant turn that is no longer current
- **THEN** the system rejects the stale action and does not send images from an older turn

### Requirement: Image bridge broker parity
The system SHALL provide equivalent image prompt delivery and latest-image retrieval behavior in both in-process and broker runtimes.

#### Scenario: Broker runtime delivers image prompt
- **WHEN** the singleton broker owns Telegram polling and an authorized Telegram image prompt is accepted
- **THEN** the broker delivers the same text and image content blocks to the session-owning Pi client that the in-process runtime would inject

#### Scenario: Broker runtime retrieves latest images on demand
- **WHEN** the singleton broker owns Telegram polling and the authorized Telegram user requests latest images
- **THEN** the broker requests the latest bounded image list from the session-owning Pi client and sends those images using the same validation rules as the in-process runtime

#### Scenario: Broker runtime sends a validated workspace image path
- **WHEN** the singleton broker owns Telegram polling and the authorized Telegram user invokes an explicit image-send command
- **THEN** the broker asks the session-owning Pi client to validate and load the image bytes, then sends the image using the same document transport as in-process runtime

#### Scenario: Broker image request targets offline session
- **WHEN** the authorized Telegram user requests latest images for a bound session that is currently offline
- **THEN** the broker reports that the session is offline and does not silently drop the request

### Requirement: Conservative guided-answer intent resolution
The system SHALL distinguish Telegram guided-answer submissions from ordinary prompts using explicit answer context and conservative ambiguity rules.

#### Scenario: Normal question follows answerable output
- **WHEN** the latest assistant output has structured answer metadata and the authorized Telegram user sends a new question or instruction that does not explicitly answer the latest output
- **THEN** the system treats the message as a normal prompt and does not wrap it as an answer to the previous assistant output

#### Scenario: Explicit answer phrase is sent
- **WHEN** the authorized Telegram user sends an explicit answer phrase such as `answer 2`, `option 1`, `choose B`, or a filled `A1:` template for current structured answer metadata
- **THEN** the system treats the message as a guided-answer submission using existing answer delivery rules

#### Scenario: Bare short option is unambiguous
- **WHEN** the authorized Telegram user sends a bare short option id, number, letter, or exact option label for current structured answer metadata and the message is not prompt-like
- **THEN** the system may treat it as a guided-answer submission

#### Scenario: Message is prompt-like
- **WHEN** the authorized Telegram user sends text that is long, multi-paragraph, question-like, Markdown-like, code-like, or resembles a new instruction rather than an answer
- **THEN** the system treats it as a normal prompt unless the user is in explicit answer mode or uses an explicit answer phrase

### Requirement: Answer ambiguity confirmation
The system SHALL ask for confirmation instead of guessing when a Telegram message plausibly could be either a guided answer or a new prompt.

#### Scenario: Ambiguous answer-or-prompt text is sent
- **WHEN** an authorized Telegram message is ambiguous between answering the latest structured output and starting a new prompt
- **THEN** the system asks the user to choose whether to send it as a prompt, answer the previous assistant output, or cancel

#### Scenario: User confirms send as prompt
- **WHEN** the authorized Telegram user confirms that an ambiguous message should be sent as a prompt
- **THEN** the system injects the original message as a normal prompt and clears the pending ambiguity state

#### Scenario: User confirms answer previous
- **WHEN** the authorized Telegram user confirms that an ambiguous message should answer the previous assistant output and the answer metadata is still current
- **THEN** the system injects the message using guided-answer delivery rules and clears the pending ambiguity state

#### Scenario: Ambiguity action becomes stale
- **WHEN** the authorized Telegram user acts on an ambiguity confirmation after expiry or after a newer assistant turn supersedes the referenced output
- **THEN** the system rejects the stale action and does not inject the ambiguous message

### Requirement: Guided-answer state cleanup
The system SHALL clear stale or inactive guided-answer state when normal prompt routing or newer session state makes the state no longer current.

#### Scenario: Normal prompt is routed
- **WHEN** an authorized Telegram message is routed as a normal prompt while answer-flow or custom-answer state exists for that route or user
- **THEN** the system clears the stale answer-related state that could otherwise capture the next message accidentally

#### Scenario: New assistant turn completes
- **WHEN** a newer assistant turn completes for the session
- **THEN** the system invalidates pending answer, custom-answer, and ambiguity actions associated with older assistant turns

#### Scenario: User cancels answer state
- **WHEN** the authorized Telegram user sends `cancel` while an answer, custom-answer, or ambiguity flow is active
- **THEN** the system clears that flow and does not inject a prompt

### Requirement: Answer audit accuracy
The system SHALL record Telegram audit messages that reflect whether the user sent a prompt or submitted an explicit guided answer.

#### Scenario: Explicit guided answer is submitted
- **WHEN** an authorized Telegram interaction is resolved as a guided-answer submission
- **THEN** the system records an audit entry indicating that the user answered a guided Telegram question flow

#### Scenario: Message is routed as prompt
- **WHEN** an authorized Telegram text is resolved as a normal prompt, including after ambiguity confirmation
- **THEN** the system records an audit entry indicating that the user sent or queued a prompt rather than an answer

