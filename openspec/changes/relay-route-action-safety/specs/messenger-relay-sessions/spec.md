## ADDED Requirements

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
