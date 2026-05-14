## ADDED Requirements

### Requirement: Remote requester context is preserved for safe relay actions
The system SHALL preserve non-secret requester context for authorized remote prompts and commands so internal relay actions can respond to the correct messenger conversation without guessing or using raw destination input.

#### Scenario: Remote prompt establishes requester context
- **WHEN** an authorized Telegram, Discord, Slack, or future messenger user sends a prompt that is delivered to an online Pi session
- **THEN** PiRelay records non-secret requester context for that route and turn, including messenger kind, instance id, conversation id, optional thread id, authorized user id, session key, and safe display label
- **AND** the context is available to assistant-callable relay actions during that turn

#### Scenario: Remote command uses selected session context
- **WHEN** an authorized remote user invokes `send-file <relative-path>` through the active messenger command surface
- **THEN** PiRelay resolves the selected session using the same active-selection and `/use` rules as other remote controls
- **AND** delivers the file request only if the selected session is online and unambiguous

#### Scenario: One-shot session selection is respected before file request
- **WHEN** an authorized remote user changes the active session with `/use <session>` or an equivalent command and then requests a file
- **THEN** PiRelay applies the file request to the selected session's workspace and route
- **AND** does not read files from another paired session with a similar label

#### Scenario: Requester context is stale or ambiguous
- **WHEN** a relay file action cannot determine exactly one authorized requesting conversation for the target route
- **THEN** PiRelay refuses the action with safe guidance
- **AND** does not fall back to the latest local binding, another messenger, all messengers, or a raw destination id

#### Scenario: Requester context excludes sensitive data
- **WHEN** PiRelay stores or forwards requester context for file delivery
- **THEN** the context contains only non-secret routing and identity metadata
- **AND** it excludes bot tokens, signing secrets, prompt transcripts, file bytes, upload URLs, and hidden session data
