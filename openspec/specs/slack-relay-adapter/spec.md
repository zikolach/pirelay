# slack-relay-adapter Specification

## Purpose
Defines Slack adapter behavior for pairing, authorization, prompt relay, output retrieval, and bounded media transport through Slack DMs or explicitly authorized channel contexts.
## Requirements
### Requirement: Slack DM pairing and authorization
The system SHALL allow a local Pi user to pair the active Pi session with an authorized Slack app direct-message conversation.

#### Scenario: Slack pairing is initiated
- **WHEN** the local user starts Slack relay pairing for a Pi session
- **THEN** the system displays a time-limited pairing instruction scoped to that session and the configured Slack workspace/app

#### Scenario: Authorized Slack user completes pairing
- **WHEN** the configured Slack app receives a valid pairing command from an allowed Slack user before expiry
- **THEN** the system binds that Slack workspace/user/DM identity to the Pi session

#### Scenario: Slack channel sends command by default
- **WHEN** a Slack public or private channel sends a PiRelay command and channel control is not explicitly enabled
- **THEN** the system rejects the command and does not inject anything into Pi

### Requirement: Slack prompt and output relay
The system SHALL support core PiRelay prompt delivery and output retrieval through Slack DMs.

#### Scenario: Slack text prompt is sent
- **WHEN** an authorized Slack DM user sends non-command text while the paired Pi session is online and unpaused
- **THEN** the system injects the text into Pi using the same idle and busy delivery rules as other relay channels

#### Scenario: Slack output is too long
- **WHEN** a Pi completion output exceeds Slack message or block limits
- **THEN** the system chunks the output or offers a file download according to Slack adapter capabilities

#### Scenario: Slack user taps action button
- **WHEN** an authorized Slack DM user taps a current action button
- **THEN** the system validates the action and performs the selected shared relay behavior

### Requirement: Slack app security
The system SHALL validate Slack app requests and keep Slack credentials secret-safe.

#### Scenario: Slack request signature is invalid
- **WHEN** the Slack adapter receives an interaction or event with an invalid signature or timestamp
- **THEN** the system rejects the request and does not affect any Pi session

#### Scenario: Session history is exported
- **WHEN** a session containing Slack relay metadata is exported or shared
- **THEN** the exported history does not include Slack bot tokens, signing secrets, OAuth tokens, or active pairing secrets

### Requirement: Slack shared-room runtime parity
The system SHALL either implement Slack shared-room runtime routing for explicitly enabled channel contexts or report precise unsupported limitations through capabilities, setup, and diagnostics.

#### Scenario: Slack shared-room channel support is enabled
- **WHEN** Slack shared-room mode and channel message control are explicitly enabled for an allowed workspace/channel/user
- **THEN** Slack app mentions or documented channel command forms route through shared-room pre-routing before prompt injection
- **AND** local machine targets, active selections, and one-shot prompts use the same shared selector semantics as other messengers

#### Scenario: Slack event targets another machine bot
- **WHEN** a Slack channel event mentions or otherwise targets another PiRelay machine bot
- **THEN** the local broker remains silent and does not send any user-visible acknowledgement/response, inject prompts, mutate active selection, download media, send ephemeral responses, or post channel messages

#### Scenario: Slack channel support is disabled
- **WHEN** Slack channel messages or shared-room mode are not explicitly enabled
- **THEN** Slack rejects or ignores channel events before pairing, prompt injection, media download, active selection, or action execution
- **AND** setup and diagnostics explain the DM-first safe default and the exact configuration required to enable channel/shared-room behavior

#### Scenario: Slack app mention is unauthorized
- **WHEN** a Slack app mention or channel command arrives from a user outside the configured allow-list or workspace boundary
- **THEN** PiRelay rejects it before prompt injection, media download, callback/action execution, or session-state mutation and responds only when the response is safe for that Slack context

### Requirement: Slack shared-room setup inventory
The system SHALL document Slack-specific requirements for shared-room operation.

#### Scenario: Slack setup guidance describes shared rooms
- **WHEN** `/relay setup slack`, setup TUI, or `/relay doctor` describes shared-room mode
- **THEN** it names required Slack scopes/event subscriptions, Socket Mode or webhook delivery requirements, channel membership, app mention/channel message behavior, workspace/user allow-list requirements, and any unsupported gaps
- **AND** it keeps Slack DM-first behavior as the default safe recommendation

### Requirement: Slack live pairing completion
The system SHALL complete Slack pairings through the live Slack runtime using channel-scoped, single-use, expiring pending pairings.

#### Scenario: Slack pairing command is accepted in DM
- **WHEN** an authorized Slack user sends the displayed Slack pairing command in a direct-message conversation before expiry
- **THEN** PiRelay consumes the Slack-scoped pending pairing exactly once
- **AND** it stores a Slack channel binding for the target Pi session, Slack conversation id, Slack user id, workspace metadata, and messenger instance

#### Scenario: Slack pairing command is accepted in authorized channel
- **WHEN** Slack channel control and pairing in the channel are explicitly enabled and an authorized Slack user sends a valid pairing command in that channel before expiry
- **THEN** PiRelay may bind that Slack channel conversation to the target Pi session
- **AND** the binding records that the conversation is a channel/shared-room context

#### Scenario: Slack pairing command is rejected
- **WHEN** a Slack pairing command is expired, already consumed, for another messenger kind or instance, from the wrong workspace, or from an unauthorized Slack identity
- **THEN** PiRelay rejects the pairing without creating or mutating a binding
- **AND** it returns only safe retry or authorization guidance when Slack permits a response

### Requirement: Slack inbound prompt and command routing
The system SHALL route authorized Slack messages through canonical PiRelay command, session-selection, prompt, busy-delivery, and pause/resume semantics.

#### Scenario: Authorized Slack DM sends command
- **WHEN** an authorized paired Slack DM user sends `/status`, `/sessions`, `/use`, `/to`, `/summary`, `/full`, `/recent`, `/abort`, `/compact`, `/pause`, `/resume`, `/disconnect`, or another canonical command
- **THEN** PiRelay executes the corresponding messenger-neutral command behavior
- **AND** Slack does not fall through to a generic unsupported-command response for implemented canonical commands

#### Scenario: Authorized Slack DM sends prompt
- **WHEN** an authorized paired Slack DM user sends non-command text while the target Pi session is online and unpaused
- **THEN** PiRelay injects the text into the selected Pi session using the same idle and busy delivery rules as other live messengers
- **AND** it sends Slack acknowledgement or busy guidance appropriate to the delivery mode

#### Scenario: Slack message is unauthorized
- **WHEN** an unpaired, disallowed, wrong-workspace, or non-selected Slack identity sends text, media, or an action
- **THEN** PiRelay rejects the event before media download, prompt injection, callback/action execution, broker forwarding, or control execution

#### Scenario: Slack bot-authored message is received
- **WHEN** Slack delivers a bot-authored message
- **THEN** PiRelay ignores the message unless that bot identity is explicitly allowed or locally trusted for the relevant messenger instance
- **AND** PiRelay always ignores messages authored by its own local Slack app identity

### Requirement: Slack outbound responses and terminal notifications
The system SHALL deliver Slack command responses, prompt acknowledgements, assistant completions, failure notifications, abort notifications, and output retrieval responses through the Slack app identity that owns the binding.

#### Scenario: Slack prompt completes
- **WHEN** an authorized Slack prompt is accepted and the Pi turn completes with assistant output
- **THEN** the originating Slack conversation receives a safe completion summary or excerpt through the owning Slack app
- **AND** long output uses Slack chunking or file/capability fallback according to adapter limits

#### Scenario: Slack prompt fails or aborts
- **WHEN** an accepted Slack prompt fails or is aborted
- **THEN** the originating Slack conversation receives a failure or aborted notification
- **AND** no Slack conversation receives a successful-completion notification for that failed or aborted turn

#### Scenario: Slack output is requested
- **WHEN** an authorized Slack user requests `/full`, `/summary`, `/images`, or `/send-image`
- **THEN** PiRelay returns the latest authorized output using Slack text, Block Kit, file upload, or explicit capability limitation behavior
- **AND** it does not expose raw session files, hidden prompts, tool internals, or protected output to unauthorized Slack identities

### Requirement: Slack interactions and Block Kit actions
The system SHALL handle Slack button/action payloads with the same authorization and guided-answer semantics as other messenger actions.

#### Scenario: Authorized Slack action is invoked
- **WHEN** an authorized Slack user invokes a current Slack Block Kit action for a paired route
- **THEN** PiRelay validates the action, performs the selected relay behavior once, and acknowledges the action through Slack

#### Scenario: Unauthorized Slack action is invoked
- **WHEN** a Slack user who is not authorized for the bound route invokes a Block Kit action
- **THEN** PiRelay rejects the action before revealing protected output or mutating session state
- **AND** it sends only a safe unauthorized action response when Slack permits a response

#### Scenario: Stale Slack action is invoked
- **WHEN** a Slack action references stale, malformed, expired, or already-handled action state
- **THEN** PiRelay returns a safe stale-action response and does not inject prompts or alter current guided-answer state

### Requirement: Slack pairing command parsing and guidance
The Slack runtime SHALL use explicit non-slash pairing commands while keeping safe compatibility for legacy pairing text.

#### Scenario: Slack help advertises non-slash commands
- **WHEN** a paired Slack user requests help
- **THEN** PiRelay shows commands in the `pirelay <command>` form
- **AND** the help text explains that leading slash text is not recommended in Slack because Slack treats it as app slash commands

#### Scenario: Slack status command is not parsed as pairing
- **WHEN** a paired Slack user sends `pirelay status`
- **THEN** PiRelay treats the message as a Slack command
- **AND** it does not report the word `status` as an invalid or expired pairing code

#### Scenario: Slack runtime guidance uses non-slash commands
- **WHEN** PiRelay sends Slack guidance for post-pairing status, paused delivery, progress usage, one-shot sends, or unknown commands
- **THEN** the guidance uses the `pirelay <command>` form instead of leading-slash command text

#### Scenario: Slack pairing accepts safe legacy forms
- **WHEN** a Slack user sends `pirelay pair <pin>` for an active pending pairing
- **THEN** PiRelay completes the Slack pairing
- **AND** legacy `pirelay <pin>` and `/pirelay <pin>` text are accepted only when `<pin>` matches a real pending PIN or nonce format
- **AND** Discord-style `relay pair <pin>` text is not treated as a Slack pairing command

#### Scenario: Unpaired Slack channel receives channel-specific guidance
- **WHEN** a Slack channel or thread message reaches the runtime without a usable binding
- **THEN** PiRelay explains that channel control requires `slack.allowChannelMessages`, a local `/relay connect slack`, and sending the highlighted `pirelay pair <pin>` command in that channel/thread
- **AND** it also explains that the user can use the paired Slack app DM instead

### Requirement: Slack channel routing after pairing
The Slack runtime SHALL keep explicit channel pairings usable for follow-up commands after pairing.

#### Scenario: Channel command routes through the paired channel binding
- **WHEN** a Slack channel has an active non-revoked binding and `slack.allowChannelMessages` is enabled
- **AND** the sender's per-user active channel selection is missing
- **THEN** a command such as `pirelay status` uses the latest active binding for that Slack conversation
- **AND** PiRelay restores the active selection for that sender

#### Scenario: Slack busy follow-up preserves thread ownership
- **WHEN** a Slack prompt arrives while the target Pi route is already busy
- **THEN** PiRelay queues the message using the configured busy delivery mode
- **AND** the current in-progress turn's completion remains targeted to the thread that started that turn

### Requirement: Slack and messenger pairing notifications
The runtime SHALL make successful remote pairings visible locally with messenger-specific labels.

#### Scenario: Slack pairing notifies the local Pi session
- **WHEN** Slack pairing completes
- **THEN** the local Pi session receives a notification identifying the Slack user and session label
- **AND** the local audit entry uses the Slack/Relay label rather than a Telegram-only label

#### Scenario: Other messenger pairings keep label parity
- **WHEN** Discord or Telegram pairing completes
- **THEN** the local Pi session receives the same style of messenger-specific pairing notification

### Requirement: Slack progress notifications
The Slack runtime SHALL deliver non-terminal progress updates for paired Slack bindings according to each binding's progress mode.

#### Scenario: Verbose Slack binding receives progress updates
- **WHEN** a Slack binding has progress mode `verbose` and the paired Pi route reports running progress events
- **THEN** PiRelay sends coalesced `Pi progress` updates to the bound Slack conversation using the verbose progress interval
- **AND** thread context is preserved when the binding was associated with a Slack thread

#### Scenario: Quiet Slack binding suppresses non-terminal progress
- **WHEN** a Slack binding has progress mode `quiet` or `completion-only`
- **THEN** PiRelay suppresses non-terminal progress updates while still allowing terminal completion notifications

### Requirement: Slack thinking indicator
The Slack runtime SHALL prefer reaction-based thinking indicators for accepted Slack prompts and fall back safely when reactions are unavailable.

#### Scenario: Accepted Slack prompt receives a thinking reaction
- **WHEN** an authorized Slack DM or channel prompt is accepted for immediate delivery to Pi
- **THEN** PiRelay adds a `thinking_face` reaction to the Slack user message that triggered the prompt
- **AND** the reaction is removed when the Pi turn completes, fails, aborts, the route is unregistered, or the Slack runtime stops

#### Scenario: Slack reaction scope is unavailable
- **WHEN** PiRelay cannot add the thinking reaction because Slack rejects the reaction call or the operation is unavailable
- **THEN** PiRelay falls back to its ephemeral `Pi is working…` activity message in the same thread when thread context is available
- **AND** prompt delivery still proceeds

#### Scenario: Slack setup manifest includes reaction scope
- **WHEN** the Slack setup wizard renders or copies the Slack app manifest
- **THEN** the manifest includes `reactions:write` so reaction-based thinking indicators can be enabled after app reinstall

### Requirement: Slack channel active selection routes prompts
The Slack adapter SHALL route unmentioned plain channel prompts only when channel control is enabled and the Slack conversation/user has an active selection pointing to an online local session.

#### Scenario: Channel pairing creates usable active selection
- **WHEN** an authorized Slack user completes pairing in a Slack channel while `slack.allowChannelMessages` is enabled
- **THEN** PiRelay persists an active channel selection for that Slack channel id, Slack user id, and paired session
- **AND** a following unmentioned non-command prompt from that same Slack user in that channel is injected into the paired Pi session

#### Scenario: Use command creates usable active selection
- **WHEN** an authorized Slack channel user sends `pirelay use <session>` and `<session>` resolves to an online local paired session for that channel/user
- **THEN** PiRelay persists the active channel selection for that Slack channel id and Slack user id
- **AND** a following unmentioned non-command prompt from that same Slack user in that channel is injected into the selected Pi session

#### Scenario: Plain channel text without local active selection is ignored
- **WHEN** an authorized Slack channel user sends unmentioned non-command text and no active selection points to a local online session for that channel/user
- **THEN** PiRelay does not inject the text into Pi
- **AND** PiRelay does not acknowledge successful delivery

### Requirement: Slack channel one-shot machine target routes prompts
The Slack adapter SHALL support documented one-shot channel prompt commands that explicitly target the local machine and session without requiring an active selection.

#### Scenario: Machine-qualified to command targets local session
- **WHEN** an authorized Slack channel user sends `pirelay to <machine> <session> <prompt>` and `<machine>` resolves to the local Slack machine identity
- **THEN** PiRelay resolves `<session>` among local paired sessions for that Slack channel/user
- **AND** PiRelay injects `<prompt>` into the resolved online Pi session
- **AND** the active selection is not changed by the one-shot command

#### Scenario: Session-only to command is handled in single-machine context
- **WHEN** an authorized Slack channel user sends `pirelay to <session> <prompt>` in a channel where the local Slack runtime can resolve `<session>` unambiguously for that channel/user
- **THEN** PiRelay injects `<prompt>` into the resolved online Pi session
- **AND** PiRelay does not require a bot mention solely because the command used the session-only form

#### Scenario: Malformed to command gives guidance
- **WHEN** an authorized Slack channel user sends a `pirelay to` command that PiRelay receives but cannot parse into a local machine/session/prompt target
- **THEN** PiRelay responds with Slack-safe usage guidance
- **AND** PiRelay does not silently claim delivery or inject a partial prompt

### Requirement: Slack mention fallback remains explicit local targeting
The Slack adapter SHALL continue to treat messages that mention the local Slack bot as explicit local targets while preserving shared-room safety for unrelated channel chatter.

#### Scenario: Mentioned prompt routes without active selection
- **WHEN** an authorized Slack channel user mentions the local Slack bot and includes prompt text while channel control is enabled
- **THEN** PiRelay strips the leading bot mention and injects the remaining prompt into the resolved local session according to normal selection rules

#### Scenario: Other channel chatter remains silent
- **WHEN** a Slack channel message does not mention the local bot, is not a recognized PiRelay command, and has no active local selection
- **THEN** PiRelay remains silent and does not inject the message into Pi

### Requirement: Slack live outbound file delivery
The Slack adapter SHALL deliver authorized outbound documents and images through live Slack Web API file upload operations when the Slack app has the required scopes and the target conversation is bound to the Pi session.

#### Scenario: Slack image command uploads latest image
- **WHEN** an authorized Slack user invokes `pirelay images` for an online paired session with latest valid image outputs
- **THEN** PiRelay uploads each bounded supported image to the bound Slack conversation using the configured Slack app identity
- **AND** the upload appears in the same Slack thread when the command originated in a thread

#### Scenario: Slack explicit image path uploads file
- **WHEN** an authorized Slack user invokes `pirelay send-image <relative-path>` for a safe supported workspace image
- **THEN** PiRelay validates the path, size, and MIME type before upload
- **AND** uploads the image to Slack with a human-readable caption

#### Scenario: Slack upload scope is missing
- **WHEN** Slack rejects an outbound file upload because the app lacks file upload permission or has not been reinstalled after scope changes
- **THEN** PiRelay returns a safe actionable error that identifies Slack file upload setup as the problem
- **AND** it does not mark the Pi prompt or unrelated Slack runtime health as failed

#### Scenario: Slack upload target is revoked
- **WHEN** a Slack binding has been revoked or is no longer active
- **THEN** PiRelay does not upload documents or images to the stale conversation

#### Scenario: Slack upload rejects unsafe file
- **WHEN** the requested outbound image is missing, outside the workspace, unsupported, oversized, symlinked unsafely, or otherwise invalid
- **THEN** PiRelay rejects that file before calling Slack upload APIs
- **AND** reports a safe actionable message to the authorized Slack conversation

