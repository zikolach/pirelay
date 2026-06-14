## MODIFIED Requirements

### Requirement: Shared completion, progress, and output retrieval
The system SHALL deliver safe progress, terminal notifications, latest output retrieval, and document/download fallbacks consistently across messenger adapters.

#### Scenario: Completion notification is sent
- **WHEN** a paired Pi turn completes, fails, or is aborted
- **THEN** the system sends a safe notification to each configured bound messenger identity according to that binding's notification preferences and platform limits

#### Scenario: Prompt source receives assistant completion
- **WHEN** an authorized Telegram, Discord, Slack, or future messenger user sends a prompt that is accepted and the Pi turn completes with a final assistant message
- **THEN** the originating messenger conversation receives the assistant completion summary or excerpt without requiring a separate local command or Telegram-only notification path

#### Scenario: Completion uses completed assistant text when final event omits it
- **WHEN** a paired Pi turn emits non-empty assistant text through a completed assistant `message_end` event
- **AND** the subsequent `agent_end` payload does not contain non-empty assistant text
- **THEN** PiRelay treats the turn as completed using the completed assistant text from the same active turn
- **AND** it does not send “finished without a final assistant response” for that turn
- **AND** it does not use stream-only drafts, user messages, tool results, hidden prompts, or transcript content as fallback final output

#### Scenario: Failure notification is sent
- **WHEN** a paired Pi turn fails or finishes without a final assistant response
- **THEN** every eligible bound messenger receives a safe failure notification that does not claim successful completion

#### Scenario: Abort notification is sent
- **WHEN** a paired Pi turn is aborted locally or through any messenger control
- **THEN** every eligible bound messenger receives an aborted notification and no messenger receives a successful-completion notification for that turn

#### Scenario: Busy prompt receives eventual terminal notification
- **WHEN** an authorized messenger prompt is accepted while the Pi session is busy and queued or steered according to delivery rules
- **THEN** the accepting messenger receives the immediate busy acknowledgement and later receives the terminal completion, failure, or abort notification for the resulting turn when Pi emits it

#### Scenario: Full output is requested
- **WHEN** an authorized user requests latest full output through `/full` or an equivalent platform action
- **THEN** the system returns only the latest completed assistant message using chunking or document/file fallback appropriate to the messenger

#### Scenario: Long output uses adapter fallback
- **WHEN** the latest assistant output exceeds the active messenger adapter text limit
- **THEN** the system chunks it or offers a document/file download according to that adapter's declared capabilities and does not silently truncate critical trailing content

#### Scenario: Full output excludes hidden data
- **WHEN** an authorized user retrieves full output through any messenger
- **THEN** the returned content excludes hidden prompts, tool internals, bot tokens, peer secrets, and full transcripts, and is limited to safe latest assistant output

#### Scenario: Progress updates are rate-limited
- **WHEN** a long-running paired session emits safe progress events
- **THEN** the system coalesces and rate-limits progress delivery per binding and messenger adapter limits

#### Scenario: Discord typing activity refreshes while turn is running
- **WHEN** an authorized Discord prompt is accepted and the target Pi session enters or remains in a running turn
- **THEN** PiRelay sends Discord typing activity immediately and refreshes it periodically while the turn is non-terminal because Discord typing indicators expire automatically
- **AND** typing refresh is best-effort: failures are recorded as safe diagnostics and do not block prompt delivery, completion, failure, or abort notifications

#### Scenario: Discord typing activity stops on terminal state
- **WHEN** the Discord-originated Pi turn completes, fails, aborts, is disconnected, or the binding is paused
- **THEN** PiRelay stops refreshing Discord typing activity and lets the platform indicator expire naturally

#### Scenario: Progress preferences apply per messenger binding
- **WHEN** one messenger binding is configured quiet and another binding for the same session is configured verbose
- **THEN** progress delivery respects each binding independently while terminal notifications still reach both bindings
