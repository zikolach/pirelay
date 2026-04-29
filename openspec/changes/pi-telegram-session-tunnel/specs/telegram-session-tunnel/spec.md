## ADDED Requirements

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

### Requirement: Interactive answer workflow
The system SHALL make it easy for the authorized Telegram user to answer the latest structured assistant question or choice set from mobile using a guided workflow rather than manual copy/paste.

#### Scenario: Latest assistant output contains structured options
- **WHEN** the latest assistant response contains numbered or clearly separated answer options
- **THEN** the system exposes a Telegram-side guided answer flow such as inline buttons, question-by-question prompts, or both

#### Scenario: User answers through the Telegram workflow
- **WHEN** the authorized Telegram user advances through the guided Telegram answer flow and submits one or more answers
- **THEN** the system injects the selected answers into the bound Pi session using the same authorization and delivery rules as other remote prompts

#### Scenario: No structured question metadata is available
- **WHEN** the user tries to enter the guided answer flow but no recent structured question or option set is available
- **THEN** the system explains that there is nothing to answer yet and suggests `/full` or a normal text reply instead

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
