## ADDED Requirements

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
