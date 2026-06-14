## ADDED Requirements

### Requirement: Discord live client supports progress message edits
The Discord live client SHALL expose bot-message references and edit operations needed for live progress edit-in-place behavior while preserving safe fallback when Discord rejects an edit.

#### Scenario: Discord send message returns id reference
- **WHEN** PiRelay sends a Discord bot message for live progress
- **THEN** the Discord live client returns the created message id when Discord provides it
- **AND** that id can be used as a live progress reference scoped to the Discord channel destination

#### Scenario: Discord edits progress message
- **WHEN** PiRelay has a Discord live progress reference for a bot-owned message and progress text changes
- **THEN** the Discord live client edits the expected channel message using the platform message id
- **AND** it keeps equivalent safe text content even if richer formatting or components are later added

#### Scenario: Discord edit failure is recoverable
- **WHEN** Discord rejects a live progress edit because the message is deleted, inaccessible, not bot-owned, or permissions changed
- **THEN** PiRelay clears the stale Discord progress reference and falls back to a new live progress message or plain snapshot
- **AND** it does not mark Discord runtime unhealthy solely because a best-effort progress edit failed
