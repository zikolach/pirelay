## ADDED Requirements

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

#### Scenario: Task status is requested
- **WHEN** an authorized user requests status for a delegation task visible in the current room or thread
- **THEN** PiRelay returns bounded task state including id, source, target, status, claimant when non-secret, expiry, and latest safe update
