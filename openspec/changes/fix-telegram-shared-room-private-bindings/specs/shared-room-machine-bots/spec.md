## MODIFIED Requirements

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
