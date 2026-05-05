## ADDED Requirements

### Requirement: Machine-aware shared-room session selection
The system SHALL extend shared session selection semantics so a messenger room containing multiple independent PiRelay machine bots can target one local machine/session without broker federation.

#### Scenario: Machine-aware active session is selected
- **WHEN** an authorized shared-room user invokes `/use <machine> <session>` or an equivalent platform command and `<machine>` targets the local broker
- **THEN** the system switches the active session for that messenger conversation/user to the resolved local session and records the selected machine identity with the active selection

#### Scenario: Ordinary prompt routes only to selected machine
- **WHEN** an authorized shared-room user sends ordinary text after selecting an active machine/session
- **THEN** only the broker whose local active selection matches that messenger conversation/user injects the prompt
- **AND** brokers whose local state indicates another machine is active remain silent and do not mutate session state

#### Scenario: Explicit target overrides active selection
- **WHEN** an authorized shared-room user invokes `/to <machine> <session> <prompt>` or explicitly mentions/replies to a machine bot with a session selector
- **THEN** the targeted local broker handles the one-shot command without changing the active selection for that messenger conversation/user

#### Scenario: Messenger rooms maintain independent active sessions
- **WHEN** the same user selects different active machine/session pairs in Telegram, Discord, Slack, or separate rooms of the same messenger
- **THEN** each messenger conversation/user active selection is independent and later ordinary prompts route according to the selection scoped to that specific messenger room

#### Scenario: Unknown active selection is safe
- **WHEN** a broker in a shared room has not observed a current active selection for that messenger conversation/user and the inbound text is not explicitly addressed to that broker
- **THEN** it remains silent and does not inject the text into any Pi session

### Requirement: Shared-room authorization and media safety
The system SHALL preserve the messenger-neutral authorization boundary in shared rooms before route selection, active-selection mutation, media download, prompt injection, callback/action execution, or control command execution.

#### Scenario: Unauthorized shared-room user sends machine-aware command
- **WHEN** an unauthorized platform user sends `/use <machine> <session>`, `/to <machine> <session> <prompt>`, a machine mention, or a reply targeting a machine bot in a shared room
- **THEN** the targeted broker rejects the event before changing active selection, downloading media, or injecting anything into Pi

#### Scenario: Unauthorized shared-room media is received
- **WHEN** an unauthorized shared-room user sends an image, document, attachment, audio, video, or other media that is visible to a machine bot
- **THEN** the broker does not download the media and returns only safe authorization guidance when the platform and addressing context permit a response
