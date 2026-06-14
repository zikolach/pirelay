## ADDED Requirements

### Requirement: Slack live client supports progress message updates
The Slack live client SHALL expose bot-message references and update operations needed for live progress edit-in-place behavior while preserving safe fallback when Slack rejects an update.

#### Scenario: Slack post message returns timestamp reference
- **WHEN** PiRelay posts a Slack bot message for live progress
- **THEN** the Slack live client returns the message timestamp `ts` when Slack provides it
- **AND** that timestamp can be used as a live progress reference scoped to the Slack channel or thread destination

#### Scenario: Slack updates progress message
- **WHEN** PiRelay has a Slack live progress reference for a bot-owned message and progress text changes
- **THEN** the Slack live client calls Slack message update APIs such as `chat.update` for the expected channel and timestamp
- **AND** it preserves equivalent safe text content even if richer formatting is later added

#### Scenario: Slack update failure is recoverable
- **WHEN** Slack rejects a live progress update because the message is deleted, too old, not bot-owned, or otherwise inaccessible
- **THEN** PiRelay clears the stale Slack progress reference and falls back to a new live progress message or plain snapshot
- **AND** it does not mark Slack runtime unhealthy solely because a best-effort progress update failed
