## ADDED Requirements

### Requirement: Shared-room adapter visibility and addressing
The system SHALL require messenger adapters used in shared-room machine-bot mode to declare and enforce how group/channel messages can target the local machine bot.

#### Scenario: Adapter declares shared-room visibility
- **WHEN** a messenger adapter is enabled for live shared-room use
- **THEN** it declares whether the platform/runtime can receive ordinary room text, bot mentions, replies to bot messages, platform commands, media attachments, and group/channel membership events

#### Scenario: Explicit local bot addressing is normalized
- **WHEN** a platform event addresses the local bot by mention, reply, app command, or adapter-specific direct target metadata
- **THEN** the adapter normalizes the event with enough messenger-neutral metadata for shared relay logic to treat it as explicitly targeting the local machine bot

#### Scenario: Event targets another bot
- **WHEN** a platform event clearly mentions, replies to, or invokes another PiRelay machine bot in the same room
- **THEN** the local adapter/runtime marks the event as not locally targeted or drops it before prompt injection side effects

#### Scenario: Plain room text is not visible
- **WHEN** a messenger platform or configuration does not deliver ordinary group/channel text to the bot
- **THEN** the adapter reports that limitation through capabilities or diagnostics and shared-room routing uses explicit command, mention, or reply fallback instead of assuming active-session plain text will work

### Requirement: Shared-room adapter safe response behavior
The system SHALL prevent adapter-specific shared-room behavior from causing duplicate responses, accidental mentions, or command-surface collisions.

#### Scenario: Non-target adapter remains silent
- **WHEN** shared relay logic classifies an inbound shared-room event as targeting another machine or as ambiguous unaddressed text
- **THEN** the adapter sends no acknowledgement, typing activity, action answer, or command response for that event

#### Scenario: Shared-room text is rendered safely
- **WHEN** an adapter sends help, status, sessions, prompt acknowledgement, completion, or error text in a shared room
- **THEN** it escapes or formats the text so machine names, session labels, user input, and assistant excerpts do not accidentally mention users/roles/channels or invoke platform command syntax

#### Scenario: Slash command surface is unreliable in shared rooms
- **WHEN** a platform may reserve, intercept, or route slash commands to only one application in a room
- **THEN** the adapter documents a reliable shared-room fallback such as text-prefix commands, mentions, or replies and does not rely on collision-prone top-level slash commands for correctness
