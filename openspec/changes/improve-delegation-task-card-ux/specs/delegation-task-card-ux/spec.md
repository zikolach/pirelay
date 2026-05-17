## ADDED Requirements

### Requirement: Structured delegation task presentation
PiRelay SHALL derive delegation task cards from a structured presentation model that separates task lifecycle semantics from messenger-specific rendering.

#### Scenario: Presentation is derived from a task record
- **WHEN** PiRelay renders a delegation task in any messenger
- **THEN** it derives status, source, target, goal, expiry, claimant, latest result or reason, available actions, and fallback commands from the current delegation task record
- **AND** messenger-specific renderers consume that structured presentation rather than parsing previously rendered text

#### Scenario: Presentation remains safe and bounded
- **WHEN** the presentation contains user-provided goal, context, source labels, target labels, or latest result text
- **THEN** PiRelay bounds and redacts those fields before rendering
- **AND** it excludes bot tokens, pairing codes, hidden prompts, full transcripts, raw tool inputs, file bytes, upload URLs, and internal session storage keys

### Requirement: Platform-native delegation task actions
PiRelay SHALL expose delegation task actions as platform-native buttons or equivalent callbacks when the active messenger adapter supports inline actions.

#### Scenario: Claimable task on a button-capable messenger
- **WHEN** a claimable delegation task is rendered through a messenger adapter that supports inline callbacks
- **THEN** the task card exposes claim, decline, cancel, and status as platform-native actions
- **AND** each action uses the canonical delegation action id for the task and action kind

#### Scenario: Awaiting approval task on a button-capable messenger
- **WHEN** an awaiting-approval delegation task is rendered through a messenger adapter that supports inline callbacks
- **THEN** the task card exposes approve, cancel, and status as platform-native actions
- **AND** it does not expose claim as the primary action until the task is approved or otherwise claimable

#### Scenario: Running task on a button-capable messenger
- **WHEN** a claimed or running delegation task is rendered through a messenger adapter that supports inline callbacks
- **THEN** the task card exposes cancel and status as platform-native actions
- **AND** it does not expose claim, approve, or decline actions for that task state

#### Scenario: Terminal task on a button-capable messenger
- **WHEN** a completed, failed, blocked, declined, cancelled, or expired delegation task is rendered through a messenger adapter that supports inline callbacks
- **THEN** the task card exposes status as the only platform-native task action unless a future requirement explicitly adds safe terminal actions

### Requirement: Delegation task text fallback
PiRelay SHALL preserve plain-text delegation task commands as a fallback action surface for every rendered task card.

#### Scenario: Adapter lacks button support
- **WHEN** a delegation task is rendered through a messenger adapter or context that cannot provide inline callbacks
- **THEN** PiRelay renders the available task actions as copyable text commands using the adapter's reliable command prefix

#### Scenario: Adapter supports button actions
- **WHEN** a delegation task is rendered through a messenger adapter that supports inline callbacks
- **THEN** PiRelay MAY de-emphasize fallback commands in the visible card
- **AND** the fallback commands remain available in bounded text, accessibility text, diagnostics, tests, or another safe fallback surface

#### Scenario: Text command fallback is used
- **WHEN** an authorized user sends a fallback text command such as `relay task claim <task-id>` in an authorized context
- **THEN** PiRelay applies the same task lookup, authorization, idempotency, and lifecycle transition checks as the equivalent platform-native button action

### Requirement: Readable delegation task lifecycle cards
PiRelay SHALL render delegation task cards so humans can distinguish handoff progress from terminal results.

#### Scenario: Task is claimable
- **WHEN** PiRelay renders a proposed, claimable, or awaiting-approval task
- **THEN** the card clearly shows that the task has not yet started work
- **AND** it shows source, target, goal, expiry, and the available review or claim actions

#### Scenario: Task is running
- **WHEN** PiRelay renders a claimed or running task
- **THEN** the card clearly shows that the task has been accepted or handed off but has not necessarily completed
- **AND** it shows the claimant identity when available

#### Scenario: Task is completed
- **WHEN** delegated work completes with a final result summary
- **THEN** PiRelay renders a completed task card that highlights the bounded latest result summary
- **AND** the card does not rely on the user interpreting a prior running card as completion

#### Scenario: Task is blocked or failed
- **WHEN** delegated work cannot start, cannot continue, or fails
- **THEN** PiRelay renders a blocked or failed task card that highlights the bounded reason or failure summary
- **AND** it does not claim that delegated work completed successfully

### Requirement: Shared-room delegation action silence
PiRelay SHALL keep shared-room multi-bot delegation action handling silent for machine bots that do not own or know the referenced task.

#### Scenario: Non-target bot sees task action for unknown task
- **WHEN** a machine bot in a shared room observes a delegation action or fallback text command for a task id that is not present in its local delegation task state
- **THEN** it remains silent
- **AND** it does not reply with stale-task guidance, mutate state, inject prompts, send activity indicators, or claim ownership of the task

#### Scenario: Owning bot handles task action
- **WHEN** the machine bot that owns or knows the referenced task observes a valid authorized delegation action
- **THEN** it handles the action according to the existing delegation lifecycle and authorization rules
- **AND** it renders the resulting task update through the platform-appropriate task card surface
