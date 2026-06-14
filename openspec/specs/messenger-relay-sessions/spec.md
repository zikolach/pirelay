# messenger-relay-sessions Specification

## Purpose
Defines messenger-neutral pairing, authorization, session selection, remote controls, notifications, progress, media, and output retrieval semantics shared by all live PiRelay messengers.
## Requirements
### Requirement: Messenger-neutral session pairing
The system SHALL allow a local Pi user to pair the active session with any enabled configured messenger instance using a channel-scoped, single-use, expiring pairing flow.

#### Scenario: Pairing is created for selected messenger instance
- **WHEN** the local user invokes `/relay connect telegram:work docs` or `/relay connect discord:default docs`
- **THEN** the system creates a pending pairing scoped to the selected messenger kind, instance id, machine id, session id, and display label

#### Scenario: Pairing is completed on matching messenger
- **WHEN** the selected messenger bot/account receives the correct pairing payload before expiry from an authorized platform identity
- **THEN** the system consumes the pairing once and binds that platform conversation to the target Pi session route

#### Scenario: Pairing arrives on wrong messenger instance
- **WHEN** a pairing payload created for one messenger kind or instance is received by another messenger kind or instance
- **THEN** the system rejects the payload and does not bind any session

### Requirement: Discord QR and PIN pairing UX
The system SHALL provide a Discord pairing experience that uses a QR-accessible Discord bot profile/DM link, a short human-entered pairing PIN, and local Pi approval for untrusted users after setup has authorized the bot.

#### Scenario: Discord connect shows QR bot profile link and PIN
- **WHEN** the local user invokes `/relay connect discord` and the Discord instance has a configured Application ID/clientId
- **THEN** PiRelay renders a local pairing screen or notification containing a QR code for the Discord bot profile/DM URL
- **AND** the pairing instructions explain that bot authorization/invite is handled by `/relay setup discord`, that the user and bot must already share a Discord server, and that the user should open a DM with the bot
- **AND** the instructions show a short pairing PIN and the reliable Discord DM command form `relay pair <pin>`
- **AND** `/start <pin>` MAY be accepted as a compatibility alias but MUST NOT be the only documented reliable pairing command

#### Scenario: Discord Application ID is missing during connect
- **WHEN** the local user invokes `/relay connect discord` and the Discord instance has no configured Application ID/clientId
- **THEN** PiRelay still MAY create a manual pairing PIN when live Discord control is otherwise configured
- **AND** it explains that QR redirect is unavailable until `discord.applicationId` or `PI_RELAY_DISCORD_APPLICATION_ID` is set from the Discord Developer Portal Application ID, while `discord.clientId` and `PI_RELAY_DISCORD_CLIENT_ID` remain accepted aliases

#### Scenario: Short Discord PIN requires local approval
- **WHEN** a Discord user sends a valid unconsumed short pairing PIN before expiry and that user is not allow-listed or locally trusted
- **THEN** PiRelay presents a local confirmation prompt naming the Discord user, Discord user id, conversation type, target session label, and messenger instance
- **AND** PiRelay does not create the binding until the local Pi user approves the request

#### Scenario: Local approval can trust the Discord user
- **WHEN** the local Pi user approves a Discord pairing request with a trust-this-user choice
- **THEN** PiRelay creates the requested binding and records that Discord identity in local trusted-user state for the messenger instance
- **AND** future Discord pairing requests from that trusted identity MAY skip local confirmation while still requiring a fresh expiring pairing code

#### Scenario: Local approval can allow once or deny
- **WHEN** the local Pi user chooses allow-once for a Discord pairing request
- **THEN** PiRelay creates only the requested binding and does not add the Discord identity to trusted-user state
- **WHEN** the local Pi user denies or ignores the request until it expires
- **THEN** PiRelay does not bind the Discord conversation and reports a safe denial or expiry message to Discord when possible

#### Scenario: Short pairing PIN is protected against guessing
- **WHEN** PiRelay generates a short Discord pairing PIN
- **THEN** the PIN is single-use, expiring, channel-scoped, and stored only in hashed form
- **AND** repeated invalid PIN attempts are throttled or bounded so a Discord user cannot brute-force active pairings by sending many guesses

### Requirement: Pairing trust and local confirmation reuse
The system SHALL support local Pi confirmation choices that can either approve a single pairing attempt or trust a messenger identity for future pairing attempts without automatically mutating user-managed config.

#### Scenario: Trusted identity skips future local confirmation
- **WHEN** a Telegram, Discord, Slack, or future messenger user who is recorded in local trusted-user state completes a fresh valid pairing flow for the same messenger instance
- **THEN** PiRelay MAY skip local confirmation and bind the session, subject to all normal pairing expiry, single-use, channel scope, and authorization checks

#### Scenario: Config allow-list remains authoritative
- **WHEN** a messenger identity is listed in the configured `allowUserIds` for that messenger instance
- **THEN** PiRelay treats that identity as pre-approved for pairing confirmation purposes
- **AND** local trusted-user state does not remove or weaken the configured allow-list requirement for later message authorization

#### Scenario: Trust choices are secret-safe and revocable
- **WHEN** PiRelay stores a trusted messenger identity
- **THEN** it stores only non-secret identity metadata needed for future confirmation decisions, such as messenger ref, user id, display label, trust timestamp, and optional trusted-by session label
- **AND** diagnostics and future UX SHALL provide a way to inspect and revoke trusted users without printing tokens, pairing codes, hidden prompts, tool internals, or transcripts

### Requirement: Messenger-neutral authorization boundary
The system SHALL authorize every messenger event before media download, prompt injection, callback/action execution, broker forwarding, or control command execution.

#### Scenario: Unauthorized platform user sends text
- **WHEN** an unpaired or disallowed platform user sends text to any configured messenger bot/account
- **THEN** the system rejects the event before route selection or Pi prompt injection

#### Scenario: Unauthorized platform user sends media
- **WHEN** an unpaired or disallowed platform user sends a photo, file, attachment, or document
- **THEN** the system does not download the media and returns only safe authorization guidance when the platform permits a response

#### Scenario: Unauthorized user invokes action
- **WHEN** a platform callback, button, or interaction is invoked by a user who is not authorized for the bound route
- **THEN** the system rejects the action and does not reveal protected output or alter session state

### Requirement: Shared prompt routing and session selection
The system SHALL route ordinary authorized messenger messages through shared session selection rules regardless of messenger platform.

#### Scenario: Single active session is selected
- **WHEN** an authorized user sends ordinary text and exactly one active paired session is selected for that messenger identity
- **THEN** the system injects the text into that Pi session using the current idle or busy delivery rules

#### Scenario: Multiple sessions require explicit selection
- **WHEN** an authorized user has multiple live paired sessions for the same messenger identity and no active selection can be resolved
- **THEN** the system asks the user to use `/sessions` and `/use` rather than guessing a target

#### Scenario: Duplicate ingress is single-target
- **WHEN** the same authorized Discord DM message or interaction is observed by more than one local runtime because multiple same-machine sessions, stale bindings, or legacy pollers are active
- **THEN** PiRelay resolves the messenger identity to exactly one selected or explicitly targeted session before prompt injection or control execution
- **AND** non-selected or non-owner runtimes remain silent, do not inject the prompt, do not acknowledge delivery, and do not mutate unrelated session state

#### Scenario: Active selection survives across runtimes
- **WHEN** an authorized user selects a session with `/use` or pairs a new session in a messenger conversation that already has multiple paired sessions
- **THEN** the active selection is persisted in shared relay state for that messenger conversation and user
- **AND** any runtime that observes later inbound messages for that conversation honors the same active selection instead of independently choosing the latest local binding

#### Scenario: One-shot target is used
- **WHEN** an authorized user invokes `/to <session> <prompt>` through any messenger adapter that supports text commands or an equivalent interaction
- **THEN** the system sends the prompt to the resolved session without changing the active session pointer

### Requirement: Shared remote controls
The system SHALL expose common PiRelay controls through every messenger adapter using platform-appropriate text commands or interaction affordances.

#### Scenario: Status is requested
- **WHEN** an authorized user requests status for a paired session through any messenger
- **THEN** the system returns session label, machine when relevant, online state, idle/busy state, model when available, last activity, and active messenger selection information

#### Scenario: Status output has UX parity
- **WHEN** Telegram and Discord users request `/status` for equivalent bound sessions
- **THEN** both messengers present the same core fields and human-friendly wording, including session display label, online state, busy state, model, progress/notification mode when supported, last activity, and safe binding summary
- **AND** neither messenger exposes raw internal session file paths or storage keys unless explicitly requested for diagnostics

#### Scenario: Sessions listing is requested
- **WHEN** an authorized user sends `/sessions` or an equivalent session-list action through any messenger
- **THEN** the system returns the same session list semantics across messengers: numbered sessions, stable markers, labels/aliases, active marker, online/offline state, idle/busy state, model when available, last activity, and disambiguation for duplicate labels

#### Scenario: Active session is selected
- **WHEN** an authorized user sends `/use <number|alias|label>` through any messenger
- **THEN** the system switches the active session for that messenger identity using the same selector and ambiguity rules as other messengers

#### Scenario: One-shot target command is used
- **WHEN** an authorized user sends `/to <session> <prompt>` through any messenger
- **THEN** the system resolves the target with shared selector rules, injects the prompt only when resolution is unambiguous and online, and does not change the active session pointer

#### Scenario: Alias and forget controls are used
- **WHEN** an authorized user invokes `/alias`, `/forget`, `/progress`, or `/recent` through a messenger that supports text commands or equivalent controls
- **THEN** the system applies the same validation, state update, and response semantics as other messengers, using text fallbacks when buttons are unavailable

#### Scenario: Abort is requested
- **WHEN** an authorized user requests abort for a busy online session through any messenger
- **THEN** the system requests cancellation of the active Pi operation and reports success, failure, or offline state through that messenger

#### Scenario: Disconnect is requested
- **WHEN** an authorized user or local Pi user disconnects a binding
- **THEN** the system revokes that messenger binding and refuses future events for it until a new pairing is completed
- **AND** the response uses PiRelay/relay or the actual messenger name, never legacy `Telegram tunnel` wording for non-legacy commands or non-Telegram adapters

### Requirement: Canonical remote command parity
The system SHALL expose the canonical PiRelay remote command set through every first-class messenger adapter with equivalent behavior, using text commands, slash commands, buttons, menus, or documented fallbacks according to platform capabilities.

#### Scenario: Canonical commands are supported on every live adapter
- **WHEN** a live Telegram, Discord, Slack, or future messenger adapter receives `/help`, `/status`, `/sessions`, `/use`, `/to`, `/alias`, `/forget`, `/progress`, `/recent`, `/summary`, `/full`, `/skills`, `/skill`, `/images`, `/send-image`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, or `/disconnect` from an authorized user
- **THEN** the adapter routes the command through shared relay semantics and returns the same success, usage, ambiguity, offline, unauthorized, unsupported-capability, or error response class as the other live adapters

#### Scenario: Unsupported-command help does not catch implemented commands
- **WHEN** an authorized user sends any canonical command through any live messenger adapter
- **THEN** the adapter SHALL NOT fall through to a generic "supported commands" or unknown-command response unless that command is explicitly disabled by configuration or unsupported by declared platform capability

#### Scenario: Capability-gated command fallback is explicit
- **WHEN** a canonical command depends on a platform capability such as file upload, image delivery, inline buttons, typing indicators, slash commands, or message chunking that the active adapter does not support
- **THEN** the system returns a clear capability-specific fallback or limitation message and records that limitation in adapter parity tests rather than omitting the command

#### Scenario: Help lists the same canonical command set
- **WHEN** an authorized user requests `/help` through any live messenger adapter
- **THEN** the response lists the same canonical PiRelay command set, with only platform-specific invocation hints or capability notes differing

#### Scenario: Platform slash command registration matches runtime support
- **WHEN** a messenger platform requires command registration, such as Discord application commands or Slack slash commands
- **THEN** every registered command is implemented by the runtime and every implemented canonical command has a registered slash command, interaction equivalent, or documented text fallback

#### Scenario: Discord text-prefix commands avoid slash interception
- **WHEN** an authorized Discord DM user sends `relay status`, `relay sessions`, `relay full`, `relay skills`, `relay skill`, `relay abort`, or another canonical command using the `relay <command>` text-prefix form
- **THEN** PiRelay handles the command as an ordinary Discord message without depending on Discord application-command routing or top-level slash-command selection

#### Scenario: Discord bare slash aliases are best-effort
- **WHEN** Discord delivers a bare slash-like message such as `/status`, `/full`, or `/sessions` as ordinary message text
- **THEN** PiRelay MAY handle it as a convenience alias
- **AND** correctness, documentation, tests, and smoke guidance MUST NOT rely on Discord delivering bare slash aliases because Discord may route those names to another application or reject them before PiRelay receives the event

#### Scenario: Native Discord application command is namespaced
- **WHEN** PiRelay registers native Discord application commands
- **THEN** it registers a namespaced PiRelay command surface such as `/relay <subcommand>` with canonical subcommands or an equivalent grouped command
- **AND** it does not rely on many collision-prone top-level commands such as `/status`, `/full`, `/abort`, or `/sessions` as the primary Discord UX

#### Scenario: Discord help advertises reliable invocation first
- **WHEN** an authorized Discord user requests help through `relay help`, `/help`, or a platform-native help interaction
- **THEN** the response advertises `relay <command>` forms as the reliable Discord invocation surface and labels bare slash aliases as optional/best-effort when mentioned

### Requirement: Shared completion, progress, and output retrieval
The system SHALL deliver safe progress, terminal notifications, latest output retrieval, and document/download fallbacks consistently across messenger adapters.

#### Scenario: Completion notification is sent
- **WHEN** a paired Pi turn completes, fails, or is aborted
- **THEN** the system sends a safe notification to each configured bound messenger identity according to that binding's notification preferences and platform limits

#### Scenario: Prompt source receives assistant completion
- **WHEN** an authorized Telegram, Discord, Slack, or future messenger user sends a prompt that is accepted and the Pi turn completes with a final assistant message
- **THEN** the originating messenger conversation receives the assistant completion summary or excerpt without requiring a separate local command or Telegram-only notification path

#### Scenario: Completion uses completed assistant text when final event omits it
- **WHEN** a paired Pi turn emits non-empty assistant text through a completed assistant `message_end` event
- **AND** the subsequent `agent_end` payload does not contain non-empty assistant text
- **THEN** PiRelay treats the turn as completed using the completed assistant text from the same active turn
- **AND** it does not send “finished without a final assistant response” for that turn
- **AND** it does not use stream-only drafts, user messages, tool results, hidden prompts, or transcript content as fallback final output

#### Scenario: Failure notification is sent
- **WHEN** a paired Pi turn fails or finishes without a final assistant response
- **THEN** every eligible bound messenger receives a safe failure notification that does not claim successful completion

#### Scenario: Abort notification is sent
- **WHEN** a paired Pi turn is aborted locally or through any messenger control
- **THEN** every eligible bound messenger receives an aborted notification and no messenger receives a successful-completion notification for that turn

#### Scenario: Busy prompt receives eventual terminal notification
- **WHEN** an authorized messenger prompt is accepted while the Pi session is busy and queued or steered according to delivery rules
- **THEN** the accepting messenger receives the immediate busy acknowledgement and later receives the terminal completion, failure, or abort notification for the resulting turn when Pi emits it

#### Scenario: Full output is requested
- **WHEN** an authorized user requests latest full output through `/full` or an equivalent platform action
- **THEN** the system returns only the latest completed assistant message using chunking or document/file fallback appropriate to the messenger

#### Scenario: Long output uses adapter fallback
- **WHEN** the latest assistant output exceeds the active messenger adapter text limit
- **THEN** the system chunks it or offers a document/file download according to that adapter's declared capabilities and does not silently truncate critical trailing content

#### Scenario: Full output excludes hidden data
- **WHEN** an authorized user retrieves full output through any messenger
- **THEN** the returned content excludes hidden prompts, tool internals, bot tokens, peer secrets, and full transcripts, and is limited to safe latest assistant output

#### Scenario: Progress updates are rate-limited
- **WHEN** a long-running paired session emits safe progress events
- **THEN** the system coalesces and rate-limits progress delivery per binding and messenger adapter limits

#### Scenario: Discord typing activity refreshes while turn is running
- **WHEN** an authorized Discord prompt is accepted and the target Pi session enters or remains in a running turn
- **THEN** PiRelay sends Discord typing activity immediately and refreshes it periodically while the turn is non-terminal because Discord typing indicators expire automatically
- **AND** typing refresh is best-effort: failures are recorded as safe diagnostics and do not block prompt delivery, completion, failure, or abort notifications

#### Scenario: Discord typing activity stops on terminal state
- **WHEN** the Discord-originated Pi turn completes, fails, aborts, is disconnected, or the binding is paused
- **THEN** PiRelay stops refreshing Discord typing activity and lets the platform indicator expire naturally

#### Scenario: Progress preferences apply per messenger binding
- **WHEN** one messenger binding is configured quiet and another binding for the same session is configured verbose
- **THEN** progress delivery respects each binding independently while terminal notifications still reach both bindings

### Requirement: Shared media relay semantics
The system SHALL apply common media validation and latest-image retrieval behavior before using messenger-specific transport operations.

#### Scenario: Authorized image prompt is accepted
- **WHEN** an authorized messenger user sends a supported image and the current Pi model supports images
- **THEN** the system validates size and MIME type, downloads after authorization, and injects a prompt containing text plus image content blocks

#### Scenario: Current model lacks image support
- **WHEN** an authorized messenger user sends an image but the target Pi model does not support image input
- **THEN** the system rejects the image-bearing prompt without injecting a partial text-only prompt

#### Scenario: Latest images are requested
- **WHEN** an authorized user requests latest images for a current assistant turn
- **THEN** the system sends only bounded latest-turn image outputs or validated workspace image references through the messenger adapter's safe file transport

#### Scenario: Latest image retrieval falls back by adapter capability
- **WHEN** a messenger adapter cannot send inline image buttons or image documents for latest-turn images
- **THEN** the system exposes a safe text-command or file/document fallback instead of making image retrieval Telegram-only

#### Scenario: Outbound image validation fails
- **WHEN** latest-image retrieval targets an unsafe, missing, unsupported, oversized, traversal, symlinked, or outside-workspace file reference
- **THEN** the system rejects that image for every messenger adapter with an actionable safe error and continues sending any remaining valid images

### Requirement: Shared guided actions and stale-state handling
The system SHALL handle guided answers, custom answers, dashboards, full-output buttons, image buttons, and ambiguity confirmations with messenger-neutral action state.

#### Scenario: Current action is invoked
- **WHEN** an authorized user invokes a current action through a platform button, callback, slash interaction, or text fallback
- **THEN** the system validates messenger identity, route, action kind, and turn id before executing the action once

#### Scenario: Stale action is invoked
- **WHEN** a user invokes an action tied to an older assistant turn, expired confirmation, or superseded session state
- **THEN** the system rejects the stale action and does not inject anything into Pi

#### Scenario: Adapter lacks buttons
- **WHEN** a messenger adapter cannot render inline buttons for a guided action
- **THEN** the system exposes a safe text-command fallback with equivalent authorization and stale-state checks

#### Scenario: Guided choice completion is returned through original messenger
- **WHEN** an authorized user answers a guided choice through Telegram buttons, Discord components, Slack Block Kit, slash interaction, or text fallback
- **THEN** the selected answer is injected into the bound Pi session and the eventual assistant completion is delivered back through the same messenger binding's normal terminal notification path

#### Scenario: Custom answer capture is messenger scoped
- **WHEN** a user starts custom-answer mode in one messenger and then sends ordinary text in another messenger bound to the same session
- **THEN** the custom-answer capture applies only to the original messenger identity and the other messenger text is routed by normal prompt rules

### Requirement: Closed-loop messenger parity coverage
The system SHALL provide end-to-end parity behavior for pairing, status, prompt delivery, Pi turn completion, failure, abort, output retrieval, media, guided actions, and lifecycle restoration across every live messenger adapter.

#### Scenario: Pair status prompt completion loop works per messenger
- **WHEN** an integration test or smoke test runs the flow `connect -> platform start/pair -> status -> prompt -> agent_end` for Telegram, Discord, Slack where live, or a future messenger adapter
- **THEN** the platform conversation receives pairing confirmation, status output, prompt acknowledgement, and the final assistant completion notification

#### Scenario: Failure loop works per messenger
- **WHEN** an integration test or smoke test runs a paired messenger prompt whose Pi turn fails or ends without final assistant text
- **THEN** the same messenger receives a safe failure notification and the test asserts that no success notification was sent

#### Scenario: Abort loop works per messenger
- **WHEN** an integration test or smoke test requests abort through a paired messenger during a busy Pi turn
- **THEN** Pi cancellation is requested and the messenger receives an abort acknowledgement plus the terminal aborted notification

#### Scenario: Multi-messenger session fan-out is explicit
- **WHEN** one Pi session is bound to both Telegram and Discord and a turn completes
- **THEN** the system either notifies every eligible bound messenger according to preferences or documents and tests a configured source-only notification policy

#### Scenario: Restored binding loop works after restart
- **WHEN** PiRelay restarts with persisted messenger-neutral bindings for Telegram and Discord
- **THEN** each restored binding can run `status -> prompt -> completion` without requiring a new pairing and without choosing stale offline bindings first

#### Scenario: Broker and in-process parity loop works
- **WHEN** the same closed-loop prompt/completion scenario runs through in-process test runtime and broker-owned runtime
- **THEN** both runtimes deliver equivalent prompt routing and terminal messenger notifications or report the same offline/federation error state

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

### Requirement: Cross-conversation Telegram shared-room authorization
The system SHALL allow a Telegram shared-room group conversation to use existing private-chat pairings for the same Telegram user as authorization proof when the group event explicitly addresses the local bot.

#### Scenario: Group command uses same user's private pairing
- **WHEN** a Telegram user has one or more active private-chat pairings with the local bot and sends an explicitly addressed command such as `/sessions@<local-bot-username>` in a group containing that bot
- **THEN** the system authorizes the command using active non-revoked private-chat bindings for the same Telegram user id
- **AND** the system does not require a binding whose chat id equals the group chat id

#### Scenario: Group selection is scoped separately from private binding
- **WHEN** the authorized Telegram user sends `/use@<local-bot-username> <session>` in a group
- **THEN** the system persists the active selection under the Telegram group conversation id and Telegram user id
- **AND** the private-chat binding remains associated with the private chat conversation id

#### Scenario: Private chat selection remains independent
- **WHEN** the same Telegram user selects a session in a group with `/use@<local-bot-username> <session>` and later sends a message in the private bot chat
- **THEN** the private bot chat continues to resolve using its own private-chat active selection and bindings
- **AND** the group selection does not redirect unrelated private-chat prompts

#### Scenario: Group command does not authorize other users
- **WHEN** another Telegram user in the same group sends `/sessions@<local-bot-username>` but has no active private-chat pairing with that bot
- **THEN** the system refuses to list sessions for that other user and returns private-chat pairing guidance when a response is safe

#### Scenario: One-shot group prompt uses originating conversation
- **WHEN** the authorized Telegram user sends `/to@<local-bot-username> <session> <prompt>` in a group and the session accepts the prompt
- **THEN** immediate acknowledgements and terminal completion/failure output for that prompt are delivered to the originating group conversation according to platform limits
- **AND** the command does not change either the group active selection or the private-chat active selection

### Requirement: Slack canonical command parity
The system SHALL treat Slack as a first-class live messenger for canonical PiRelay command semantics when Slack runtime support is enabled.

#### Scenario: Slack supports canonical commands
- **WHEN** an authorized paired Slack user invokes a canonical PiRelay command through a supported Slack text form or interaction
- **THEN** PiRelay routes the command through the same command definitions, validation, session selection, usage, ambiguity, offline, paused, and error response classes as Telegram and Discord
- **AND** Slack-specific wording differs only where platform invocation or capability limits require it

#### Scenario: Slack help is requested
- **WHEN** an authorized Slack user requests help
- **THEN** the response lists the canonical PiRelay command set with Slack-specific invocation hints
- **AND** it identifies capability-gated Slack limitations such as file upload or native slash-command registration when those limitations apply

#### Scenario: Slack unsupported capability is reached
- **WHEN** a canonical command depends on a Slack capability that is disabled, unimplemented, or missing required scopes
- **THEN** PiRelay returns a clear Slack-specific limitation or setup message
- **AND** it does not fall through to generic unsupported-command help

### Requirement: Slack prompt source receives terminal result
The system SHALL send terminal result notifications for accepted Slack prompts to the Slack conversation that originated the prompt.

#### Scenario: Slack prompt is accepted while idle
- **WHEN** an authorized Slack prompt is accepted while the target Pi session is idle
- **THEN** PiRelay injects the prompt into that session
- **AND** the same Slack conversation receives the eventual completion, failure, or abort notification for that turn

#### Scenario: Slack prompt is accepted while busy
- **WHEN** an authorized Slack prompt is accepted while the target Pi session is busy
- **THEN** PiRelay applies the configured busy delivery mode and sends the immediate Slack busy acknowledgement
- **AND** the accepting Slack conversation receives the eventual terminal notification for the resulting turn when Pi emits it

#### Scenario: Slack prompt is rejected
- **WHEN** a Slack prompt cannot be routed because no session is selected, multiple sessions are ambiguous, the target is paused, the target is offline, or authorization fails
- **THEN** PiRelay returns the same class of safe routing guidance as other messengers
- **AND** it does not inject the prompt into any Pi session

### Requirement: Slack active selection parity
The system SHALL persist and honor Slack active session selections with the same messenger-neutral state semantics as other live messengers.

#### Scenario: Slack user selects a session
- **WHEN** an authorized Slack user invokes `/use <session>` or an equivalent Slack command form
- **THEN** PiRelay resolves the selector using shared session-selection rules
- **AND** it persists the active selection scoped to Slack instance, Slack conversation id, Slack user id, and machine identity when relevant

#### Scenario: Slack one-shot target is used
- **WHEN** an authorized Slack user invokes `/to <session> <prompt>` or an equivalent Slack command form
- **THEN** PiRelay resolves the target using shared selector rules and injects the prompt only when the target is unambiguous and online
- **AND** it does not change the active session pointer

#### Scenario: Duplicate Slack ingress is single-target
- **WHEN** the same Slack event is observed by multiple local runtimes, stale processes, retries, or channel history diagnostics
- **THEN** PiRelay resolves the event to at most one selected or explicitly targeted local route
- **AND** non-selected runtimes remain silent, do not inject prompts, and do not mutate unrelated session state

### Requirement: Paired sessions expose lifecycle presence
The system SHALL expose local Pi session lifecycle presence to paired messenger conversations as part of the shared messenger-neutral session semantics.

#### Scenario: Offline lifecycle preserves authorization boundary
- **WHEN** a paired Pi session goes temporarily offline during normal local shutdown
- **THEN** the messenger binding remains authorized for future restored-session use
- **AND** inbound messenger events while the session is offline are not injected into Pi until a live route is registered again

#### Scenario: Restored lifecycle resumes existing binding
- **WHEN** a Pi session restarts and restores an active persisted messenger binding
- **THEN** the paired messenger conversation can control the session again without a new pairing code
- **AND** PiRelay may notify the conversation that the session is back online according to lifecycle notification rules

#### Scenario: Local disconnect lifecycle revokes future control
- **WHEN** the local Pi user disconnects relay for a paired session
- **THEN** the system revokes that messenger binding
- **AND** future messenger events for that binding are rejected until a new pairing is completed
- **AND** PiRelay may notify the conversation that it was disconnected locally before revocation according to lifecycle notification rules

### Requirement: Slack latest-image retrieval participates in shared media semantics
The system SHALL expose latest-image retrieval and explicit safe image delivery through Slack when the Slack adapter declares and provides live outbound file upload capability.

#### Scenario: Latest image retrieval works through Slack
- **WHEN** an authorized Slack user requests latest images for a session with valid latest-turn image outputs
- **THEN** PiRelay sends those images through Slack's file transport using the same bounded latest-image set as other messengers
- **AND** skips invalid images with safe explanatory text instead of failing the whole command when at least one valid image can be sent

#### Scenario: Slack image retrieval has no images
- **WHEN** an authorized Slack user requests latest images and no latest-turn image outputs or safe workspace image references are available
- **THEN** PiRelay returns the shared no-images guidance adapted to Slack command wording

#### Scenario: Slack upload capability is unavailable
- **WHEN** the active Slack runtime cannot upload files because live operations or app scopes are unavailable
- **THEN** PiRelay returns a capability-specific limitation or setup guidance
- **AND** it does not fall through to unknown-command help

#### Scenario: Slack upload preserves authorization boundary
- **WHEN** an unauthorized Slack user sends `pirelay images`, `pirelay send-image <path>`, or an equivalent action
- **THEN** PiRelay rejects the event before loading workspace files or calling Slack upload APIs

### Requirement: Messenger final output follows shared mode-aware policy
The system SHALL apply the same terminal assistant-output delivery policy across Telegram, Discord, Slack, and future live messengers, with only platform-specific rendering and capability fallbacks differing.

#### Scenario: Quiet binding receives terminal output without progress noise
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is quiet
- **THEN** PiRelay suppresses non-terminal progress updates for that binding
- **AND** it delivers the terminal assistant output using the same safe full-output chunk-or-document policy as other terminal-notification modes
- **AND** quiet mode does not by itself cause short final assistant output to be summarized, excerpted, or whitespace-collapsed

#### Scenario: Normal binding receives full final output
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is normal
- **THEN** PiRelay sends the latest assistant output as paragraph-aware message chunks when it fits safe platform limits
- **AND** it preserves user-visible paragraph breaks, bullets, code-ish lines, and validation-result blocks in the delivered assistant output
- **AND** for Telegram, it renders supported Markdown constructs with Telegram-safe chat formatting when the rendered message fits the configured safe chunk limit
- **AND** Telegram falls back to plain text when no Markdown formatting is needed or the rendered markup would exceed safe chunk limits
- **AND** Telegram offers a Markdown download action when the source output contains Markdown tables that are rendered with chat-safe fallbacks
- **AND** it uses a document fallback when chunking would be excessive and the adapter supports documents

#### Scenario: Verbose binding receives progress and full final output
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is verbose
- **THEN** PiRelay sends non-terminal progress updates according to verbose policy
- **AND** sends the latest assistant output using the same chunk-or-document rules as normal mode

#### Scenario: Completion-only binding receives full final output without progress
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is completion-only
- **THEN** PiRelay suppresses non-terminal progress updates
- **AND** sends the latest assistant output using the same chunk-or-document rules as normal mode

#### Scenario: Progress mode does not determine final-output length
- **WHEN** a completed assistant output would fit within the messenger's configured safe text chunk policy after redaction and formatting
- **THEN** PiRelay sends that output losslessly as chat text for every progress mode that emits terminal notifications
- **AND** it does not replace the output with a whitespace-collapsed deterministic summary only because the binding uses quiet mode or only to reduce a comparable-size message

#### Scenario: Shortened output offers full retrieval
- **WHEN** PiRelay sends a terminal notification whose visible assistant text is summarized, excerpted, truncated, reformatted, or otherwise not equal to the latest full assistant output
- **THEN** the notification includes a supported `/full` hint, button, equivalent command, or document/download action for retrieving the full output

#### Scenario: Broker and in-process terminal output are equivalent
- **WHEN** the same Telegram completion is delivered through the in-process runtime and the broker-owned runtime
- **THEN** both paths apply the same progress-mode, chunking, formatting-preservation, summary/excerpt, and full-output retrieval policy
- **AND** neither path silently downgrades a small readable output to a collapsed summary while the other sends it in full

#### Scenario: Full output is never silently truncated
- **WHEN** a final assistant output exceeds platform text limits and document delivery is unavailable
- **THEN** PiRelay reports an explicit capability limitation or retrieval fallback
- **AND** does not silently drop critical trailing content

### Requirement: Remote requester context is preserved for safe relay actions
The system SHALL preserve non-secret requester context for authorized remote prompts and commands so internal relay actions can respond to the correct messenger conversation without guessing or using raw destination input.

#### Scenario: Remote prompt establishes requester context
- **WHEN** an authorized Telegram, Discord, Slack, or future messenger user sends a prompt that is delivered to an online Pi session
- **THEN** PiRelay records non-secret requester context for that route and turn, including messenger kind, instance id, conversation id, optional thread id, authorized user id, session key, and safe display label
- **AND** the context is available to assistant-callable relay actions during that turn

#### Scenario: Remote command uses selected session context
- **WHEN** an authorized remote user invokes `send-file <relative-path>` through the active messenger command surface
- **THEN** PiRelay resolves the selected session using the same active-selection and `/use` rules as other remote controls
- **AND** delivers the file request only if the selected session is online and unambiguous

#### Scenario: Active session selection is respected before file request
- **WHEN** an authorized remote user changes the active session with `/use <session>` or an equivalent command and then requests a file
- **THEN** PiRelay applies the file request to the selected session's workspace and route
- **AND** does not read files from another paired session with a similar label

#### Scenario: Requester context is stale or ambiguous
- **WHEN** a relay file action cannot determine exactly one authorized requesting conversation for the target route
- **THEN** PiRelay refuses the action with safe guidance
- **AND** does not fall back to the latest local binding, another messenger, all messengers, or a raw destination id

#### Scenario: Requester context excludes sensitive data
- **WHEN** PiRelay stores or forwards requester context for file delivery
- **THEN** the context contains only non-secret routing and identity metadata
- **AND** it excludes bot tokens, signing secrets, prompt transcripts, file bytes, upload URLs, and hidden session data

### Requirement: Remote disconnect is requester-conversation scoped
The system SHALL interpret remote `/disconnect` or equivalent messenger disconnect commands as revoking only the requesting conversation binding for the selected session, while preserving unrelated messenger bindings for that session.

#### Scenario: Telegram chat disconnects from a multi-messenger session
- **WHEN** an authorized Telegram private chat invokes `/disconnect` for a Pi session that also has active Slack or Discord bindings
- **THEN** PiRelay revokes the Telegram chat binding for that session
- **AND** it does not revoke the Slack or Discord bindings for the same session

#### Scenario: Slack or Discord disconnect does not revoke Telegram
- **WHEN** an authorized Slack or Discord conversation invokes its disconnect command for a Pi session that also has an active Telegram binding
- **THEN** PiRelay revokes only the requesting Slack or Discord conversation binding
- **AND** it does not revoke the Telegram binding or other messenger bindings for the same session

#### Scenario: Local disconnect remains session-wide
- **WHEN** the local Pi user invokes `/relay disconnect` for the current session
- **THEN** PiRelay revokes all active Telegram, Discord, Slack, and future messenger bindings for that session according to local command semantics
- **AND** this local behavior is distinct from requester-conversation scoped remote disconnect

### Requirement: Revoked bindings receive no session feedback
The system SHALL prevent any revoked messenger binding from receiving session-scoped output, actions, or protected retrieval responses until a fresh pairing recreates an active binding.

#### Scenario: Completion after remote disconnect is not delivered to revoked chat
- **WHEN** a Telegram chat disconnects from a Pi session and the same session later completes work that was initiated or kept alive through Slack, Discord, local Pi, or another binding
- **THEN** PiRelay does not send Telegram completion, failure, abort, progress, full-output buttons, latest-image buttons, or document fallback messages to the disconnected Telegram chat
- **AND** active non-revoked bindings for the same session may still receive their own eligible notifications

#### Scenario: Broker-level sessions command remains available
- **WHEN** a disconnected Telegram chat invokes `/sessions` after its binding was revoked
- **THEN** PiRelay may respond with broker-level state such as no paired sessions for that chat and re-pair guidance
- **AND** the response does not include protected assistant output, session-control buttons, or stale paired-session actions for the revoked binding

#### Scenario: Stale action after disconnect is refused
- **WHEN** a user invokes a pre-disconnect button, callback, guided-answer action, full-output download, latest-image download, or equivalent stale action for a revoked binding
- **THEN** PiRelay refuses the action with a safe stale-or-disconnected response
- **AND** it does not reveal assistant output, download files/images, mutate session state, or re-pair the chat

#### Scenario: New pairing restores delivery
- **WHEN** the same messenger conversation completes a fresh valid pairing after disconnect
- **THEN** PiRelay creates a new active binding
- **AND** future session feedback may be delivered according to normal authorization, selection, and progress-mode rules

### Requirement: Messenger route actions preserve turn ownership safely
The system SHALL preserve requester, output destination, and turn-scoped ownership state only for route actions that are accepted by an available Pi session.

#### Scenario: Accepted remote prompt owns the resulting turn
- **WHEN** an authorized Telegram, Discord, Slack, or future messenger prompt is accepted by an available Pi route
- **THEN** PiRelay records requester and output routing context for that accepted turn so completion, failure, abort, files, and final output can return to the correct messenger conversation

#### Scenario: Unavailable prompt does not own a future turn
- **WHEN** an authorized messenger prompt cannot be accepted because the selected Pi route is unavailable before or during prompt injection
- **THEN** PiRelay returns safe unavailable guidance through that messenger
- **AND** it does not retain requester, pending-turn, activity, or shared-room output state that could affect a later unrelated turn

#### Scenario: Shared-room one-shot output is scoped to accepted prompt
- **WHEN** an authorized shared-room one-shot prompt reserves the originating conversation for terminal output
- **THEN** that output destination remains in effect only if the prompt is accepted by the target route
- **AND** the destination is cleared if route delivery becomes unavailable before acceptance

### Requirement: Messenger controls use route-action outcomes
The system SHALL render abort, compact, and prompt-control results from typed route-action outcomes rather than treating route-unavailable races as successful controls or generic messenger failures.

#### Scenario: Abort race reports unavailable
- **WHEN** an authorized user requests abort and the route becomes unavailable after the initial busy check
- **THEN** PiRelay reports the session as unavailable through the requesting messenger
- **AND** it does not leave the route marked abort-requested

#### Scenario: Compact race reports unavailable
- **WHEN** an authorized user requests compaction and the route becomes unavailable after the initial route check
- **THEN** PiRelay reports the session as unavailable through the requesting messenger
- **AND** it does not claim compaction was requested successfully

#### Scenario: Prompt race does not mark adapter unhealthy
- **WHEN** a route-unavailable race occurs during authorized prompt delivery
- **THEN** PiRelay reports the route unavailable to the user without marking the messenger platform runtime unhealthy

### Requirement: Protected messenger side effects require current binding authority
The system SHALL verify current binding authority immediately before protected messenger side effects that expose session output or mutate Pi session state.

#### Scenario: Terminal output checks authority before sending
- **WHEN** a Pi turn completes, fails, or aborts and PiRelay is about to send terminal output, summaries, full-output buttons, latest-image buttons, or document fallbacks through Telegram, Discord, Slack, or a future messenger
- **THEN** PiRelay resolves the target binding through binding authority for the expected messenger destination
- **AND** sends only when the result permits delivery for that destination and binding state

#### Scenario: Callback and action checks authority before serving content
- **WHEN** a user invokes a dashboard, full-output, Markdown download, latest-image, guided-answer, abort, compact, pause, resume, or similar action that was rendered before a disconnect, pause, or re-pair
- **THEN** PiRelay re-checks binding authority before returning protected content or mutating Pi state
- **AND** rejects the action safely when the binding is revoked, paused, moved, missing, state-unavailable, unauthorized, or stale

#### Scenario: Remote file delivery checks authority before filesystem reads and uploads
- **WHEN** a remote requester or assistant-triggered requester flow attempts to deliver a workspace file through a messenger
- **THEN** PiRelay resolves the original requester binding through binding authority before reading the file or calling the messenger upload API
- **AND** refuses delivery if the requester binding is revoked, paused, moved, missing, or state-unavailable

#### Scenario: State unavailable fails closed for protected delivery
- **WHEN** authoritative state is unreadable or cannot be parsed while protected messenger delivery is being evaluated
- **THEN** PiRelay does not send output, buttons, documents, images, activity, or lifecycle notifications using route bindings or recent caches
- **AND** it records or reports only secret-safe diagnostics appropriate to the runtime context

### Requirement: Deferred messenger work preserves original destination identity
The system SHALL ensure deferred messenger activity, typing, progress, and lifecycle-related work remains scoped to the destination for which it was scheduled.

#### Scenario: Progress timer fires after binding is cleared
- **WHEN** a progress update timer was scheduled for a messenger destination and the route binding has been cleared before the timer fires
- **THEN** PiRelay uses the captured destination key to clear the pending progress state
- **AND** does not leak progress state or send the update to another destination

#### Scenario: Typing or activity refresh stops after destination changes
- **WHEN** typing or activity refresh was scheduled for one conversation and the session is later re-paired or selected in another conversation
- **THEN** the refresh checks authority for the original destination
- **AND** stops the original indicator instead of refreshing activity in the new conversation

#### Scenario: Paused binding suppresses non-terminal delivery without revoking
- **WHEN** a binding is paused while non-terminal progress, typing, or activity refresh work is pending
- **THEN** PiRelay clears or stops the pending non-terminal delivery for that destination
- **AND** preserves the persisted paused binding for future resume, status, and safe command handling

### Requirement: Recent binding caches cannot override persisted authority
The system SHALL use recent binding caches only as bounded hints and never as authority over persisted binding state.

#### Scenario: Revoked persisted binding suppresses cached completion
- **WHEN** a recent cache still contains a messenger destination but persisted state marks the session binding revoked
- **THEN** PiRelay does not deliver completion, progress, lifecycle, file, image, or full-output content to the cached destination

#### Scenario: Moved persisted binding suppresses stale cached destination
- **WHEN** a recent cache points at an old conversation but persisted state contains an active binding for the same session and messenger instance in a different conversation
- **THEN** PiRelay treats the cached destination as stale
- **AND** does not send the deferred or protected response to either destination unless the current operation explicitly targets and authorizes one of them

#### Scenario: Cache fallback requires successful state load
- **WHEN** PiRelay cannot confirm persisted state because state loading failed
- **THEN** recent caches and route-local bindings are not used to authorize protected delivery

### Requirement: Inbound GIF image prompts use first-frame conversion
The system SHALL accept authorized inbound GIF image attachments for Pi image prompts by converting the GIF's first frame to a supported static image before prompt injection.

#### Scenario: Authorized GIF is accepted for image-capable model
- **WHEN** an authorized paired messenger user sends an inbound `image/gif` attachment and the selected Pi model supports image input
- **THEN** PiRelay validates the attachment size, downloads it only after authorization, converts the first GIF frame to a supported static image MIME type, and injects the prompt with text plus the converted image content block

#### Scenario: GIF caption is preserved as prompt text
- **WHEN** an authorized paired messenger user sends an inbound GIF with caption text and the GIF converts successfully
- **THEN** PiRelay uses the caption as the prompt text and attaches the converted first-frame image

#### Scenario: Image-only GIF uses image inspection fallback
- **WHEN** an authorized paired messenger user sends an inbound GIF without caption text and the GIF converts successfully
- **THEN** PiRelay uses the same safe image-inspection fallback prompt used for other image-only messages and attaches the converted first-frame image

#### Scenario: Current model lacks image support for GIF
- **WHEN** an authorized paired messenger user sends an inbound GIF but the selected Pi model does not support image input
- **THEN** PiRelay rejects the image-bearing prompt without injecting the caption as a partial text-only prompt

#### Scenario: GIF conversion fails safely
- **WHEN** an authorized paired messenger user sends a corrupt, unsupported, oversized, or conversion-failing GIF
- **THEN** PiRelay returns a safe actionable error through the originating messenger and does not inject any prompt or persist the GIF bytes in relay state

#### Scenario: Mixed direct and convertible images are accepted together
- **WHEN** an authorized paired messenger user sends a supported direct image and a valid GIF attachment in the same message and the selected Pi model supports image input
- **THEN** PiRelay preserves the direct image content and includes the converted GIF first-frame image in the same prompt delivery subject to existing message and size limits

### Requirement: Messenger-neutral approval UX
PiRelay SHALL expose approval requests and decisions through every first-class live messenger adapter with equivalent authorization and stale-state behavior.

#### Scenario: Approval request is sent to Telegram
- **WHEN** a Telegram-originated remote turn requires approval for a sensitive operation
- **THEN** PiRelay sends the authorized Telegram chat a bounded approval request with Approve once and Deny actions when Telegram buttons are available
- **AND** includes Approve for session when session-scoped grants are enabled

#### Scenario: Approval request is sent to Discord
- **WHEN** a Discord-originated remote turn requires approval for a sensitive operation
- **THEN** PiRelay sends the authorized Discord conversation a bounded approval request with component actions or a documented text/action fallback

#### Scenario: Approval request is sent to Slack
- **WHEN** a Slack-originated remote turn requires approval for a sensitive operation
- **THEN** PiRelay sends the authorized Slack conversation or thread a bounded approval request with Block Kit actions or a documented text/action fallback

#### Scenario: Messenger lacks button capability
- **WHEN** the active messenger adapter cannot render interactive approval buttons
- **THEN** PiRelay provides a safe fallback or reports that approvals cannot be completed through that adapter
- **AND** it does not auto-approve the operation

### Requirement: Approval authorization parity
PiRelay SHALL require the same active persisted binding authorization for approval decisions as for prompts, callbacks, file requests, and control actions.

#### Scenario: Authorized requester approves
- **WHEN** the same authorized user in the same active conversation/thread approves an unexpired pending operation for the same session
- **THEN** PiRelay accepts the decision and resolves the pending approval as approved

#### Scenario: Different user attempts approval
- **WHEN** a different platform user, unpaired user, disallowed user, or untrusted identity invokes an approval action
- **THEN** PiRelay rejects the action and does not resolve the pending approval

#### Scenario: Conversation-scoped disconnect happens while approval is pending
- **WHEN** the approval conversation sends `/disconnect`, `relay disconnect`, `pirelay disconnect`, or the binding is otherwise revoked before a decision
- **THEN** PiRelay cancels or expires pending approvals for that binding
- **AND** future approval actions from that conversation are rejected until re-paired

### Requirement: Approval responses are safe and bounded
PiRelay SHALL acknowledge approval decisions without exposing sensitive operation data.

#### Scenario: Approval decision is acknowledged
- **WHEN** an approval is approved once, approved for session, persistently granted, denied, expired, cancelled, stale, unauthorized, or a grant is used/revoked
- **THEN** PiRelay sends a concise safe response that identifies the outcome, grant scope, expiry when applicable, and session label when appropriate
- **AND** does not include raw tool input, hidden prompts, full transcripts, file bytes, bot tokens, or unredacted secrets

#### Scenario: Persistent approval option is hidden by default
- **WHEN** local configuration has not enabled remote persistent grants
- **THEN** no messenger approval request offers an approve-forever or persistent grant action

### Requirement: Delegated prompt delivery
Messenger relay sessions SHALL support prompt delivery that originates from a claimed shared-room delegation task while preserving existing authorization, route safety, and output scoping rules.

#### Scenario: Delegated task prompt is handed to target session
- **WHEN** a delegation task is claimed for an online local session and policy allows execution
- **THEN** PiRelay injects a bounded task prompt into that session using the same route-action safety rules as ordinary remote prompts
- **AND** the prompt identifies the task id, source machine/session, goal, constraints, and report destination

#### Scenario: Delegated task prompt cannot be delivered
- **WHEN** the selected target session is offline, stale, paused, revoked, unavailable, or ambiguous before prompt handoff
- **THEN** PiRelay does not acknowledge successful task start
- **AND** it marks or reports the task as blocked, failed, or needing human intervention according to policy

#### Scenario: Delegated output is sent to task room
- **WHEN** a delegated task completes, fails, is aborted, or is blocked for approval
- **THEN** PiRelay sends a bounded task update to the originating shared room or thread through the target machine bot identity
- **AND** it does not also send delegated completion, progress, media, or guided-action output to unrelated paired private chats or active selections for the same route
- **AND** non-target machine bots do not send completion, progress, media, or guided-action output for that task

### Requirement: Delegation task controls
Messenger relay sessions SHALL expose task controls through platform-appropriate commands, buttons, or text fallbacks without weakening normal remote command authorization.

#### Scenario: Authorized human cancels task
- **WHEN** an authorized human sends a task cancel command or uses a task cancel action for a pending, claimed, running, or blocked task
- **THEN** PiRelay cancels the task if the human is authorized for the task room and machine scope
- **AND** it rejects future claim/update actions for that task id

#### Scenario: Unauthorized user invokes task action
- **WHEN** an unauthorized user invokes claim, approve, decline, cancel, or status for a delegation task
- **THEN** PiRelay rejects the action before prompt injection, media download, route mutation, approval resolution, or task-state mutation

#### Scenario: Delegation command arrives outside paired room boundary
- **WHEN** a user or peer bot sends a delegation command in a group/channel that is not enabled, paired, or selected as a shared-room control surface for that messenger instance
- **THEN** PiRelay rejects or ignores the command before task creation, task mutation, prompt injection, callback handling, or media download

#### Scenario: Telegram human delegation requires private pairing
- **WHEN** a non-bot Telegram user addresses the bot with a delegation command in a group where that user has not completed the private pairing/session setup required for other group controls
- **THEN** PiRelay rejects or guides setup before task creation, task mutation, or prompt injection
- **AND** this human pairing boundary does not prevent explicitly configured trusted Telegram peer bots from being evaluated through peer-trust policy

#### Scenario: Task status is requested
- **WHEN** an authorized user requests status for a delegation task visible in the current room or thread
- **THEN** PiRelay returns bounded task state including id, source, target, status, claimant when non-secret, expiry, and latest safe update

#### Scenario: Text fallbacks use executable commands
- **WHEN** PiRelay renders delegation task action text fallbacks for Slack, Discord, or Telegram
- **THEN** the fallback commands match that platform's currently parsed command surface
- **AND** unsupported slash-command syntax is not advertised as the only way to perform a task action

### Requirement: Remote turn ownership drives approval requester context
PiRelay SHALL associate approval requester context only with accepted remote messenger prompts and SHALL clear or ignore that context for local-only turns.

#### Scenario: Accepted remote prompt establishes approval requester
- **WHEN** an authorized Telegram, Discord, Slack, or future messenger prompt is accepted by an online Pi session
- **THEN** PiRelay records the active requester context for the resulting turn so enabled approval gates can ask the correct messenger user for decisions
- **AND** approval decisions remain scoped to that requester, conversation or thread, session, and active binding

#### Scenario: Local prompt has no approval requester
- **WHEN** the local Pi user starts a prompt directly in the Pi session
- **THEN** PiRelay treats the turn as local for approval-gate purposes
- **AND** it does not infer an approval requester from the latest binding, latest remote requester, active selection, or previous remote turn

#### Scenario: Remote requester context is cleared after turn ownership ends
- **WHEN** a remote-owned turn completes, fails, aborts, is compacted, is disconnected, or otherwise ends
- **THEN** PiRelay clears or invalidates requester context for later local turns
- **AND** later local tool calls do not send approval requests to the previous requester

#### Scenario: Remote turn loses requester before approval
- **WHEN** a remote-owned turn reaches a matching approval-gated operation after its requester context or binding becomes stale, revoked, paused, missing, or state-unavailable
- **THEN** PiRelay fails closed for that remote operation
- **AND** it does not downgrade the operation to local approval bypass

### Requirement: Coalesced live progress delivery
The system SHALL deliver Pi session progress to messengers as coalesced live state rather than as a direct stream of raw Pi events.

#### Scenario: Repeated live status is not duplicated
- **WHEN** Pi emits repeated assistant stream updates, repeated safe model status text, or otherwise equivalent progress activities for the same running turn
- **THEN** the messenger receives at most one current live-progress representation for that equivalent status within the configured delivery window
- **AND** the system does not post a new chat message for every repeated raw Pi event

#### Scenario: Superseded live status is coalesced
- **WHEN** multiple volatile progress updates occur before the messenger delivery window elapses
- **THEN** the system delivers the latest coalesced safe status, plus any stable milestones that remain relevant
- **AND** superseded volatile snapshots are not delivered as separate messenger messages

#### Scenario: Editable messengers update live status in place
- **WHEN** a messenger adapter supports updating a previously sent message and a paired binding is eligible to receive progress
- **THEN** the system uses a single live progress message for the active turn where practical
- **AND** later live progress updates edit that message instead of appending duplicate chat messages
- **AND** final completion, failure, abort, and full-output messages remain separate terminal notifications

#### Scenario: Non-editable messengers receive coalesced snapshots
- **WHEN** a messenger adapter does not support updating a previously sent progress message or an update attempt fails
- **THEN** the system falls back to sending coalesced progress snapshots at the configured cadence
- **AND** it still avoids sending duplicate raw stream-event messages

#### Scenario: Normal progress mode is low-noise
- **WHEN** a binding uses normal progress mode during a running Pi turn
- **THEN** the messenger receives stable milestones and coalesced live status only
- **AND** generic assistant streaming snapshots, repeated drafting text, and overlapping tool-result bookkeeping messages are not delivered as standalone progress messages

#### Scenario: Verbose progress mode remains bounded
- **WHEN** a binding uses verbose progress mode during a running Pi turn
- **THEN** the messenger MAY receive more detailed progress than normal mode
- **BUT** repeated equivalent updates MUST still be deduplicated or coalesced
- **AND** delivery MUST respect the configured verbose progress interval and platform message limits

#### Scenario: Completion-only and quiet progress modes remain respected
- **WHEN** a binding uses completion-only progress mode
- **THEN** the messenger receives terminal final output and explicitly allowed lifecycle notices such as compaction progress
- **AND** it does not receive ordinary live progress snapshots
- **WHEN** a binding uses quiet progress mode
- **THEN** the messenger does not receive live progress snapshots or compaction progress notifications

#### Scenario: Tool lifecycle progress is human-level in normal mode
- **WHEN** Pi emits overlapping tool lifecycle events such as tool execution completion and tool-result message completion for the same tool call
- **THEN** normal progress mode does not deliver both as separate technical messages
- **AND** the system either collapses them into one safe human-readable milestone or omits successful short-lived tool chatter

#### Scenario: Live progress remains secret-safe
- **WHEN** the system formats or updates live progress for any messenger
- **THEN** it excludes hidden thinking content, chain-of-thought, hidden prompts, raw transcripts, pairing codes, bot tokens, raw chat or channel identifiers, and full compaction summaries
- **AND** only sanitized safe progress text may be stored or delivered

#### Scenario: Authorization still gates progress delivery
- **WHEN** a binding is paused, revoked, stale, unauthorized, or no longer authoritative for a route
- **THEN** the system does not send, edit, or finalize live progress messages for that binding
- **AND** any pending live progress state for that destination is cleared or ignored safely

### Requirement: Compaction progress notifications follow binding progress mode
The system SHALL notify eligible paired messenger bindings when a Pi session compaction starts and when it successfully completes, and SHALL suppress those notifications only for bindings whose progress mode is quiet.

#### Scenario: Compaction start is delivered in non-quiet modes
- **WHEN** a paired Pi session emits `session_before_compact`
- **AND** a Telegram, Discord, Slack, or future messenger binding for that session has progress mode normal, verbose, or completion-only
- **THEN** PiRelay sends or schedules a safe compaction-start progress notification for that binding

#### Scenario: Compaction start is suppressed in quiet mode
- **WHEN** a paired Pi session emits `session_before_compact`
- **AND** a messenger binding for that session has progress mode quiet
- **THEN** PiRelay does not send a compaction-start progress notification to that binding

#### Scenario: Compaction completion is delivered in non-quiet modes
- **WHEN** a paired Pi session emits `session_compact` after successfully appending a compaction entry
- **AND** a Telegram, Discord, Slack, or future messenger binding for that session has progress mode normal, verbose, or completion-only
- **THEN** PiRelay sends or schedules a safe compaction-completed progress notification for that binding

#### Scenario: Compaction completion is suppressed in quiet mode
- **WHEN** a paired Pi session emits `session_compact` after successfully appending a compaction entry
- **AND** a messenger binding for that session has progress mode quiet
- **THEN** PiRelay does not send a compaction-completed progress notification to that binding

#### Scenario: Compaction notifications are safe
- **WHEN** PiRelay formats a compaction start or completion notification
- **THEN** the notification omits bot tokens, pairing codes, hidden prompts, tool internals, raw chat ids, raw channel ids, workspace ids, full transcripts, and compaction summary contents
- **AND** it does not expose whether compaction was triggered manually, by threshold, or by overflow unless Pi has provided that information through a safe extension event

#### Scenario: Compaction notification failures are nonfatal
- **WHEN** PiRelay cannot deliver a compaction start or completion notification to an eligible binding
- **THEN** compaction handling continues without failing, cancelling, or corrupting the Pi session
- **AND** PiRelay records or reports only secret-safe diagnostics

#### Scenario: Revoked or unauthorized bindings receive no compaction notifications
- **WHEN** a compaction start or completion notification is about to be delivered
- **THEN** PiRelay verifies the destination remains an active authorized binding according to existing binding authority and adapter delivery rules
- **AND** it does not send the notification to revoked, paused, unauthorized, missing, or stale destinations

### Requirement: Live progress updates use in-place delivery where supported
The system SHALL deliver non-terminal live progress as an updated per-destination progress message when the active messenger adapter supports bot-message updates, while preserving safe snapshot fallback for unsupported or failed update paths.

#### Scenario: Supported adapter updates existing progress
- **WHEN** a paired running session emits multiple eligible progress updates for a binding whose messenger adapter supports live progress updates
- **THEN** PiRelay updates the existing live progress message for that destination rather than sending a new message for each progress flush
- **AND** the progress content remains coalesced, rate-limited, redacted, and bounded by configured progress limits

#### Scenario: Unsupported adapter sends snapshots
- **WHEN** a paired running session emits eligible progress updates for a binding whose messenger adapter does not support live progress updates
- **THEN** PiRelay sends bounded coalesced progress snapshots according to the binding's progress mode
- **AND** it does not treat missing edit capability as an adapter failure

#### Scenario: Update failure falls back safely
- **WHEN** updating an existing live progress message fails because the message was deleted, expired, inaccessible, or rejected by the platform
- **THEN** PiRelay clears that live progress reference and falls back to sending a new live progress message or plain snapshot
- **AND** final failure to deliver progress is swallowed because non-terminal progress is best-effort

#### Scenario: Terminal output remains separate
- **WHEN** a Pi turn completes, fails, or aborts after live progress updates were sent or edited
- **THEN** PiRelay sends terminal output or notification according to final-output policy as a separate messenger result
- **AND** it does not merge final assistant output into the live progress card

#### Scenario: Progress modes still apply independently
- **WHEN** one binding is normal, another is verbose, another is completion-only, and another is quiet
- **THEN** live progress update/edit behavior respects each binding's existing progress-mode eligibility independently
- **AND** quiet receives no live progress while completion-only receives no ordinary live progress

