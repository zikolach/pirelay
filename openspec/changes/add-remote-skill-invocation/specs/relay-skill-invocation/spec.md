## ADDED Requirements

### Requirement: Remote skill discovery
PiRelay SHALL expose a safe, configurable list of local Pi skills to authorized messenger users.

#### Scenario: Authorized user lists skills
- **WHEN** an authorized bound messenger user invokes `/skills`, `relay skills`, or an equivalent platform command
- **THEN** PiRelay reads skill command metadata from the selected live Pi session
- **AND** returns a bounded list of skill names and safe descriptions filtered by relay skill policy
- **AND** it does not include raw skill file contents, absolute filesystem paths, hidden prompts, tool internals, transcripts, tokens, or callback payloads

#### Scenario: Skill discovery is unavailable
- **WHEN** the selected route is offline, stale, or cannot provide command metadata
- **THEN** PiRelay returns a safe unavailable or unsupported response
- **AND** it does not fall back to scanning arbitrary filesystem paths from the messenger request

#### Scenario: No skills pass policy
- **WHEN** skill discovery succeeds but no skill matches the configured allowlist, source filters, or visibility policy
- **THEN** PiRelay reports that no remote-invokable skills are available
- **AND** it does not reveal filtered skill names unless configuration explicitly allows safe filtered-count diagnostics

### Requirement: Skill exposure policy
PiRelay SHALL gate remote skill listing and invocation with explicit configuration and authorization policy.

#### Scenario: Remote skills are disabled
- **WHEN** a messenger user invokes `/skills` or `/skill` while remote skill invocation is disabled
- **THEN** PiRelay returns a clear disabled-capability response
- **AND** it does not list or invoke any skills

#### Scenario: Allowlist filters skills
- **WHEN** remote skill invocation is enabled with an allowlist
- **THEN** PiRelay lists and invokes only skills whose canonical names match the allowlist
- **AND** it rejects all other skill names with a safe not-available response

#### Scenario: Source policy filters skills
- **WHEN** remote skill invocation is configured to include or exclude skill sources such as project, user, package, or temporary sources
- **THEN** PiRelay applies that source policy before rendering skill menus or accepting invocation
- **AND** source information shown to the messenger is limited to a safe category label rather than full paths

#### Scenario: Risky skill requires confirmation
- **WHEN** policy marks a skill name or source as requiring confirmation
- **THEN** PiRelay obtains the configured local or remote approval before invoking that skill
- **AND** it refuses the invocation if confirmation expires, is denied, or targets a stale route

### Requirement: Remote skill invocation
PiRelay SHALL let authorized messenger users invoke allowed local skills with explicit input while preserving route-action safety.

#### Scenario: Invoke skill with inline input
- **WHEN** an authorized bound user sends `/skill <name> <input>` or an equivalent platform command for an allowed skill
- **THEN** PiRelay validates the skill name, selected route, paused state, online state, authorization, and policy before invoking the skill
- **AND** it delivers an invocation equivalent to local `/skill:<name> <input>` to the selected Pi session
- **AND** it acknowledges the accepted invocation through the originating messenger

#### Scenario: Skill name is unknown or filtered
- **WHEN** an authorized user requests a skill that is not available, filtered, disabled, or ambiguous
- **THEN** PiRelay returns a safe not-available or ambiguity response with allowed next actions
- **AND** it does not inject the raw `/skill` command as an ordinary Pi prompt

#### Scenario: Invocation target is paused or offline
- **WHEN** an authorized user requests an allowed skill but the selected route is paused, offline, stale, or unavailable
- **THEN** PiRelay returns the same safe paused/offline/unavailable response class used by other remote prompt actions
- **AND** it does not claim the skill was invoked

#### Scenario: Busy session uses explicit delivery mode
- **WHEN** an authorized user invokes a skill while the selected Pi session is busy
- **THEN** PiRelay applies existing busy delivery semantics for prompt-like actions
- **AND** the acknowledgement states whether the skill invocation was queued as follow-up, steering, or refused by policy

### Requirement: Pending skill input
PiRelay SHALL support requester-scoped pending input for skills selected without inline input.

#### Scenario: User selects skill without input
- **WHEN** an authorized user invokes `/skill <name>` or taps a skill button without providing input
- **THEN** PiRelay records a pending skill-input state scoped to the channel, instance, conversation or thread, user, route, and skill name
- **AND** it asks that same requester to send the input or cancel before a configured expiry

#### Scenario: Next message completes pending input
- **WHEN** the same authorized requester sends non-command text before the pending skill-input state expires
- **THEN** PiRelay treats that text as the input for the pending skill invocation
- **AND** it clears the pending state before delivering the invocation to Pi
- **AND** it does not route that text as an ordinary prompt separately

#### Scenario: Different requester sends text
- **WHEN** another user, conversation, thread, channel instance, or route sends text while a pending skill-input state exists
- **THEN** PiRelay does not use that text to complete the pending skill invocation
- **AND** normal routing rules apply for that other interaction

#### Scenario: Pending input expires or is cancelled
- **WHEN** pending skill input expires or the requester sends `/cancel`, `/skill cancel`, or an equivalent platform action
- **THEN** PiRelay clears the pending state
- **AND** it does not invoke the skill

### Requirement: Skill action buttons and stale-state safety
PiRelay SHALL render skill actions through adapter capabilities without weakening authorization or stale-state protections.

#### Scenario: Skill list renders buttons
- **WHEN** the active messenger adapter supports buttons or menus and skills are available
- **THEN** PiRelay may render each visible skill as an action button or menu item
- **AND** each action contains only a bounded opaque reference or safe skill name, not raw input, file paths, skill instructions, or hidden metadata

#### Scenario: Adapter lacks buttons
- **WHEN** the active messenger adapter cannot render skill buttons or menus
- **THEN** PiRelay returns text instructions using `/skill <name> [input]` or the platform-equivalent command
- **AND** the same authorization, filtering, and pending-input semantics apply

#### Scenario: Stale skill action is invoked
- **WHEN** a button or callback references a skill list, pending state, route, or turn that is expired, superseded, paused, disconnected, or no longer authorized
- **THEN** PiRelay rejects the action as stale or unavailable
- **AND** it does not invoke any skill or inject fallback prompt text

### Requirement: Skill output and audit safety
PiRelay SHALL handle skill invocation acknowledgements, resulting assistant output, and audits using existing safe relay output rules.

#### Scenario: Skill invocation produces assistant output
- **WHEN** a remote skill invocation causes Pi to complete a turn with assistant output
- **THEN** PiRelay delivers terminal output through the existing messenger completion, chunking, document, and full-output retrieval policy
- **AND** it does not expose additional skill internals beyond normal assistant output

#### Scenario: Skill invocation is audited
- **WHEN** a remote skill invocation is accepted, refused, cancelled, expires, or fails
- **THEN** PiRelay records a safe local audit/diagnostic event with skill name, requester channel category, route, and result class
- **AND** it does not record raw skill input unless existing prompt audit policy explicitly allows equivalent prompt text
