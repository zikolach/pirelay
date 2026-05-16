## ADDED Requirements

### Requirement: Visible delegation task cards
PiRelay SHALL represent agent-directed shared-room work as visible delegation task cards that are human-readable, bounded, and machine-parseable.

#### Scenario: Agent creates delegation task
- **WHEN** a trusted agent or authorized human creates a delegation task in an authorized shared messenger room
- **THEN** PiRelay creates a task with a short user-visible id, source machine/session label, target machine or capability, goal summary, status, expiry, and full room/thread reference containing messenger, instance id, conversation id, and thread/reply id when available
- **AND** it renders a task card in the originating room using platform-appropriate text, buttons, or thread affordances

#### Scenario: Task card excludes sensitive data
- **WHEN** PiRelay renders or persists a delegation task card
- **THEN** it excludes bot tokens, pairing codes, hidden prompts, full transcripts, raw tool inputs, file bytes, upload URLs, and internal session storage keys
- **AND** it bounds and redacts user-provided goal/context fields before display

#### Scenario: Ordinary bot output is inert
- **WHEN** a machine bot posts ordinary completion, status, or explanatory output in a shared room
- **THEN** other PiRelay bots SHALL NOT treat that output as a delegation task or prompt unless it is an explicit validated delegation command or task-card action

### Requirement: Delegation task lifecycle
PiRelay SHALL manage each delegation task through a bounded lifecycle with single-claim execution semantics.

#### Scenario: Task is proposed and claimable
- **WHEN** a delegation task passes creator trust, room authorization, target, expiry, and policy checks
- **THEN** PiRelay marks the task as proposed or claimable and exposes safe claim, decline, cancel, and status actions where the platform supports them

#### Scenario: Target claims task
- **WHEN** a trusted target machine bot or authorized human claims an unexpired claimable task for an eligible local session and policy permits execution now
- **THEN** PiRelay transitions the task to claimed/running for that claimant only after the target prompt handoff is accepted or safely queued with an unambiguous task association
- **AND** prevents later duplicate claims from being accepted for the same task unless the task has been explicitly released or failed back to claimable
- **AND** rejects or blocks the claim when the target session already has active delegated work and queued turns cannot preserve a task id per turn

#### Scenario: Task completes
- **WHEN** the target session completes delegated work with a final result
- **THEN** PiRelay marks the task completed and reports a bounded result summary to the task room or thread through the target machine bot identity

#### Scenario: Task fails or is blocked
- **WHEN** delegated work fails, route state becomes unavailable, required approval is denied, or the target reports it cannot proceed
- **THEN** PiRelay marks the task failed or blocked with a safe reason
- **AND** it does not claim successful completion or inject follow-up prompts into unrelated sessions

#### Scenario: Task expires or is cancelled
- **WHEN** an unclaimed task expires, a running task exceeds configured timeout, a human cancels it, the source/target binding is revoked, or the owning route unregisters
- **THEN** PiRelay marks the task expired or cancelled and rejects future claim/update/approval actions for that task id

### Requirement: Peer trust and capability matching
PiRelay SHALL authorize delegated task creation and claiming using peer-bot trust and capability policy separate from human allow-lists.

#### Scenario: Trusted peer creates task
- **WHEN** a bot-authored delegation request arrives from a configured trusted peer identity in an authorized shared room
- **THEN** PiRelay may create a task according to that peer's configured creation scope, allowed rooms, target machines, capabilities, and autonomy policy
- **AND** that creation trust does not authorize claim, approve, cancel, decline, or other task-control actions unless those actions are separately configured

#### Scenario: Untrusted peer creates task
- **WHEN** a bot-authored delegation request arrives from an unknown, untrusted, revoked, or disallowed bot identity
- **THEN** PiRelay ignores or rejects the request before task creation, prompt injection, media download, callback execution, or state mutation

#### Scenario: Capability target is matched
- **WHEN** a task targets a capability instead of a specific machine
- **THEN** PiRelay may treat a local machine/session as eligible only if configuration declares that capability for the local machine or session
- **AND** ambiguity or multiple matching sessions requires safe disambiguation or human approval rather than guessing

#### Scenario: Human allow-list does not imply peer trust
- **WHEN** a bot identity appears in human allow-list configuration but is not configured as a trusted delegation peer
- **THEN** PiRelay SHALL NOT accept bot-authored delegation creation or claiming from that identity solely because it is allow-listed as a human controller

#### Scenario: Peer bot attempts human-only control
- **WHEN** a peer bot invokes approve, cancel, decline, or another task-control action without explicit peer control permission
- **THEN** PiRelay rejects or ignores the action before task-state mutation, prompt injection, callback handling, media download, or approval resolution

### Requirement: Human supervision and autonomy levels
PiRelay SHALL gate autonomous delegation behavior through explicit local policy and human supervision options.

#### Scenario: Delegation autonomy is off
- **WHEN** delegation autonomy is disabled for a messenger instance or room
- **THEN** PiRelay does not create, claim, or inject work from bot-authored delegation requests
- **AND** existing human-directed shared-room commands continue to work unchanged

#### Scenario: Propose-only mode is enabled
- **WHEN** a trusted peer creates a delegation task under propose-only policy
- **THEN** PiRelay renders the task card for human review but does not inject the task into any target session until an authorized human approves or claims it
- **AND** claim attempts that still require human supervision do not move the task to claimed/running or remove it from circulation

#### Scenario: Targeted auto-claim is enabled
- **WHEN** a trusted peer creates an unexpired task explicitly targeting the local machine and local policy allows targeted auto-claiming for that peer/capability
- **THEN** PiRelay may claim the task automatically for an eligible local session
- **AND** sensitive tool calls inside the task still require approval according to approval-gate policy

#### Scenario: Human cancels task
- **WHEN** an authorized human invokes cancel for a pending, claimed, running, or blocked delegation task
- **THEN** PiRelay marks the task cancelled, stops accepting further task actions, and requests cancellation of any associated local prompt or operation when possible

### Requirement: Delegated prompt injection
PiRelay SHALL inject claimed delegated work into the target local Pi session as a transparent bounded prompt with task context.

#### Scenario: Claimed task starts target session work
- **WHEN** a task is claimed for an online eligible local session
- **THEN** PiRelay sends that session a prompt containing the task id, source machine/session, goal, constraints, report destination, and instruction to summarize results back to the room
- **AND** the prompt does not include hidden source prompts, full transcripts, secrets, or unbounded context

#### Scenario: Target session is unavailable
- **WHEN** a task claim targets a session that is offline, stale, paused, unavailable, or revoked before prompt handoff
- **THEN** PiRelay does not report successful claim or delivery
- **AND** it marks the task blocked, failed, or still claimable according to policy with safe guidance

#### Scenario: Source receives result visibility
- **WHEN** a delegated task completes or fails
- **THEN** PiRelay reports the result to the originating shared room or thread
- **AND** it MAY provide a bounded follow-up to the source session only when configured and when source route/requester state is still active and authorized

### Requirement: Delegation approval integration
PiRelay SHALL integrate delegated work with approval-gate semantics without treating task claim as blanket approval for sensitive operations.

#### Scenario: Delegation creation requires approval
- **WHEN** policy classifies a proposed delegation as requiring human approval before another agent may claim or run it
- **THEN** PiRelay marks the task awaiting approval and does not inject it into a target session until an authorized approval decision is recorded

#### Scenario: Task-scoped approval grant is used
- **WHEN** an authorized approver chooses approve-for-task for a sensitive operation inside a delegated task
- **THEN** PiRelay creates a grant scoped to that task id, target session, requester/binding or approver scope, matcher fingerprint, and expiry
- **AND** future matching operations within that same task may proceed while the grant remains active

#### Scenario: Task-scoped grant does not escape task
- **WHEN** a later operation matches the same tool/category pattern but belongs to a different task, different session, different requester scope, expired task, or revoked binding
- **THEN** PiRelay does not use the task-scoped grant and requires a fresh approval when policy requires one

#### Scenario: Persistent grants are not implied by delegation
- **WHEN** a human approves a delegation task or task-scoped operation
- **THEN** PiRelay does not create persistent or cross-session approval grants unless persistent grants are explicitly enabled by local configuration and explicitly selected by an authorized approver

### Requirement: Delegation loop prevention
PiRelay SHALL prevent delegation loops, self-triggering, and unbounded delegation chains.

#### Scenario: Bot sees its own task card
- **WHEN** a messenger platform redelivers a task card or task update authored by the local bot identity
- **THEN** PiRelay ignores it for task creation, claim, prompt injection, and follow-up delegation

#### Scenario: Delegation depth is exceeded
- **WHEN** an agent attempts to create a child delegation whose parent chain exceeds configured maximum delegation depth
- **THEN** PiRelay rejects or requires human approval for the child delegation and does not auto-claim it

#### Scenario: Completion summary resembles task request
- **WHEN** a delegated task completion or failure summary contains text that looks like an instruction or request
- **THEN** PiRelay treats it as inert output unless it is accompanied by a validated explicit delegation command or action

#### Scenario: Duplicate delivery is observed
- **WHEN** Slack retries an event, Discord redelivers an interaction, Telegram update polling sees duplicate updates, or history fallback observes an already-handled task event
- **THEN** PiRelay handles task creation, claim, cancellation, approval, and result reporting at most once for the persisted task event id or task id/action pair

### Requirement: Delegation audit and history
PiRelay SHALL record bounded non-secret audit events for delegation task lifecycle and supervision decisions.

#### Scenario: Task lifecycle changes
- **WHEN** a delegation task is created, approved, claimed, started, blocked, completed, failed, declined, cancelled, expired, or rejected
- **THEN** PiRelay records a bounded audit event with task id, safe source/target machine identity, status, actor identity, timestamp, and safe reason or summary
- **AND** it excludes secrets, hidden prompts, full transcripts, file bytes, raw tool input, and internal callback payloads

#### Scenario: Authorized user requests task history
- **WHEN** an authorized user requests delegation task history for a room, machine, or session
- **THEN** PiRelay returns a bounded list of recent task cards or lifecycle summaries scoped to that user's authorized messenger context
- **AND** room history filtering uses the full room reference, including messenger, instance id, conversation id, and thread/reply id when available
