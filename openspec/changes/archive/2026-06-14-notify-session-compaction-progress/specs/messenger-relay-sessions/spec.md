## ADDED Requirements

### Requirement: Compaction progress notifications follow binding progress mode
The system SHALL notify eligible paired messenger bindings when a Pi session compaction starts and when it successfully completes, and SHALL suppress those notifications only for bindings whose progress mode is quiet.

#### Scenario: Compaction start is delivered in non-quiet modes
- **WHEN** a paired Pi session emits `session_before_compact`
- **AND** a Telegram, Discord, Slack, or future messenger binding for that session has progress mode normal, verbose, or completion-only
- **THEN** PiRelay sends or schedules a safe compaction-start progress notification for that binding

#### Scenario: Compaction start is suppressed in quiet mode
- **WHEN** a paired Pi session emits `session_before_compact`
- **AND** a messenger binding for that session has progress mode quiet
- **THEN** PiRelay does not send a compaction-start progress notification to that binding

#### Scenario: Compaction completion is delivered in non-quiet modes
- **WHEN** a paired Pi session emits `session_compact` after successfully appending a compaction entry
- **AND** a Telegram, Discord, Slack, or future messenger binding for that session has progress mode normal, verbose, or completion-only
- **THEN** PiRelay sends or schedules a safe compaction-completed progress notification for that binding

#### Scenario: Compaction completion is suppressed in quiet mode
- **WHEN** a paired Pi session emits `session_compact` after successfully appending a compaction entry
- **AND** a messenger binding for that session has progress mode quiet
- **THEN** PiRelay does not send a compaction-completed progress notification to that binding

#### Scenario: Compaction notifications are safe
- **WHEN** PiRelay formats a compaction start or completion notification
- **THEN** the notification omits bot tokens, pairing codes, hidden prompts, tool internals, raw chat ids, raw channel ids, workspace ids, full transcripts, and compaction summary contents
- **AND** it does not expose whether compaction was triggered manually, by threshold, or by overflow unless Pi has provided that information through a safe extension event

#### Scenario: Compaction notification failures are nonfatal
- **WHEN** PiRelay cannot deliver a compaction start or completion notification to an eligible binding
- **THEN** compaction handling continues without failing, cancelling, or corrupting the Pi session
- **AND** PiRelay records or reports only secret-safe diagnostics

#### Scenario: Revoked or unauthorized bindings receive no compaction notifications
- **WHEN** a compaction start or completion notification is about to be delivered
- **THEN** PiRelay verifies the destination remains an active authorized binding according to existing binding authority and adapter delivery rules
- **AND** it does not send the notification to revoked, paused, unauthorized, missing, or stale destinations
