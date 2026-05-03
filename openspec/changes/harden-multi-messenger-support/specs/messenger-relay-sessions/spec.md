## ADDED Requirements

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
- **WHEN** a live Telegram, Discord, Slack, or future messenger adapter receives `/help`, `/status`, `/sessions`, `/use`, `/to`, `/alias`, `/forget`, `/progress`, `/recent`, `/summary`, `/full`, `/images`, `/send-image`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, or `/disconnect` from an authorized user
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
- **WHEN** an authorized Discord DM user sends `relay status`, `relay sessions`, `relay full`, `relay abort`, or another canonical command using the `relay <command>` text-prefix form
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
