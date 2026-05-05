## ADDED Requirements

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

#### Scenario: Remote machine is absent
- **WHEN** a machine bot is offline, absent from the room, or unable to observe the sessions request
- **THEN** other brokers do not invent remote offline state for that machine and the user-visible absence or explicit local diagnostic communicates that no response was received

### Requirement: Shared-room platform visibility and fallback
The system SHALL gate plain-text active-session routing in shared rooms on adapter-declared room visibility and provide explicit mention, reply, or command fallbacks when the platform cannot deliver ordinary room text to every machine bot.

#### Scenario: Telegram group privacy hides plain text
- **WHEN** a Telegram machine bot is in a group with privacy mode or permissions that prevent it from receiving ordinary group messages
- **THEN** PiRelay reports that unaddressed active-session prompts are unavailable for that bot and documents mention, reply, or addressed command forms as the safe fallback

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
