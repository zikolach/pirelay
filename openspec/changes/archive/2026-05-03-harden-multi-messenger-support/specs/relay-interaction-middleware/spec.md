## MODIFIED Requirements

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

## ADDED Requirements

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
