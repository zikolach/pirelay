## MODIFIED Requirements

### Requirement: Shared completion, progress, and output retrieval
The system SHALL deliver safe progress, terminal notifications, latest output retrieval, and document/download fallbacks consistently across messenger adapters.

#### Scenario: Completion uses preserved assistant text when final event omits it
- **WHEN** a paired Pi turn emits non-empty assistant text through message lifecycle events
- **AND** the subsequent `agent_end` payload does not contain non-empty assistant text
- **THEN** PiRelay treats the turn as completed using the preserved assistant text from the same active turn
- **AND** it does not send “finished without a final assistant response” for that turn
- **AND** it does not use user messages, tool results, hidden prompts, or transcript content as fallback final output
