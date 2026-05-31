## MODIFIED Requirements

### Requirement: Shared completion, progress, and output retrieval
The system SHALL deliver safe progress, terminal notifications, latest output retrieval, and document/download fallbacks consistently across messenger adapters.

#### Scenario: Completion uses completed assistant text when final event omits it
- **WHEN** a paired Pi turn emits non-empty assistant text through a completed assistant `message_end` event
- **AND** the subsequent `agent_end` payload does not contain non-empty assistant text
- **THEN** PiRelay treats the turn as completed using the completed assistant text from the same active turn
- **AND** it does not send “finished without a final assistant response” for that turn
- **AND** it does not use stream-only drafts, user messages, tool results, hidden prompts, or transcript content as fallback final output
