## ADDED Requirements

### Requirement: Workspace-aware stale session presentation
The system SHALL reduce stale session-list clutter by identifying older offline bindings from the same machine and workspace as superseded when a newer online session for that workspace exists.

#### Scenario: Newer online session supersedes older offline same-workspace bindings
- **WHEN** an authorized user requests `/sessions` and there is a newer online session for the same machine and workspace as one or more older offline bindings
- **THEN** the default session list shows the newer online session
- **AND** the older offline same-workspace bindings are hidden or marked superseded by default
- **AND** ordinary prompt routing does not target the superseded offline bindings unless the user explicitly selects them in an all-sessions or cleanup view

#### Scenario: Offline session has no online same-workspace replacement
- **WHEN** an authorized user requests `/sessions` and an offline binding has no newer online sibling for the same machine and workspace
- **THEN** the system may show that offline binding as an offline session so the user can understand and clean up the pairing

#### Scenario: Superseded sessions remain inspectable
- **WHEN** an authorized user requests an explicit all-sessions or diagnostic session list
- **THEN** the system includes superseded offline bindings with clear stale/superseded wording
- **AND** it does not expose raw session file paths, hidden prompts, tool internals, bot tokens, or transcripts

#### Scenario: Superseded session can be forgotten
- **WHEN** an authorized user invokes `/forget <session>` for a superseded offline binding
- **THEN** the system revokes or removes that binding according to existing forget semantics
- **AND** the binding no longer appears in default or all-sessions lists for that messenger identity

#### Scenario: Workspace grouping is unavailable
- **WHEN** the system cannot safely determine a workspace identity for a binding or route
- **THEN** it falls back to existing session selection/listing behavior for that entry
- **AND** it does not guess supersession solely from an ambiguous display label

### Requirement: Session list actions are primary-task oriented
The system SHALL render session-list buttons and equivalent platform actions according to the useful next action for each session state.

#### Scenario: Current online session is listed
- **WHEN** the session list includes the currently selected online session
- **THEN** the default actions identify it as current or active
- **AND** they prioritize status or relevant live controls over switching to itself

#### Scenario: Non-current online session is listed
- **WHEN** the session list includes an online session that is not the current active selection
- **THEN** the default actions include a way to select that session
- **AND** they MAY include a platform-appropriate one-shot prompt affordance when safe and supported

#### Scenario: Offline session is listed
- **WHEN** the session list includes an offline or superseded session
- **THEN** the default action SHOULD be cleanup-oriented, such as forgetting that offline binding
- **AND** tapping the row action MUST NOT imply that an offline prompt or control succeeded

#### Scenario: Busy current session is listed
- **WHEN** the currently selected session is online and busy
- **THEN** detailed session controls MAY prioritize steer, follow-up, abort, or compact actions according to existing authorization and delivery rules
- **AND** they do not bypass pause, revocation, or route availability checks

### Requirement: Recent activity remains explicit command-level inspection
The system SHALL keep `/recent` and `/activity` as explicit commands for safe recent relay activity inspection while not requiring them as default per-session list buttons.

#### Scenario: User requests recent activity explicitly
- **WHEN** an authorized user invokes `/recent`, `/activity`, or an equivalent explicit recent-activity command for the current or resolved session
- **THEN** the system returns recent safe relay activity according to existing progress/activity redaction and bounded retention rules

#### Scenario: Session list is rendered
- **WHEN** the system renders a default session-list button grid or equivalent action list
- **THEN** it is not required to include a `Recent` action for every session row
- **AND** removing those buttons MUST NOT remove the `/recent` or `/activity` text command behavior
