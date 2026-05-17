## ADDED Requirements

### Requirement: Shared-room delegation task routing
Shared-room machine bots SHALL treat bot-authored delegation events as actionable only when they are validated task objects or explicit task actions from trusted peers.

#### Scenario: Trusted peer task targets local machine
- **WHEN** a trusted peer bot publishes a validated delegation task in an opted-in and paired shared room and the task explicitly targets the local machine bot
- **THEN** the local broker may evaluate the task for approval, claim, or manual human review according to local delegation policy
- **AND** non-target brokers remain silent except for their own eligible task-card observation state

#### Scenario: Trusted peer task targets another machine
- **WHEN** a trusted peer bot publishes a validated delegation task that clearly targets another machine bot
- **THEN** the local broker does not claim, inject, acknowledge, or mutate local session state for that task

#### Scenario: Capability task is visible to multiple machines
- **WHEN** a validated delegation task targets a capability rather than one exact machine
- **THEN** each broker may consider the task only if local policy declares that capability and the peer/room is trusted
- **AND** claim behavior remains single-target and conservative according to delegation policy

#### Scenario: Capability task creation requires explicit source scoping
- **WHEN** a human or peer publishes a capability-target delegation creation command in a room observed by multiple machine bots
- **THEN** PiRelay creates the visible task only when the command is explicitly scoped to the local source broker, such as by addressing the local bot identity
- **AND** unaddressed capability creation commands do not cause each observing bot to render duplicate task cards

#### Scenario: Free-form bot-authored text is ignored
- **WHEN** a machine bot observes bot-authored text that is not a validated delegation task, validated task action, or existing supported bot-to-bot command
- **THEN** the broker treats the message as inert shared-room output and does not inject it as a prompt

#### Scenario: Bot-authored delegation text outside validated shared rooms is ignored
- **WHEN** a bot-authored message resembles a delegation command in a private chat, unpaired room, disabled shared room, or another conversation where the runtime will not validate shared-room delegation
- **THEN** PiRelay drops the message before normal prompt routing
- **AND** bot-authored delegation-like text is not delivered to a paired session as an ordinary user prompt

### Requirement: Delegation safe silence and loop prevention
Shared-room machine bots SHALL preserve safe silence and loop-prevention invariants for delegation tasks.

#### Scenario: Local bot observes own delegation output
- **WHEN** the local machine bot observes a task card, task update, or result message authored by itself
- **THEN** it ignores that event for task creation, claim, prompt injection, and task follow-up generation

#### Scenario: Delegation task is stale
- **WHEN** a task card or task action references an expired, completed, cancelled, revoked, or unknown task
- **THEN** non-target brokers remain silent and any addressed local broker returns only safe stale-task guidance

#### Scenario: Delegation chain is too deep
- **WHEN** a shared-room task attempts to create a child task beyond configured delegation depth
- **THEN** the local broker rejects auto-claim behavior and requires human supervision or rejects the child task according to policy
