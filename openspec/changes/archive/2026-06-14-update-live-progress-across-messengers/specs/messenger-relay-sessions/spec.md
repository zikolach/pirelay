## ADDED Requirements

### Requirement: Live progress updates use in-place delivery where supported
The system SHALL deliver non-terminal live progress as an updated per-destination progress message when the active messenger adapter supports bot-message updates, while preserving safe snapshot fallback for unsupported or failed update paths.

#### Scenario: Supported adapter updates existing progress
- **WHEN** a paired running session emits multiple eligible progress updates for a binding whose messenger adapter supports live progress updates
- **THEN** PiRelay updates the existing live progress message for that destination rather than sending a new message for each progress flush
- **AND** the progress content remains coalesced, rate-limited, redacted, and bounded by configured progress limits

#### Scenario: Unsupported adapter sends snapshots
- **WHEN** a paired running session emits eligible progress updates for a binding whose messenger adapter does not support live progress updates
- **THEN** PiRelay sends bounded coalesced progress snapshots according to the binding's progress mode
- **AND** it does not treat missing edit capability as an adapter failure

#### Scenario: Update failure falls back safely
- **WHEN** updating an existing live progress message fails because the message was deleted, expired, inaccessible, or rejected by the platform
- **THEN** PiRelay clears that live progress reference and falls back to sending a new live progress message or plain snapshot
- **AND** final failure to deliver progress is swallowed because non-terminal progress is best-effort

#### Scenario: Terminal output remains separate
- **WHEN** a Pi turn completes, fails, or aborts after live progress updates were sent or edited
- **THEN** PiRelay sends terminal output or notification according to final-output policy as a separate messenger result
- **AND** it does not merge final assistant output into the live progress card

#### Scenario: Progress modes still apply independently
- **WHEN** one binding is normal, another is verbose, another is completion-only, and another is quiet
- **THEN** live progress update/edit behavior respects each binding's existing progress-mode eligibility independently
- **AND** quiet receives no live progress while completion-only receives no ordinary live progress
