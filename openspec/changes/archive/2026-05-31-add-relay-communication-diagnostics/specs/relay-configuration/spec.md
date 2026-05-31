## ADDED Requirements

### Requirement: Communication diagnostics configuration
The system SHALL expose explicit configuration and environment controls for communication diagnostics while keeping diagnostic logging disabled by default and secret-safe when enabled.

#### Scenario: Diagnostics config is absent
- **WHEN** PiRelay configuration omits communication diagnostics settings
- **THEN** communication diagnostic logging remains disabled
- **AND** no diagnostic log path, content-preview mode, or retention setting is inferred in a way that starts logging unexpectedly

#### Scenario: Diagnostics config enables metadata logging
- **WHEN** PiRelay configuration or supported environment overrides enable communication diagnostics
- **THEN** the system resolves a diagnostic log path under the configured PiRelay state directory unless a safe explicit path is provided
- **AND** it resolves bounded defaults for maximum file size, retained file count, and content-preview mode
- **AND** content previews remain disabled unless explicitly enabled

#### Scenario: Doctor reports diagnostics configuration
- **WHEN** the local user invokes `/relay doctor` with communication diagnostics configured
- **THEN** diagnostics report enablement, safe log path, retention limits, latest write status, and content-preview status
- **AND** diagnostics do not print log contents, bot tokens, signing secrets, OAuth credentials, pairing codes, hidden prompts, full transcripts, raw tool inputs, or approval secret material

#### Scenario: Unsafe diagnostic path is configured
- **WHEN** a configured diagnostic log path is unsafe, cannot be created with restrictive permissions, or points outside allowed local filesystem boundaries according to implementation policy
- **THEN** PiRelay reports an actionable local configuration warning or disables diagnostic writes safely
- **AND** it does not weaken relay authorization or messenger delivery behavior
