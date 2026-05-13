# slack-runtime-client Specification

## Purpose
Slack runtime client defines PiRelay's live Slack Socket Mode runtime behavior, including lifecycle management, event acknowledgement and deduplication, workspace/bot identity discovery, safe Web API operations, and secret-safe diagnostics.

## Requirements
### Requirement: Live Slack Socket Mode lifecycle
The system SHALL start, monitor, reconnect, and stop a live Slack Socket Mode runtime when Slack relay is explicitly enabled and configured with the required credentials.

#### Scenario: Slack runtime starts when configured
- **WHEN** PiRelay starts with Slack enabled, a Slack bot token configured, Socket Mode selected, and an app-level Socket Mode token available
- **THEN** the system opens a Slack Socket Mode connection and begins receiving Slack events for the configured app
- **AND** startup status reports Slack readiness without printing the bot token, app-level token, signing secret, or Socket Mode URL

#### Scenario: Slack runtime is disabled
- **WHEN** PiRelay starts without Slack enabled, without a Slack bot token, or without Socket Mode credentials for Socket Mode operation
- **THEN** the system does not start a Slack runtime
- **AND** Telegram and Discord behavior remains unchanged

#### Scenario: Slack startup fails
- **WHEN** the Slack runtime cannot authenticate, open Socket Mode, or validate its workspace identity
- **THEN** the system reports a safe local status or doctor diagnostic that names the failed readiness category
- **AND** it does not print Slack tokens, signing secrets, app-level tokens, Socket Mode URLs, or raw authorization headers
- **AND** other configured messenger runtimes remain available when otherwise healthy

#### Scenario: Slack runtime stops
- **WHEN** the Pi session shuts down or the last registered local route is unregistered
- **THEN** the Slack runtime closes Socket Mode, clears timers, and releases local resources without leaving child processes, pollers, or reconnect loops running

### Requirement: Slack event acknowledgement and retry safety
The system SHALL acknowledge Slack Socket Mode envelopes promptly and deduplicate Slack retries before route handling can inject prompts or execute controls.

#### Scenario: Event envelope is received
- **WHEN** Slack delivers an event envelope over Socket Mode
- **THEN** PiRelay acknowledges the envelope before doing long-running route, command, media, or Pi prompt work
- **AND** it normalizes the payload into the Slack adapter event model when the payload type is supported

#### Scenario: Slack retries an event
- **WHEN** Slack redelivers an event with the same envelope id, event id, message timestamp, or interaction id within the dedupe window
- **THEN** PiRelay ignores the duplicate for prompt injection, command execution, pairing completion, media download, and action handling
- **AND** it may acknowledge the duplicate without emitting a second user-visible response

#### Scenario: Unsupported Slack payload arrives
- **WHEN** Slack delivers an unsupported Socket Mode payload type
- **THEN** PiRelay acknowledges or safely ignores the payload without throwing an unhandled runtime error
- **AND** diagnostic output, if any, is secret-safe

### Requirement: Slack bot identity discovery
The system SHALL discover and cache the configured Slack app identity needed for self-loop prevention, authorization, and shared-room targeting.

#### Scenario: Bot identity is discovered
- **WHEN** the Slack runtime starts with a valid bot token
- **THEN** it calls Slack identity APIs or equivalent startup checks to determine the workspace/team id, bot user id, bot id, and app id when available
- **AND** it uses that identity for self-message filtering and local mention targeting

#### Scenario: Configured workspace does not match
- **WHEN** Slack identity discovery reports a workspace/team id that differs from the configured workspace boundary
- **THEN** PiRelay refuses to start unsafe Slack ingress for that runtime
- **AND** it reports a secret-safe workspace mismatch diagnostic

#### Scenario: Bot identity cannot be discovered
- **WHEN** Slack bot identity discovery fails but the runtime has a configured non-secret bot user id override
- **THEN** PiRelay may continue in degraded mode using the override and reports the degraded state
- **WHEN** neither discovery nor override is available for shared-room operation
- **THEN** PiRelay disables shared-room Slack ingress and reports that local bot identity is required

### Requirement: Slack Web API operations
The system SHALL provide Slack Web API operations required by the runtime using Slack platform limits and secret-safe error handling.

#### Scenario: Runtime posts a Slack text response
- **WHEN** PiRelay sends a Slack text response for a command, prompt acknowledgement, completion, or error
- **THEN** the runtime calls Slack Web API with the configured bot token
- **AND** it applies Slack message length and Block Kit limits through chunking or safe fallback behavior

#### Scenario: Runtime answers a Slack action
- **WHEN** an authorized Slack action or Block Kit button is handled
- **THEN** the runtime acknowledges or responds through the available Slack response URL or ephemeral response path
- **AND** it does not expose internal action ids or callback payload internals to unauthorized users

#### Scenario: Runtime downloads Slack media
- **WHEN** an authorized Slack message includes a supported file or image and the target model/command requires media download
- **THEN** the runtime downloads the file with the bot token only after authorization and size/MIME validation gates pass

#### Scenario: Slack file upload is unavailable
- **WHEN** a command or output path requires Slack file upload and the runtime does not yet support the required Slack upload flow or scopes
- **THEN** PiRelay returns an explicit Slack capability limitation instead of silently dropping output or pretending upload succeeded

### Requirement: Slack runtime diagnostics
The system SHALL expose secret-safe diagnostics for live Slack runtime readiness and operation.

#### Scenario: Doctor checks Slack runtime readiness
- **WHEN** the local user invokes `/relay doctor` with Slack configured
- **THEN** diagnostics report whether Slack is enabled, credentials are present by category, Socket Mode is configured, bot identity is known, workspace boundary is set, required scopes are likely present, channel membership is expected, and shared-room mode is safe to start

#### Scenario: Diagnostics include Slack API failures
- **WHEN** a Slack API call fails during setup, startup, preflight, or runtime operation
- **THEN** displayed and logged diagnostics include the Slack method and non-secret error code or category
- **AND** they redact bot tokens, app-level tokens, signing secrets, authorization headers, Socket Mode URLs, response URLs, pairing codes, and hidden prompt content

