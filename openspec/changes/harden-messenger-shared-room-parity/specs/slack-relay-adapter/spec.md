## ADDED Requirements

### Requirement: Slack shared-room runtime parity
The system SHALL either implement Slack shared-room runtime routing for explicitly enabled channel contexts or report precise unsupported limitations through capabilities, setup, and diagnostics.

#### Scenario: Slack shared-room channel support is enabled
- **WHEN** Slack shared-room mode and channel message control are explicitly enabled for an allowed workspace/channel/user
- **THEN** Slack app mentions or documented channel command forms route through shared-room pre-routing before prompt injection
- **AND** local machine targets, active selections, and one-shot prompts use the same shared selector semantics as other messengers

#### Scenario: Slack event targets another machine bot
- **WHEN** a Slack channel event mentions or otherwise targets another PiRelay machine bot
- **THEN** the local broker remains silent and does not send any user-visible acknowledgement/response, inject prompts, mutate active selection, download media, send ephemeral responses, or post channel messages

#### Scenario: Slack channel support is disabled
- **WHEN** Slack channel messages or shared-room mode are not explicitly enabled
- **THEN** Slack rejects or ignores channel events before pairing, prompt injection, media download, active selection, or action execution
- **AND** setup and diagnostics explain the DM-first safe default and the exact configuration required to enable channel/shared-room behavior

#### Scenario: Slack app mention is unauthorized
- **WHEN** a Slack app mention or channel command arrives from a user outside the configured allow-list or workspace boundary
- **THEN** PiRelay rejects it before prompt injection, media download, callback/action execution, or session-state mutation and responds only when the response is safe for that Slack context

### Requirement: Slack shared-room setup inventory
The system SHALL document Slack-specific requirements for shared-room operation.

#### Scenario: Slack setup guidance describes shared rooms
- **WHEN** `/relay setup slack`, setup TUI, or `/relay doctor` describes shared-room mode
- **THEN** it names required Slack scopes/event subscriptions, Socket Mode or webhook delivery requirements, channel membership, app mention/channel message behavior, workspace/user allow-list requirements, and any unsupported gaps
- **AND** it keeps Slack DM-first behavior as the default safe recommendation
