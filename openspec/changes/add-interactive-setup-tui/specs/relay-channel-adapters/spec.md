## MODIFIED Requirements

### Requirement: Channel adapter capability declaration
The system SHALL require each channel adapter to declare supported transport capabilities, platform limits, and setup metadata needed by the shared setup wizard.

#### Scenario: Adapter lacks inline buttons
- **WHEN** the relay core wants to present actions but the selected channel adapter does not support inline buttons
- **THEN** the system falls back to text commands or another declared supported interaction mode

#### Scenario: Adapter has smaller message limit
- **WHEN** an outbound message exceeds the active channel adapter's declared message size limit
- **THEN** the system chunks, truncates, or offers document download according to shared relay behavior and adapter capabilities

#### Scenario: Adapter exposes setup metadata
- **WHEN** a supported messenger adapter is available for setup
- **THEN** it provides or contributes setup metadata such as required credential categories, optional credential categories, relevant platform links, platform-specific intents or permissions, and safety notes
- **AND** this metadata does not include resolved token, signing secret, OAuth secret, broker peer secret, pairing code, hidden prompt, tool-internal, or transcript values

#### Scenario: Setup metadata is missing for a future adapter
- **WHEN** a future messenger adapter does not provide custom setup metadata
- **THEN** the setup wizard falls back to generic messenger setup guidance and explicit unsupported or incomplete readiness findings rather than crashing
