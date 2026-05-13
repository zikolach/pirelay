## ADDED Requirements

### Requirement: Slack shared-room app mention targeting
The system SHALL use Slack app mentions, replies, and active selections to target exactly one local machine app in shared Slack channels.

#### Scenario: Slack message mentions local machine app
- **WHEN** an authorized Slack user sends a channel message that mentions the local Slack app identity and Slack shared-room control is enabled
- **THEN** the local Slack runtime treats the event as explicitly targeting the local machine
- **AND** it applies normal authorization, command, prompt, media, and busy-delivery rules

#### Scenario: Slack message mentions another machine app
- **WHEN** a Slack channel message mentions only another configured or observed machine app identity
- **THEN** the local Slack runtime remains silent
- **AND** it does not inject a prompt, acknowledge delivery, mutate active selection, or send terminal output for that message

#### Scenario: Slack message mentions multiple machine apps
- **WHEN** a Slack channel message ambiguously mentions multiple known machine app identities
- **THEN** a mentioned local runtime may return safe disambiguation guidance
- **AND** non-target or unmentioned runtimes remain silent

### Requirement: Slack shared-room active selection
The system SHALL support Slack shared-room active selection scoped to Slack instance, channel id, user id, and machine identity.

#### Scenario: Slack use command targets local machine
- **WHEN** an authorized Slack user sends a machine-aware `/use <machine> <session>` command or equivalent mention-prefixed form targeting the local machine app
- **THEN** PiRelay resolves the local session, persists the Slack channel active selection for that user, and reports the selected machine/session through the local Slack app

#### Scenario: Slack use command targets another machine
- **WHEN** an authorized Slack user sends a machine-aware use command targeting another machine app
- **THEN** the local Slack runtime records or honors that the active selection is remote when enough non-secret target information is available
- **AND** it remains silent for later ordinary messages unless the local machine is explicitly targeted again

#### Scenario: Slack ordinary text follows local active selection
- **WHEN** an authorized Slack user sends ordinary unaddressed text in a shared Slack channel and the active selection for that Slack channel/user points to a local online session
- **THEN** the local Slack runtime injects the text into that selected session according to idle or busy delivery rules
- **AND** other Slack machine apps remain silent

#### Scenario: Slack ordinary text has no local selection
- **WHEN** an authorized Slack user sends ordinary unaddressed text in a shared Slack channel and no active local selection exists
- **THEN** the local Slack runtime remains silent or returns setup guidance only when explicitly addressed
- **AND** it does not guess a local session

### Requirement: Slack shared-room loop prevention
The system SHALL prevent Slack shared-room bot loops and duplicate responses across multiple machine apps.

#### Scenario: Local Slack app sees its own message
- **WHEN** Slack delivers a message authored by the local Slack app identity
- **THEN** PiRelay ignores the message and does not route it back into Pi or send another Slack response

#### Scenario: Remote Slack machine app posts output
- **WHEN** Slack delivers a message authored by another machine app in the shared room
- **THEN** PiRelay treats the message as remote machine output and ignores it unless that bot identity is explicitly authorized for a supported bot-to-bot workflow
- **AND** it does not create an output feedback loop

#### Scenario: Slack retries shared-room event
- **WHEN** Slack retries a shared-room event or both event delivery and diagnostic history polling observe the same event
- **THEN** PiRelay handles the event at most once for prompt injection, command execution, active-selection mutation, and response emission
