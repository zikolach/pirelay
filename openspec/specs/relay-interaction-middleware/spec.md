# relay-interaction-middleware Specification

## Purpose
Defines the messenger-neutral interaction middleware pipeline for authorization, safety checks, event transformation, tracing, and side-effect ordering before relay actions execute.
## Requirements
### Requirement: Channel-neutral interaction pipeline
The system SHALL process relay interactions through a channel-neutral middleware pipeline between channel adapters and Pi session delivery.

#### Scenario: Authorized inbound message enters pipeline
- **WHEN** a channel adapter receives an inbound message from an authorized bound identity
- **THEN** the system converts it to a normalized relay inbound event and processes it through the configured middleware pipeline before Pi delivery or channel response

#### Scenario: Unauthorized inbound media is received
- **WHEN** a channel adapter receives media from an unbound or unauthorized identity
- **THEN** the system rejects the event before middleware can download, transcribe, extract, or inject the media

#### Scenario: Middleware handles command without Pi delivery
- **WHEN** middleware resolves an inbound event to a relay command such as status, help, repeat, approval decision, or unsupported-media response
- **THEN** the system sends the appropriate channel response without injecting the command text into Pi

### Requirement: Middleware phase ordering and capabilities
The system SHALL execute middleware in deterministic phases with declared capabilities, ordering constraints, and failure behavior.

#### Scenario: Middleware requires another middleware output
- **WHEN** a middleware declares that it depends on a capability produced by an earlier middleware
- **THEN** the system executes it only after the dependency is available or returns a configured fallback/error response

#### Scenario: Middleware failure is recoverable
- **WHEN** a middleware configured as recoverable fails while processing an interaction
- **THEN** the system records the failure, skips or falls back for that middleware, and continues without violating authorization or privacy boundaries

#### Scenario: Middleware failure is fatal
- **WHEN** a middleware configured as fatal fails while processing an interaction
- **THEN** the system stops further processing for that interaction and returns a safe error response to the channel when possible

### Requirement: Interaction safety classification
The system SHALL carry safety classifications through middleware outputs so outbound delivery can respect privacy, redaction, and confirmation boundaries.

#### Scenario: Middleware produces secret-sensitive content
- **WHEN** middleware output is classified as secret-sensitive or unsafe for a channel
- **THEN** the system does not send it to the channel unless a later authorized policy explicitly transforms it into safe redacted content

#### Scenario: Outbound speech rendering is requested
- **WHEN** a future audio middleware requests text-to-speech rendering of assistant output
- **THEN** the system uses only content classified as safe for spoken delivery and applies configured redaction before speech synthesis

#### Scenario: Action requires confirmation
- **WHEN** middleware resolves an interaction to an action classified as requiring confirmation
- **THEN** the system obtains the required confirmation before injecting the action into Pi or resolving an approval-sensitive operation

### Requirement: Middleware-produced prompts and actions
The system SHALL allow middleware to transform inbound interactions into prompts, delivery-mode requests, channel responses, or internal relay actions.

#### Scenario: Middleware transcribes audio into prompt text
- **WHEN** a future audio middleware successfully transcribes an authorized voice input as a normal prompt
- **THEN** the pipeline passes the transcript as the prompt content while preserving authorization, route, and busy-delivery semantics

#### Scenario: Middleware resolves guided answer by speech or text
- **WHEN** middleware recognizes an authorized interaction as a choice for the latest guided answer flow
- **THEN** the system injects the selected answer using existing guided-answer delivery rules and does not inject the raw command phrase separately

#### Scenario: Middleware requests busy delivery mode
- **WHEN** middleware classifies an authorized inbound interaction as steering or follow-up content
- **THEN** the system applies the requested delivery mode subject to existing session state and configuration rules

### Requirement: Outbound post-processing
The system SHALL allow middleware to transform relay outputs into channel-appropriate responses while preserving content boundaries and adapter limits.

#### Scenario: Completion output is post-processed
- **WHEN** a Pi turn completes and the relay core emits a normalized completion output
- **THEN** outbound middleware may summarize, redact, chunk, convert to document, or prepare accessibility-friendly renderings before the channel adapter sends it

#### Scenario: Channel lacks requested capability
- **WHEN** outbound middleware requests a response capability that the active channel adapter does not support
- **THEN** the system uses a declared fallback such as text instructions, document download, or command-based retrieval

#### Scenario: Output exceeds adapter limit
- **WHEN** middleware output exceeds the active channel adapter's declared message or media limits
- **THEN** the system chunks, truncates, or converts it to a supported document response according to shared relay rules

### Requirement: Middleware broker parity
The system SHALL provide equivalent middleware behavior across in-process tests, the machine-local broker, federated broker delivery, and all enabled messenger adapters.

#### Scenario: Broker handles inbound event
- **WHEN** the machine-local broker receives an authorized inbound event from Telegram, Discord, Slack, or a future messenger adapter
- **THEN** the broker and session-owning client exchange normalized pipeline data so middleware behavior matches across messengers

#### Scenario: Middleware action targets offline session
- **WHEN** middleware resolves an action that requires an online session but the selected session or remote owning machine is offline
- **THEN** the system reports the offline state to the originating messenger and does not silently drop the action

#### Scenario: Stale middleware action is invoked
- **WHEN** a messenger callback, button interaction, slash interaction, or text command references middleware state that is expired or no longer current
- **THEN** the system rejects the stale action and does not affect current session state

#### Scenario: Federated broker handles action
- **WHEN** an ingress owner broker receives a valid messenger action for a session owned by another machine
- **THEN** it forwards normalized middleware action data to the session-owning broker and preserves authorization, stale-state, and safe-response behavior

### Requirement: Messenger-neutral middleware inputs
The system SHALL ensure middleware receives messenger-neutral route, identity, content, media, command, and action data rather than Telegram-specific update shapes.

#### Scenario: Discord event enters middleware
- **WHEN** a Discord DM event is authorized and normalized by the Discord adapter
- **THEN** middleware receives the same canonical identity, route, content, attachment, and command fields used for Telegram and Slack events

#### Scenario: Telegram-specific field is needed
- **WHEN** a middleware or action requires a platform-specific value such as a Telegram callback id or Discord interaction token
- **THEN** the value is carried in an adapter-scoped metadata envelope and shared middleware does not depend on its raw shape

#### Scenario: Middleware output is rendered
- **WHEN** middleware produces a command response, prompt delivery, action prompt, document, image, or safe error
- **THEN** the selected messenger adapter renders it according to its capabilities without changing middleware semantics

