## ADDED Requirements

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
