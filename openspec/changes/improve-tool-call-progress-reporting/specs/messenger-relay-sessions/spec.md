## ADDED Requirements

### Requirement: Tool progress is summarized safely
The system SHALL summarize tool-call progress using safe, bounded, human-readable operation labels instead of exposing raw tool arguments, tool output, transcripts, hidden prompts, pairing codes, raw messenger destination identifiers, or secrets.

#### Scenario: Bash progress shows command intent safely
- **WHEN** a running paired session emits a bash tool call and the receiving binding is eligible for normal progress
- **THEN** the progress update includes a bounded redacted summary of the command intent, such as the first command line
- **AND** the update does not include command output, hidden prompts, full transcripts, bot tokens, or unredacted secret-pattern matches

#### Scenario: File tools show target paths without content
- **WHEN** a running paired session emits read, edit, or write tool calls and the receiving binding is eligible for progress
- **THEN** the progress update identifies the relevant target file path or safe basename when available
- **AND** the update does not include file contents, replacement text, patches, or unbounded arguments

#### Scenario: Search/list tools show query or path intent safely
- **WHEN** a running paired session emits grep, rg, find, or ls style tool calls and the receiving binding is eligible for progress
- **THEN** the progress update includes a bounded redacted search pattern, query, or target path when available
- **AND** unknown or unsafe fields are omitted rather than serialized generically

#### Scenario: Unknown tools remain conservative
- **WHEN** a running paired session emits an unknown or custom tool call
- **THEN** normal-mode progress identifies only the sanitized tool name or a conservative generic label
- **AND** it does not serialize arbitrary tool arguments

### Requirement: Tool progress is aggregated by turn
The system SHALL aggregate current-turn tool progress by stable tool-call identity and tool kind so repeated tool events produce a compact live status rather than many generic completion messages.

#### Scenario: Repeated tool calls collapse into counts
- **WHEN** a running paired session completes multiple tool calls of the same kind within the progress window
- **THEN** the progress update includes a bounded aggregate count such as `bash×2` or `read×4`
- **AND** it does not send a separate messenger message for every individual completion when the adapter can coalesce or edit live progress

#### Scenario: Active and recent tools are shown compactly
- **WHEN** one or more tool calls are active or recently completed during a running paired turn
- **THEN** the progress update prioritizes the current active tool summaries and the most recent completed or failed summaries within the configured progress length limit
- **AND** older repeated activity is represented by aggregate counts rather than unbounded rows

#### Scenario: Failed tools are visible without leaking output
- **WHEN** a tool call fails during a running paired turn and the receiving binding is eligible for progress
- **THEN** the progress update marks that tool as failed using the safe tool label
- **AND** it does not include raw stack traces, command output, or unbounded error payloads in normal mode

#### Scenario: Tool progress resets on turn boundaries
- **WHEN** a Pi turn starts, completes, fails, aborts, unregisters, or the runtime restarts
- **THEN** current-turn tool progress state is reset or discarded
- **AND** later turns do not display stale tool rows or counts from previous turns

### Requirement: Progress modes govern tool reporting
The system SHALL apply existing progress-mode semantics to improved tool reporting for every messenger binding independently.

#### Scenario: Normal mode receives low-noise tool summaries
- **WHEN** a binding is configured for normal progress and a running paired session emits tool activity
- **THEN** the binding receives coalesced safe tool summaries and aggregate counts
- **AND** it does not receive generic duplicate `Processed tool result` or repeated `Tool completed — <tool>` messages for the same activity

#### Scenario: Verbose mode remains bounded and safe
- **WHEN** a binding is configured for verbose progress and a running paired session emits tool activity
- **THEN** the binding may receive additional safe technical tool lifecycle detail
- **AND** the output remains redacted, bounded, coalesced, and free of raw tool output or arbitrary argument serialization

#### Scenario: Completion-only excludes ordinary tool progress
- **WHEN** a binding is configured for completion-only progress and a running paired session emits ordinary tool activity
- **THEN** the binding does not receive the ordinary tool progress update
- **AND** terminal completion output and allowed compaction notifications continue to follow their existing policies

#### Scenario: Quiet suppresses all tool progress
- **WHEN** a binding is configured for quiet progress and a running paired session emits tool activity
- **THEN** the binding receives no tool progress update

### Requirement: Tool progress delivery preserves adapter parity
The system SHALL deliver improved tool progress through the same shared progress pipeline for Telegram direct runtime, Telegram broker runtime, Slack runtime, Discord runtime, and future messenger adapters.

#### Scenario: Telegram updates live tool progress in place when possible
- **WHEN** Telegram can edit the live progress message and the tool-progress card changes
- **THEN** PiRelay updates the existing live progress message instead of posting a new message for every tool call
- **AND** if editing fails, PiRelay falls back to bounded coalesced snapshots without exposing unsafe data

#### Scenario: Slack and Discord use coalesced snapshots
- **WHEN** Slack or Discord receives improved tool progress
- **THEN** PiRelay sends bounded coalesced snapshots using the same safe summaries and progress-mode filtering as Telegram
- **AND** authorization, paused/revoked binding checks, and destination scoping remain enforced before delivery

#### Scenario: Broker and in-process runtimes match
- **WHEN** equivalent tool progress is emitted through the in-process runtime and broker-owned Telegram runtime
- **THEN** both paths produce equivalent safe tool summary content and progress-mode behavior
- **AND** neither path persists raw tool args, tool outputs, or secret-bearing semantic keys
