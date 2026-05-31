## ADDED Requirements

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
