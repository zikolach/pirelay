## ADDED Requirements

### Requirement: Slack runtime configuration
The system SHALL load and validate the Slack credentials and non-secret identity settings required for live Slack runtime operation.

#### Scenario: Slack Socket Mode config is loaded
- **WHEN** canonical config or environment variables provide a Slack bot token, signing secret, event mode, app-level Socket Mode token reference, workspace id, and authorization policy
- **THEN** PiRelay resolves the Slack runtime configuration without writing token values into state, diagnostics, session history, or migrated config

#### Scenario: Slack app-level token is missing
- **WHEN** Slack is enabled with Socket Mode but no app-level Socket Mode token or token environment reference is available
- **THEN** setup and doctor diagnostics report that Socket Mode requires an app-level token with the appropriate Slack connection permission
- **AND** PiRelay does not start unsafe Slack ingress for that instance

#### Scenario: Slack bot user id is configured as override
- **WHEN** Slack configuration or environment provides a non-secret bot user id override
- **THEN** PiRelay may use it as a fallback for local mention targeting and diagnostics when runtime discovery is unavailable
- **AND** diagnostics indicate whether the id was discovered or configured manually

### Requirement: Slack runtime readiness diagnostics
The system SHALL report Slack live runtime readiness and shared-room safety without exposing secrets.

#### Scenario: Doctor reports Slack live readiness
- **WHEN** the local user invokes `/relay doctor` and Slack is configured
- **THEN** diagnostics report Slack enabled state, event mode, bot token presence, signing secret presence, app-level token presence when needed, workspace boundary, bot identity discovery, channel-control setting, shared-room room hint, and user allow-list/trust posture
- **AND** diagnostics do not print Slack bot tokens, app-level tokens, signing secrets, response URLs, Socket Mode URLs, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Slack shared-room configuration is unsafe
- **WHEN** Slack shared-room control is enabled without a known local bot user id, workspace boundary, channel membership confidence, or sufficient authorization policy
- **THEN** diagnostics report the missing readiness category and recommend the safer DM-first setup
- **AND** Slack channel prompt routing remains disabled until the unsafe condition is resolved

#### Scenario: Duplicate Slack app identity is detected locally
- **WHEN** two locally configured Slack instances resolve to the same Slack app, bot user id, bot id, or token/account fingerprint
- **THEN** diagnostics report that shared-room mode requires distinct Slack app identities per machine
- **AND** PiRelay refuses or disables duplicate local ingress when safe to do so

### Requirement: Slack setup guidance for complete runtime
The system SHALL guide users through configuring Slack for full PiRelay runtime support rather than receive-only stub testing.

#### Scenario: Slack setup guidance is requested
- **WHEN** the local user invokes `/relay setup slack`
- **THEN** the guidance explains Slack app creation, Bot User OAuth token, signing secret, app-level Socket Mode token, required scopes, event subscriptions, workspace id, app/channel membership, allow-list/trust recommendations, and DM-first pairing
- **AND** it separately explains the additional requirements for shared-channel machine-bot mode

#### Scenario: Slack live test guidance is requested
- **WHEN** docs or diagnostics describe the optional live Slack suite
- **THEN** they explain that live credentials are opt-in, should be disposable, should be supplied through ignored local scripts or CI secrets, and must not be committed
- **AND** they distinguish production runtime behavior from diagnostic/test-only fallbacks such as bounded history polling
