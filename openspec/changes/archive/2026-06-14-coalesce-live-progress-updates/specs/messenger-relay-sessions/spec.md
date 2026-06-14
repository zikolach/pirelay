## ADDED Requirements

### Requirement: Coalesced live progress delivery
The system SHALL deliver Pi session progress to messengers as coalesced live state rather than as a direct stream of raw Pi events.

#### Scenario: Repeated live status is not duplicated
- **WHEN** Pi emits repeated assistant stream updates, repeated safe model status text, or otherwise equivalent progress activities for the same running turn
- **THEN** the messenger receives at most one current live-progress representation for that equivalent status within the configured delivery window
- **AND** the system does not post a new chat message for every repeated raw Pi event

#### Scenario: Superseded live status is coalesced
- **WHEN** multiple volatile progress updates occur before the messenger delivery window elapses
- **THEN** the system delivers the latest coalesced safe status, plus any stable milestones that remain relevant
- **AND** superseded volatile snapshots are not delivered as separate messenger messages

#### Scenario: Editable messengers update live status in place
- **WHEN** a messenger adapter supports updating a previously sent message and a paired binding is eligible to receive progress
- **THEN** the system uses a single live progress message for the active turn where practical
- **AND** later live progress updates edit that message instead of appending duplicate chat messages
- **AND** final completion, failure, abort, and full-output messages remain separate terminal notifications

#### Scenario: Non-editable messengers receive coalesced snapshots
- **WHEN** a messenger adapter does not support updating a previously sent progress message or an update attempt fails
- **THEN** the system falls back to sending coalesced progress snapshots at the configured cadence
- **AND** it still avoids sending duplicate raw stream-event messages

#### Scenario: Normal progress mode is low-noise
- **WHEN** a binding uses normal progress mode during a running Pi turn
- **THEN** the messenger receives stable milestones and coalesced live status only
- **AND** generic assistant streaming snapshots, repeated drafting text, and overlapping tool-result bookkeeping messages are not delivered as standalone progress messages

#### Scenario: Verbose progress mode remains bounded
- **WHEN** a binding uses verbose progress mode during a running Pi turn
- **THEN** the messenger MAY receive more detailed progress than normal mode
- **BUT** repeated equivalent updates MUST still be deduplicated or coalesced
- **AND** delivery MUST respect the configured verbose progress interval and platform message limits

#### Scenario: Completion-only and quiet progress modes remain respected
- **WHEN** a binding uses completion-only progress mode
- **THEN** the messenger receives terminal final output and explicitly allowed lifecycle notices such as compaction progress
- **AND** it does not receive ordinary live progress snapshots
- **WHEN** a binding uses quiet progress mode
- **THEN** the messenger does not receive live progress snapshots or compaction progress notifications

#### Scenario: Tool lifecycle progress is human-level in normal mode
- **WHEN** Pi emits overlapping tool lifecycle events such as tool execution completion and tool-result message completion for the same tool call
- **THEN** normal progress mode does not deliver both as separate technical messages
- **AND** the system either collapses them into one safe human-readable milestone or omits successful short-lived tool chatter

#### Scenario: Live progress remains secret-safe
- **WHEN** the system formats or updates live progress for any messenger
- **THEN** it excludes hidden thinking content, chain-of-thought, hidden prompts, raw transcripts, pairing codes, bot tokens, raw chat or channel identifiers, and full compaction summaries
- **AND** only sanitized safe progress text may be stored or delivered

#### Scenario: Authorization still gates progress delivery
- **WHEN** a binding is paused, revoked, stale, unauthorized, or no longer authoritative for a route
- **THEN** the system does not send, edit, or finalize live progress messages for that binding
- **AND** any pending live progress state for that destination is cleared or ignored safely
