# shared-room-machine-bots Specification

## Purpose
TBD - created by archiving change support-shared-room-machine-bots. Update Purpose after archive.
## Requirements
### Requirement: Dedicated machine bots in shared rooms
The system SHALL support a no-federation shared-room mode where each participating machine uses a distinct messenger bot/app identity and all machine bots are present in the same messenger group, channel, or shared room.

#### Scenario: Distinct machine bots share one room
- **WHEN** laptop, desktop, and server brokers are each configured with their own Telegram, Discord, or Slack bot/app identity and those identities are present in the same authorized room
- **THEN** each broker receives ingress only through its own bot/app credentials and controls only its local Pi sessions
- **AND** no broker-to-broker connection, hosted PiRelay service, or shared bot token is required

#### Scenario: Private bot chat cannot contain multiple machines
- **WHEN** a messenger platform private bot DM cannot include multiple bot/app identities in one conversation
- **THEN** shared-room mode uses a group, channel, server channel, or equivalent shared room instead of pretending that multiple machine bots can participate in one private DM

#### Scenario: Same token is attempted in shared-room mode
- **WHEN** shared-room setup or diagnostics detects that two local messenger instances use the same token/account fingerprint
- **THEN** the system reports that shared-room mode requires a dedicated bot/app identity per machine and refuses or disables duplicate local ingress when safe

### Requirement: Shared-room single-target routing
The system SHALL ensure an independent broker in a shared room injects a prompt only when the event explicitly targets that machine bot or the room/user active selection points to one of that broker's local sessions.

#### Scenario: Explicit machine target is handled locally
- **WHEN** an authorized user sends a command or message that explicitly targets the local machine bot by mention, reply, configured machine alias, or machine id
- **THEN** that broker resolves the local session selector and handles the event according to normal authorization, command, prompt, media, and busy-delivery rules

#### Scenario: Active local session receives ordinary text
- **WHEN** an authorized user sends ordinary unaddressed text in a shared room and the local broker has a current active selection for that messenger conversation/user pointing to one of its online local sessions
- **THEN** the local broker injects the text into that selected session using the current idle or busy delivery rules

#### Scenario: Non-selected machine remains silent
- **WHEN** an authorized user sends ordinary text in a shared room and the active selection points to another machine or no active selection is known locally
- **THEN** the broker does not inject the prompt, does not acknowledge successful delivery, and does not mutate unrelated local session state

#### Scenario: Ambiguous machine target is rejected safely
- **WHEN** a machine selector matches multiple configured local aliases or cannot be resolved to the local machine
- **THEN** the broker returns safe disambiguation guidance only if the event explicitly addressed that broker and otherwise remains silent

### Requirement: Shared-room active selection commands
The system SHALL support machine-aware active selection commands whose state is scoped to messenger instance, conversation id, and user id so different messengers and rooms can select different active sessions.

#### Scenario: Machine-aware use command selects local session
- **WHEN** an authorized user sends `/use <machine> <session>` or an equivalent prefixed command in a shared room and `<machine>` targets the local broker
- **THEN** the broker resolves `<session>` among local paired sessions, persists the active selection for that messenger conversation/user, and reports the selected machine and session label

#### Scenario: Use command targets another machine
- **WHEN** an authorized user sends `/use <machine> <session>` and `<machine>` clearly names another machine bot
- **THEN** the local broker records enough observed selection state to know it is not active for that messenger conversation/user and remains silent unless explicitly asked to respond

#### Scenario: One-shot command targets local machine
- **WHEN** an authorized user sends `/to <machine> <session> <prompt>` and `<machine>` targets the local broker
- **THEN** the broker resolves the local session, injects the prompt only when the resolution is unambiguous and online, and does not change the active session pointer

#### Scenario: Active selections differ across messengers
- **WHEN** the same authorized user selects `laptop/docs` in a Telegram shared room and `desktop/api` in a Discord shared room
- **THEN** the Telegram active selection and Discord active selection remain independent and later ordinary messages in each room route only according to that room's selection state

### Requirement: Shared-room local session reporting
The system SHALL represent cross-machine session visibility in shared rooms as local reports from each machine bot rather than requiring one broker to aggregate remote broker state.

#### Scenario: Sessions command fans out by machine
- **WHEN** an authorized user requests sessions for all machines in a shared room using the documented shared-room form
- **THEN** each participating machine bot that observes the request may respond with only its local paired sessions, machine label, online/busy state, aliases, and active marker for that messenger conversation/user

#### Scenario: Machine-specific sessions command
- **WHEN** an authorized user requests `/sessions <machine>` or explicitly addresses one machine bot for sessions
- **THEN** only the targeted broker responds with its local sessions and non-target brokers remain silent

#### Scenario: Telegram addressed sessions command uses private pairing
- **WHEN** a Telegram user has active private-chat pairings with two machine bots, both bots are present in the same group, and the user sends `/sessions@<local-bot-username>` in that group
- **THEN** the addressed bot lists the local sessions authorized by that same Telegram user id's private-chat pairings
- **AND** it does not require those sessions to be paired to the group chat id
- **AND** other machine bots that receive no addressed command for their username remain silent

#### Scenario: Remote machine is absent
- **WHEN** a machine bot is offline, absent from the room, or unable to observe the sessions request
- **THEN** other brokers do not invent remote offline state for that machine and the user-visible absence or explicit local diagnostic communicates that no response was received

### Requirement: Shared-room platform visibility and fallback
The system SHALL gate plain-text active-session routing in shared rooms on adapter-declared room visibility and provide explicit mention, reply, or command fallbacks when the platform cannot deliver ordinary room text to every machine bot.

#### Scenario: Telegram group privacy hides plain text
- **WHEN** a Telegram machine bot is in a group with privacy mode or permissions that prevent it from receiving ordinary group messages
- **THEN** PiRelay reports that unaddressed active-session prompts are unavailable for that bot and documents addressed slash-command forms such as `/sessions@bot`, `/use@bot <session>`, and `/to@bot <session> <prompt>` as the safe fallback

#### Scenario: Telegram addressed use command selects private-paired session for group
- **WHEN** a Telegram user has a private-chat pairing to the local machine bot and sends `/use@<local-bot-username> <session>` in a shared group where that bot is present
- **THEN** the local bot resolves `<session>` against that user's local private-chat pairings
- **AND** the local bot persists the active selection for the Telegram group conversation id and Telegram user id
- **AND** the private-chat binding remains unchanged

#### Scenario: Telegram addressed one-shot command uses private pairing
- **WHEN** a Telegram user has a private-chat pairing to the local machine bot and sends `/to@<local-bot-username> <session> <prompt>` in a shared group
- **THEN** the local bot resolves `<session>` against that user's local private-chat pairings and injects `<prompt>` into that session
- **AND** the local bot sends any acknowledgement and later completion output to the originating group conversation according to normal shared-room output rules
- **AND** the command does not change the active selection

#### Scenario: Telegram addressed command without private pairing
- **WHEN** a Telegram user sends `/sessions@<local-bot-username>`, `/use@<local-bot-username> <session>`, or `/to@<local-bot-username> <session> <prompt>` in a group but has no active private-chat pairing with the local bot
- **THEN** the local bot responds with guidance to pair in a private bot chat first
- **AND** it does not expose sessions paired by other Telegram users

#### Scenario: Mention or reply targets a machine bot
- **WHEN** a platform delivers a message because the user mentioned or replied to a specific machine bot
- **THEN** that broker treats the event as explicitly targeted to the local machine and applies local session selection without requiring other bots to see the same message

#### Scenario: Channel permissions are missing
- **WHEN** Discord, Slack, or a future adapter lacks the scopes, intents, permissions, or channel membership needed to observe shared-room commands
- **THEN** setup and diagnostics report the missing capability without starting unsafe prompt routing for that room

### Requirement: Shared-room notification source identity
The system SHALL send completion, failure, abort, progress, full-output, and media responses for a local session through the same machine bot identity that owns that session's local messenger binding.

#### Scenario: Local session completes after shared-room prompt
- **WHEN** a shared-room prompt is accepted by the laptop broker and the laptop Pi session completes
- **THEN** the laptop machine bot sends the terminal notification to the originating shared room according to platform limits and binding preferences

#### Scenario: Another machine cannot notify for local session
- **WHEN** a desktop broker observes the same room but does not own the session that accepted a prompt
- **THEN** the desktop broker does not send completion, failure, progress, media, or guided-action output for that prompt

### Requirement: Telegram Bot-to-Bot Communication Mode documentation
The system SHALL document Telegram Bot-to-Bot Communication Mode as an optional shared-room machine-bot capability when Telegram supports bot-to-bot messages and both participating bots enable the platform setting.

#### Scenario: Telegram shared-room setup describes bot-to-bot mode
- **WHEN** setup guidance, docs, or diagnostics describe Telegram shared-room machine bots
- **THEN** they explain that Telegram Bot-to-Bot Communication Mode is optional and must be enabled for each participating bot before bot-authored messages can reach other bots
- **AND** they preserve `/sessions@<local-bot-username>`, `/use@<local-bot-username> <session>`, and `/to@<local-bot-username> <session> <prompt>` as reliable user-driven fallbacks when bot-to-bot mode, privacy settings, or group visibility do not permit ordinary bot-authored text

#### Scenario: Telegram bot-to-bot capability is unknown
- **WHEN** PiRelay cannot verify whether Telegram Bot-to-Bot Communication Mode is enabled for a bot
- **THEN** setup and diagnostics report the capability as unknown or manually verified rather than claiming it is enabled
- **AND** they provide a safe smoke-test checklist that does not print bot tokens, pairing codes, hidden prompts, tool internals, or transcripts

### Requirement: Telegram bot-authored shared-room events are safe
The system SHALL treat bot-authored Telegram shared-room events as eligible for routing only when the event is explicitly addressed to the local machine bot and the sender bot identity is authorized for the intended workflow.

#### Scenario: Authorized bot targets local machine bot
- **WHEN** Telegram delivers a group message authored by another bot that is authorized for bot-to-bot shared-room communication and the message explicitly targets the local machine bot by username, reply, or supported platform metadata
- **THEN** the local broker applies the same shared-room command, authorization, session selection, and busy-delivery rules as an equivalent authorized user event
- **AND** any output is delivered through the local machine bot identity according to normal shared-room output rules

#### Scenario: Bot-authored event targets another machine bot
- **WHEN** Telegram delivers a bot-authored group message that clearly targets another machine bot
- **THEN** the local broker remains silent and does not inject prompts, mutate active selection, download media, acknowledge success, or send typing/activity indicators

#### Scenario: Bot-authored event is not authorized
- **WHEN** Telegram delivers a bot-authored group message from an untrusted or unpaired bot identity
- **THEN** the local broker rejects the event before prompt injection, media download, callback/action execution, or session-state mutation

#### Scenario: Bot feedback loop is possible
- **WHEN** a Telegram bot-authored message originates from the local bot itself or from a bot response that would cause a bot-to-bot feedback loop
- **THEN** PiRelay ignores the event or rejects it safely without sending another bot-authored prompt into the same loop

### Requirement: Telegram bot-to-bot verification coverage
The system SHALL provide automated or opt-in live verification for Telegram bot-to-bot shared-room behavior without requiring live credentials in normal CI.

#### Scenario: Mocked integration tests run in CI
- **WHEN** the normal unit and integration suite runs without Telegram credentials
- **THEN** it verifies bot-authored local-target, remote-target, unauthorized, self-bot, and feedback-loop cases using mocked Telegram updates and adapter operations

#### Scenario: Live Telegram E2E is configured
- **WHEN** disposable Telegram bot tokens and an authorized test group id are supplied through documented environment variables
- **THEN** the optional E2E test or smoke command verifies that one bot can address the other, that the addressed PiRelay bot receives and routes only authorized commands, and that non-target bots remain silent
- **AND** the test output redacts tokens, pairing payloads, hidden prompts, tool internals, and transcripts

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

