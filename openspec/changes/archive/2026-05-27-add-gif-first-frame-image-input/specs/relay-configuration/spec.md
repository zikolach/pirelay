## ADDED Requirements

### Requirement: GIF conversion uses safe default configuration and existing media limits
The system SHALL enable GIF first-frame conversion through safe defaults while preserving the existing direct image MIME allow-list semantics and media size limits.

#### Scenario: Direct image allow-list remains model-ready formats
- **WHEN** PiRelay resolves default image MIME configuration
- **THEN** JPEG, PNG, and WebP remain the direct model-ready image formats
- **AND** raw GIF is not treated as a direct model-ready image format solely by adding `image/gif` to the direct allow-list

#### Scenario: GIF is accepted as a convertible inbound format by default
- **WHEN** PiRelay evaluates an authorized inbound `image/gif` attachment using default configuration
- **THEN** the system treats GIF as an allowed convertible inbound image format for first-frame conversion

#### Scenario: Inbound size limit applies before conversion
- **WHEN** an inbound GIF attachment exceeds the configured inbound image byte limit before conversion
- **THEN** PiRelay rejects it before decoding or prompt injection

#### Scenario: Converted image size limit applies after conversion
- **WHEN** a GIF first frame converts to a static image that exceeds the configured inbound image byte limit or model-safe image bounds
- **THEN** PiRelay rejects the converted image before prompt injection and returns a safe error

#### Scenario: Setup and diagnostics describe GIF conversion accurately
- **WHEN** setup guidance, `/relay doctor`, README, or testing documentation describes accepted image input formats
- **THEN** it states that JPEG, PNG, and WebP are accepted directly and GIF is accepted by first-frame conversion, subject to the configured media limits
