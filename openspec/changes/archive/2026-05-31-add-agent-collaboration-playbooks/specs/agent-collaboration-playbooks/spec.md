## ADDED Requirements

### Requirement: Collaboration playbook documentation
PiRelay SHALL document at least one end-to-end two-agent collaboration playbook that uses shared-room machine bots and delegation task cards to coordinate work on a common software project.

#### Scenario: Real-life two-agent workflow is documented
- **WHEN** a user reads the collaboration playbook
- **THEN** the playbook describes a concrete software-project workflow involving a human operator, a source/planner agent, and a target/worker agent
- **AND** it identifies each participant's machine bot, local Pi session, capabilities, responsibilities, and expected room-visible outputs

#### Scenario: Playbook shows collaboration flow
- **WHEN** the playbook explains the workflow
- **THEN** it shows the sequence from initial human request, task decomposition, delegation command, visible task card, claim or approval, target-session execution, result report, and source-agent follow-up
- **AND** it distinguishes shared-room coordination from private-chat pairing and local terminal operation

### Requirement: Safe setup guidance for two agents
PiRelay SHALL provide setup guidance for running two collaborating agents in one shared room without requiring shared bot tokens, broker federation, or hidden transcript sharing.

#### Scenario: Two-machine setup is described
- **WHEN** the playbook describes prerequisites
- **THEN** it lists the need for one dedicated bot/app identity per machine, an authorized shared room, paired local Pi sessions, machine ids or aliases, local capabilities, and explicit delegation enablement
- **AND** it links to the existing platform-specific shared-room and configuration documentation rather than duplicating every platform detail

#### Scenario: Configuration snippets are safe
- **WHEN** the playbook includes configuration examples
- **THEN** examples show non-secret machine ids, capability labels, trusted peer identities, autonomy levels, bounded task settings, and approval-gate references
- **AND** examples do not include bot tokens, signing secrets, pairing codes, hidden prompts, full transcripts, or raw tool inputs

### Requirement: Collaboration transcript examples
PiRelay SHALL include bounded example room transcripts or command snippets that demonstrate how agents coordinate through validated delegation commands and task controls.

#### Scenario: Example transcript uses actionable commands
- **WHEN** the playbook shows a transcript
- **THEN** machine-actionable steps use documented commands or controls such as `/delegate <machine|#capability> <goal>` and `/task <claim|decline|cancel|status|history> [task-id]`
- **AND** platform-specific variants are either shown explicitly or linked to the command-surface documentation

#### Scenario: Ordinary bot output is marked inert
- **WHEN** the transcript includes agent summaries, completion messages, or commentary
- **THEN** the playbook states that ordinary bot-authored output is inert and is not treated as a new task or prompt unless accompanied by a validated delegation command or task action

### Requirement: Safety boundaries in collaboration playbooks
PiRelay SHALL document the safety boundaries that apply when multiple agents collaborate through a shared room.

#### Scenario: Trust and authorization are explained
- **WHEN** the playbook discusses agent-to-agent requests
- **THEN** it explains that peer-bot trust is separate from human allow-lists and must explicitly scope creation, target machines, capabilities, rooms, and autonomy
- **AND** it explains that authorization happens before task creation, prompt injection, media download, callback handling, approval resolution, or state mutation

#### Scenario: Approval gates remain active
- **WHEN** the playbook includes sensitive project operations such as pushing commits, publishing packages, destructive shell commands, or protected file edits
- **THEN** it states that delegation does not grant blanket approval and that approval gates still apply according to configured policy
- **AND** it recommends human approval for sensitive steps in the example workflow

#### Scenario: Loop prevention is visible
- **WHEN** the playbook explains bot-authored room messages
- **THEN** it states that each machine ignores its own bot output and ignores untrusted, untargeted, stale, or ordinary bot-authored text that is not a validated delegation event
- **AND** it describes how explicit task ids, task expiry, bounded summaries, and maximum delegation depth reduce accidental loops

### Requirement: Collaboration validation checklist
PiRelay SHALL document a manual or optional smoke checklist for validating the two-agent collaboration playbook safely.

#### Scenario: Checklist verifies the happy path
- **WHEN** a user follows the validation checklist with disposable or non-production messenger credentials
- **THEN** the checklist verifies that a source machine can create a visible delegation task, the target machine can claim or be approved for it, the task prompt reaches only the target local session, and the bounded result returns to the originating room

#### Scenario: Checklist verifies safety cases
- **WHEN** a user follows the validation checklist
- **THEN** it includes checks that non-target machines remain silent, untrusted bot-authored delegation is ignored, ordinary bot output is inert, sensitive operations request approval when configured, and no secrets are printed in logs or transcripts
