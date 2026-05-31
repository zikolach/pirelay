## ADDED Requirements

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
