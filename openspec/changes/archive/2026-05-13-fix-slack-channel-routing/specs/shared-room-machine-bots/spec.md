## ADDED Requirements

### Requirement: Shared-room routing acknowledgements reflect prompt delivery
The system SHALL NOT report successful prompt routing from shared-room commands unless the target route was resolved and the prompt was handed to that route for delivery.

#### Scenario: Selection acknowledgement implies future routability
- **WHEN** an authorized user sends a shared-room active selection command and the system responds that the active session was selected
- **THEN** the active selection is persisted for the messenger instance, conversation id, and user id
- **AND** a later ordinary unaddressed prompt from that same conversation/user routes to that selected local session while it remains online and unpaused

#### Scenario: One-shot acknowledgement implies prompt handoff
- **WHEN** an authorized user sends a shared-room one-shot prompt command and the system responds with successful delivery wording
- **THEN** the target route has received the prompt handoff
- **AND** the command has not merely updated binding metadata or returned a command response

#### Scenario: Unroutable recognized command gives guidance or remains silent by target
- **WHEN** a shared-room command is recognized by a local broker but cannot be routed because the target machine/session/prompt shape is malformed or non-local
- **THEN** the local broker either remains silent for clearly remote targets or returns safe usage/disambiguation guidance for commands addressed to the local machine
- **AND** it does not report successful selection or delivery
