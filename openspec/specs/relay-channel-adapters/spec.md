# relay-channel-adapters Specification

## Purpose
Defines channel-neutral adapter contracts and parity expectations so Telegram, Discord, Slack, and future messengers expose consistent relay capabilities through platform-specific transports.
## Requirements
### Requirement: Channel-neutral relay core
The system SHALL separate messenger-independent PiRelay behavior from messaging-platform-specific transport implementations for all supported messenger adapters.

#### Scenario: Messenger message is processed through adapter
- **WHEN** any enabled messenger adapter receives an authorized inbound message
- **THEN** the relay core handles route authorization, session state, busy delivery, and Pi prompt injection using messenger-neutral message data

#### Scenario: Core sends outbound response
- **WHEN** the relay core needs to send a completion, failure, prompt acknowledgement, image, document, activity indicator, or action prompt
- **THEN** it requests delivery through the selected messenger adapter using normalized outbound data and the target messenger instance reference

#### Scenario: Shared behavior is not implemented in platform adapter
- **WHEN** behavior applies to all messengers such as session selection, output retrieval, guided answers, or latest-image retrieval
- **THEN** the behavior lives in shared relay code rather than in Telegram-, Discord-, or Slack-specific modules

### Requirement: Channel adapter capability declaration
The system SHALL require each messenger adapter instance to declare supported transport capabilities and platform limits.

#### Scenario: Adapter lacks inline buttons
- **WHEN** the relay core wants to present actions but the selected messenger adapter does not support inline buttons
- **THEN** the system falls back to text commands or another declared supported interaction mode

#### Scenario: Adapter has smaller message limit
- **WHEN** an outbound message exceeds the active messenger adapter's declared message size limit
- **THEN** the system chunks, truncates, or offers document/file download according to shared relay behavior and adapter capabilities

#### Scenario: Multiple instances share an adapter kind
- **WHEN** multiple configured instances use the same messenger kind with different limits or credentials
- **THEN** each instance exposes its own resolved capability and limit profile to the relay core

### Requirement: Live Discord adapter operations
The system SHALL provide concrete Discord adapter operations that connect the channel-neutral Discord adapter to a live Discord bot client.

#### Scenario: Gateway message is normalized
- **WHEN** the live Discord client receives a direct-message event from Discord
- **THEN** it passes the event through the Discord adapter normalization before relay authorization or prompt delivery

#### Scenario: Discord outbound payload is sent
- **WHEN** the relay core emits a normalized outbound payload for a Discord binding
- **THEN** the Discord adapter sends the equivalent Discord message, file, image, typing activity, or interaction acknowledgement through the live client operations

#### Scenario: Discord platform client is mocked in tests
- **WHEN** tests exercise Discord runtime behavior
- **THEN** they can inject mocked Discord operations without opening a network connection to Discord

### Requirement: Discord adapter safety boundaries
The system SHALL preserve adapter-level Discord safety checks when used by the live runtime.

#### Scenario: Live runtime receives guild message by default
- **WHEN** the live Discord client receives a guild-channel message and guild-channel control is not explicitly enabled and allowed
- **THEN** the adapter/runtime rejects the event before route lookup, media download, or prompt injection

#### Scenario: Live runtime receives unsupported attachment
- **WHEN** the live Discord client receives an attachment that exceeds configured size or MIME limits
- **THEN** the adapter marks or rejects the attachment according to the declared capabilities before any Pi prompt injection

#### Scenario: Live runtime sends oversized file
- **WHEN** the relay core asks the Discord adapter to send a file that exceeds configured limits
- **THEN** the adapter refuses the upload and returns a safe error instead of sending the file

### Requirement: First-class messenger adapter parity
The system SHALL treat Telegram, Discord, Slack, and future messenger adapters as peers behind the same adapter lifecycle and normalized event contracts.

#### Scenario: Telegram and Discord are both enabled
- **WHEN** Telegram and Discord messenger instances are configured and enabled
- **THEN** both adapters register with the broker using the same adapter lifecycle, pairing, inbound event, outbound delivery, media, and action contracts

#### Scenario: Adapter-specific command rendering differs
- **WHEN** one messenger supports buttons and another supports only text commands
- **THEN** both messengers expose the same relay actions through platform-appropriate renderers without changing shared session semantics

#### Scenario: Adapter command coverage is declared
- **WHEN** a messenger adapter is enabled for live use
- **THEN** it declares support, fallback, or explicit capability-gated limitation for every canonical remote command so parity tests can fail missing implementations such as `/full` or `/sessions`

#### Scenario: Adapter avoids unreliable platform command surfaces
- **WHEN** a platform reserves or intercepts a command syntax, such as Discord's `/...` application-command UI
- **THEN** the adapter provides a reliable documented fallback that reaches PiRelay as a normal inbound event, such as Discord `relay <command>` DM text, and treats intercepted syntax only as a convenience alias

#### Scenario: Adapter activity indicators match platform expiry behavior
- **WHEN** a messenger platform exposes expiring activity indicators such as Discord typing
- **THEN** the adapter or runtime refreshes the activity at a safe cadence while work is ongoing and stops refreshing on terminal state rather than assuming a single activity call lasts for the whole turn

#### Scenario: Adapter preserves plain-text intent
- **WHEN** shared relay presenters produce plain status, help, diagnostic, acknowledgement, or error text for a messenger with markup parsing such as Discord Markdown
- **THEN** the adapter sends or escapes that text so platform rendering does not accidentally bold, code-format, mention users/roles, create headings, or otherwise alter the intended plain-text meaning

#### Scenario: Adapter fails startup
- **WHEN** one configured messenger adapter fails to authenticate or connect
- **THEN** the broker reports a secret-safe diagnostic for that adapter and continues operating other enabled adapters when safe

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

### Requirement: Shared-room platform parity inventory
The system SHALL maintain a tested inventory of shared-room capabilities and known limitations for each first-class messenger adapter.

#### Scenario: Capability inventory is generated or documented
- **WHEN** developers inspect shared-room adapter support
- **THEN** PiRelay provides a checked-in document, test fixture, or diagnostic source of truth that lists Telegram, Discord, and Slack support for private chats, group/channel messages, ordinary text visibility, bot/app mentions, replies, platform commands, media attachments, inline buttons/actions, activity indicators, command fallback, authorization model, and optional E2E status

#### Scenario: Adapter declarations disagree with documentation
- **WHEN** an adapter declares shared-room capabilities that are stronger or weaker than the documented inventory
- **THEN** tests fail or diagnostics report the discrepancy so users are not promised unsupported shared-room behavior

#### Scenario: Platform command surface is unreliable
- **WHEN** a platform may reserve, intercept, or route command syntax in a way that prevents reliable delivery to PiRelay
- **THEN** the inventory and setup guidance name the reliable fallback first, such as Telegram `/command@bot`, Discord `relay <command>` or mentions, and Slack app mentions or documented channel command forms

### Requirement: Shared-room parity tests
The system SHALL test shared-room behavior consistently across Telegram, Discord, and Slack according to each adapter's declared capabilities and safe defaults.

#### Scenario: Shared-room test matrix runs
- **WHEN** adapter shared-room tests run
- **THEN** they cover local target routing, remote target silence, ambiguous target handling, active selection scoping, unauthorized rejection, channel/guild disabled rejection, media gating, and safe output rendering for each adapter that declares the corresponding capability

#### Scenario: Capability is intentionally unsupported
- **WHEN** a messenger adapter intentionally does not support a shared-room behavior
- **THEN** tests assert the explicit unsupported diagnostic or fallback text rather than silently omitting coverage

### Requirement: Messenger adapters expose document delivery consistently
Telegram, Discord, Slack, and future first-class messenger adapters SHALL either provide normalized outbound document/file delivery or report explicit capability-gated limitations.

#### Scenario: Normalized document payload is sent
- **WHEN** the relay core emits a normalized outbound document payload for a bound messenger conversation
- **THEN** the active adapter sends the equivalent platform file/document upload with filename, bytes, MIME type, caption, and conversation/thread metadata where supported

#### Scenario: Adapter cannot send documents
- **WHEN** an adapter cannot send outbound documents because the platform, runtime operations, or scopes do not support it
- **THEN** the adapter reports a clear limitation instead of pretending delivery succeeded
- **AND** shared relay behavior falls back to text chunks or local guidance when possible

#### Scenario: Adapter applies file limits before upload
- **WHEN** an outbound file exceeds the adapter's declared document or image size limit
- **THEN** the adapter rejects the payload before calling the platform upload API

#### Scenario: Adapter tests can mock file upload
- **WHEN** tests exercise adapter or runtime file delivery
- **THEN** they can inject mocked messenger operations without opening a network connection

### Requirement: Slack live file upload operations are capability-aligned
The Slack live adapter operations SHALL implement outbound file upload when the Slack adapter declares document or image delivery support, and SHALL expose clear limitations when upload cannot be performed.

#### Scenario: Slack outbound payload uses live upload operation
- **WHEN** the Slack channel adapter receives a normalized outbound document or image payload
- **THEN** it calls the Slack live upload operation with bounded file bytes, filename, MIME type, target channel, caption, and thread metadata

#### Scenario: Slack live upload completes through external upload flow
- **WHEN** Slack live operations upload a file
- **THEN** they request an external upload URL, upload the bytes to that URL, and complete the file upload with the target channel and optional initial comment/thread timestamp

#### Scenario: Slack upload response is malformed
- **WHEN** Slack's upload URL or completion response is missing required fields or reports an error
- **THEN** PiRelay treats the upload as failed and returns a safe diagnostic instead of claiming delivery succeeded

### Requirement: Messenger adapters support requester-scoped remote file requests
Telegram, Discord, Slack, and future first-class messenger adapters SHALL expose remote safe file-request command behavior when their declared capabilities support outbound document or image delivery.

#### Scenario: Telegram remote file request is delivered
- **WHEN** an authorized Telegram user sends `/send-file <relative-path> [caption]` for a supported file in the selected session workspace
- **THEN** the Telegram runtime sends the validated file back to that Telegram chat using normalized document or image delivery
- **AND** preserves safe caption text when provided

#### Scenario: Discord remote file request is delivered
- **WHEN** an authorized Discord user sends `relay send-file <relative-path> [caption]` for a supported file in the selected session workspace
- **THEN** the Discord runtime sends the validated file back to the requesting DM or allowed channel context using normalized file delivery
- **AND** does not depend on unreliable bare slash-command routing for correctness

#### Scenario: Slack remote file request is delivered
- **WHEN** an authorized Slack user sends `pirelay send-file <relative-path> [caption]` for a supported file in the selected session workspace
- **THEN** the Slack runtime sends the validated file back to the requesting DM, channel, or thread context using normalized upload delivery
- **AND** preserves thread timestamp metadata where Slack routing provides it

#### Scenario: Adapter lacks file upload capability
- **WHEN** an authorized remote user requests a file through a messenger adapter that cannot send documents or lacks required platform scopes
- **THEN** PiRelay returns an explicit capability or setup limitation through that messenger
- **AND** it does not claim delivery succeeded or inject the command as an ordinary Pi prompt

#### Scenario: Adapter response is requester-scoped
- **WHEN** a remote file request is handled in a shared room, group, channel, DM, or thread
- **THEN** only the adapter instance and conversation authorized for that request sends the file or error response
- **AND** non-target machine bots or duplicate runtimes remain silent

### Requirement: Adapters delegate route-action safety
Telegram, Discord, Slack, and future live messenger adapters SHALL use shared route-action safety outcomes or equivalent shared helpers for fallible Pi route actions instead of duplicating incompatible availability, rollback, and stale-error handling at each platform edge.

#### Scenario: Adapter delivers prompt through shared safety
- **WHEN** a live messenger adapter accepts an authorized prompt for a selected route
- **THEN** it invokes the route prompt through shared safety semantics that classify accepted, busy, unavailable, and failed outcomes consistently with other adapters

#### Scenario: Adapter registers platform cleanup hooks
- **WHEN** an adapter starts platform-specific typing, activity, thinking reaction, or shared-room output routing before a fallible route action
- **THEN** it registers cleanup or rollback behavior with the operation so unavailable outcomes do not leave stale platform state active

#### Scenario: Adapter renders unavailable outcome consistently
- **WHEN** a shared route-action safety helper returns an unavailable outcome
- **THEN** the adapter renders safe unavailable guidance using platform-appropriate text or interaction responses
- **AND** it does not convert the outcome into unknown-command help, successful delivery acknowledgement, or adapter health failure

#### Scenario: Adapter preserves platform failures
- **WHEN** platform I/O or adapter transport fails independently of route availability
- **THEN** the adapter still records or reports that platform failure according to its existing diagnostics and does not hide it as a route-unavailable outcome

### Requirement: Adapter status uses coherent route probes
Messenger adapters SHALL build session lists, active-session status, and availability displays from shared coherent route probes so online, busy, and model fields cannot disagree after a stale route is discovered.

#### Scenario: Session list sees unavailable model probe
- **WHEN** a route becomes unavailable while an adapter builds a session list that includes model information
- **THEN** the adapter lists that route as offline or unavailable rather than online with only the model omitted

#### Scenario: Status sees unavailable idle probe
- **WHEN** a route availability probe reports unavailable during a status command
- **THEN** the adapter reports the session offline or unavailable and does not display it as idle or busy
