# relay-communication-diagnostics Specification

## Purpose
TBD - created by archiving change add-relay-communication-diagnostics. Update Purpose after archive.
## Requirements
### Requirement: Opt-in structured communication diagnostics
PiRelay SHALL provide disabled-by-default structured communication diagnostics that write bounded JSONL records for local troubleshooting when explicitly enabled.

#### Scenario: Diagnostics are disabled by default
- **WHEN** PiRelay starts without communication diagnostics enabled in configuration or environment
- **THEN** it does not create or append communication diagnostic log files
- **AND** relay behavior, prompt routing, messenger delivery, and user-facing output remain unchanged

#### Scenario: Diagnostics are enabled
- **WHEN** communication diagnostics are explicitly enabled
- **THEN** PiRelay writes newline-delimited JSON records to a configured or default path under the PiRelay state directory
- **AND** the log directory and file are created with restrictive local-user permissions
- **AND** each record includes timestamp, component, event name, severity or outcome, and available non-secret correlation fields

#### Scenario: Diagnostic write fails
- **WHEN** PiRelay cannot create or append the diagnostic log
- **THEN** it continues relay operation without failing prompt routing or notification delivery
- **AND** it records safe local diagnostic status for `/relay doctor` or equivalent local troubleshooting output when possible

### Requirement: Runtime lifecycle diagnostic events
PiRelay SHALL record safe runtime lifecycle diagnostic events for local Pi session turns when communication diagnostics are enabled.

#### Scenario: Agent turn lifecycle is traced
- **WHEN** a paired Pi session starts, progresses through tool execution, and ends a turn
- **THEN** diagnostics include runtime events for agent lifecycle, tool execution start/end metadata, active route/session correlation, turn id assignment, and terminal status decision
- **AND** tool events include tool names and safe status metadata but not raw tool arguments, command text, file contents, or tool internals by default

#### Scenario: Final assistant extraction is traced
- **WHEN** the runtime handles an `agent_end` event
- **THEN** diagnostics include message count, role histogram, assistant message count, assistant content shapes, text block counts, bounded text length metadata, extraction result, and selected relay terminal status
- **AND** when no final assistant text is found, diagnostics include a safe reason such as `no-non-empty-assistant-text` without logging the full transcript by default

#### Scenario: Abort or upstream error affects final status
- **WHEN** a turn is aborted or has upstream error metadata available before or during `agent_end`
- **THEN** diagnostics record the safe abort/error category and show whether it influenced the final relay status or fallback failure message

### Requirement: Broker and adapter diagnostic events
PiRelay SHALL record safe broker and adapter diagnostic events for route coordination, messenger ingress, command handling, and notification delivery when communication diagnostics are enabled.

#### Scenario: Broker route communication is traced
- **WHEN** the broker accepts a client connection, registers or unregisters a route, receives route state, or forwards a prompt/action to a route
- **THEN** diagnostics include event type, route/session correlation, broker namespace when configured, and outcome metadata
- **AND** diagnostics do not include raw prompt content, pairing secrets, bot tokens, or full route transcripts by default

#### Scenario: Messenger ingress classification is traced
- **WHEN** Telegram, Discord, Slack, or another adapter receives an inbound update/event for a configured relay surface
- **THEN** diagnostics include messenger kind, instance id, safe conversation/user correlation, event/update id when available, classification outcome, authorization outcome category, command/action kind, and route-selection outcome
- **AND** unauthorized, ambiguous, ignored, and rejected events are distinguishable without exposing message text by default

#### Scenario: Notification delivery is traced
- **WHEN** PiRelay sends or suppresses a completion, failure, abort, progress, approval, guided-answer, image, or file notification
- **THEN** diagnostics include notification kind, target route/binding correlation, messenger surface, delivery/suppression outcome, and safe error category when delivery fails
- **AND** diagnostics do not include full assistant output, media bytes, uploaded file contents, or remote requester secrets by default

### Requirement: Secret-safe diagnostic content handling
PiRelay SHALL keep diagnostic logs secret-safe through redaction, bounded serialization, and explicit content-preview controls.

#### Scenario: Default records are metadata only
- **WHEN** communication diagnostics are enabled with default settings
- **THEN** records contain metadata, counts, shapes, statuses, categories, and safe identifiers
- **AND** records do not contain raw prompts, full assistant responses, hidden prompts, tool arguments, command text, media contents, file contents, bot tokens, signing secrets, OAuth tokens, pairing links, pairing codes, or approval secret material

#### Scenario: Content previews are explicitly enabled
- **WHEN** a local user explicitly enables diagnostic content previews
- **THEN** PiRelay may include short bounded redacted snippets useful for troubleshooting extraction or routing mismatches
- **AND** snippets are truncated, pass through configured redaction patterns and built-in token/pairing secret redaction, and remain disabled by default

#### Scenario: Token-shaped data is encountered
- **WHEN** diagnostic metadata or an optional preview contains token-shaped, pairing-shaped, or configured redaction-pattern-matching text
- **THEN** PiRelay replaces that data with a redaction marker before writing the JSONL record

### Requirement: Diagnostic retention and discoverability
PiRelay SHALL bound communication diagnostic storage and make enabled diagnostics discoverable through local troubleshooting surfaces.

#### Scenario: Log size limit is reached
- **WHEN** the active diagnostic log exceeds the configured maximum size
- **THEN** PiRelay rotates, truncates, or starts a new bounded log according to documented retention behavior
- **AND** it does not allow unbounded growth in the PiRelay state directory

#### Scenario: Local doctor reports diagnostics status
- **WHEN** the local user invokes `/relay doctor` or an equivalent local diagnostic command
- **THEN** PiRelay reports whether communication diagnostics are enabled, the safe log path, retention settings, latest write status, and whether content previews are enabled
- **AND** the report does not print raw log contents or secrets

#### Scenario: Remote requester asks for diagnostics
- **WHEN** a remote Telegram, Discord, or Slack requester asks for relay diagnostics through ordinary remote commands
- **THEN** PiRelay does not automatically upload communication logs
- **AND** any log sharing requires an explicit safe local action or a separately authorized file-delivery path that validates the requested file

### Requirement: Troubleshooting documentation
PiRelay SHALL document how to use communication diagnostics to investigate missing final assistant responses and broker/adapter communication issues.

#### Scenario: Missing final response is investigated
- **WHEN** a user sees “The agent finished without a final assistant response”
- **THEN** documentation explains how to enable diagnostics, reproduce the issue, find the final assistant extraction event, interpret message roles/content shapes, and distinguish upstream empty output from PiRelay extraction gaps

#### Scenario: Broker communication is investigated
- **WHEN** a user suspects broker route, Telegram ingress, or notification delivery problems
- **THEN** documentation explains how to inspect broker/adaptor diagnostic events, correlate them with session/turn identifiers, and share redacted excerpts safely

