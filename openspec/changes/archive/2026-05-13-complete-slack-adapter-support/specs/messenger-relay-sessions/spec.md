## ADDED Requirements

### Requirement: Slack canonical command parity
The system SHALL treat Slack as a first-class live messenger for canonical PiRelay command semantics when Slack runtime support is enabled.

#### Scenario: Slack supports canonical commands
- **WHEN** an authorized paired Slack user invokes a canonical PiRelay command through a supported Slack text form or interaction
- **THEN** PiRelay routes the command through the same command definitions, validation, session selection, usage, ambiguity, offline, paused, and error response classes as Telegram and Discord
- **AND** Slack-specific wording differs only where platform invocation or capability limits require it

#### Scenario: Slack help is requested
- **WHEN** an authorized Slack user requests help
- **THEN** the response lists the canonical PiRelay command set with Slack-specific invocation hints
- **AND** it identifies capability-gated Slack limitations such as file upload or native slash-command registration when those limitations apply

#### Scenario: Slack unsupported capability is reached
- **WHEN** a canonical command depends on a Slack capability that is disabled, unimplemented, or missing required scopes
- **THEN** PiRelay returns a clear Slack-specific limitation or setup message
- **AND** it does not fall through to generic unsupported-command help

### Requirement: Slack prompt source receives terminal result
The system SHALL send terminal result notifications for accepted Slack prompts to the Slack conversation that originated the prompt.

#### Scenario: Slack prompt is accepted while idle
- **WHEN** an authorized Slack prompt is accepted while the target Pi session is idle
- **THEN** PiRelay injects the prompt into that session
- **AND** the same Slack conversation receives the eventual completion, failure, or abort notification for that turn

#### Scenario: Slack prompt is accepted while busy
- **WHEN** an authorized Slack prompt is accepted while the target Pi session is busy
- **THEN** PiRelay applies the configured busy delivery mode and sends the immediate Slack busy acknowledgement
- **AND** the accepting Slack conversation receives the eventual terminal notification for the resulting turn when Pi emits it

#### Scenario: Slack prompt is rejected
- **WHEN** a Slack prompt cannot be routed because no session is selected, multiple sessions are ambiguous, the target is paused, the target is offline, or authorization fails
- **THEN** PiRelay returns the same class of safe routing guidance as other messengers
- **AND** it does not inject the prompt into any Pi session

### Requirement: Slack active selection parity
The system SHALL persist and honor Slack active session selections with the same messenger-neutral state semantics as other live messengers.

#### Scenario: Slack user selects a session
- **WHEN** an authorized Slack user invokes `/use <session>` or an equivalent Slack command form
- **THEN** PiRelay resolves the selector using shared session-selection rules
- **AND** it persists the active selection scoped to Slack instance, Slack conversation id, Slack user id, and machine identity when relevant

#### Scenario: Slack one-shot target is used
- **WHEN** an authorized Slack user invokes `/to <session> <prompt>` or an equivalent Slack command form
- **THEN** PiRelay resolves the target using shared selector rules and injects the prompt only when the target is unambiguous and online
- **AND** it does not change the active session pointer

#### Scenario: Duplicate Slack ingress is single-target
- **WHEN** the same Slack event is observed by multiple local runtimes, stale processes, retries, or channel history diagnostics
- **THEN** PiRelay resolves the event to at most one selected or explicitly targeted local route
- **AND** non-selected runtimes remain silent, do not inject prompts, and do not mutate unrelated session state
