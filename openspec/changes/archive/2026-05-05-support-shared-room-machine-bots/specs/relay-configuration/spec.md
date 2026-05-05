## ADDED Requirements

### Requirement: Shared-room machine bot configuration
The system SHALL expose configuration and diagnostics for identifying a machine bot in shared rooms without storing or printing secrets.

#### Scenario: Machine display identity is configured
- **WHEN** PiRelay configuration defines a machine id, optional display name, and optional aliases for shared-room targeting
- **THEN** setup guidance, `/relay doctor`, and shared-room command help use those non-secret identifiers to explain how users can target that machine

#### Scenario: Shared-room readiness is diagnosed
- **WHEN** the local user invokes `/relay doctor` for a messenger instance intended for shared-room use
- **THEN** diagnostics report messenger readiness, machine identity, room/group/channel visibility requirements, authorization policy, and whether plain-text active-session routing is expected to work without printing tokens, pairing codes, hidden prompts, tool internals, or transcripts

#### Scenario: Duplicate local token is configured
- **WHEN** two configured messenger instances in the same config/state directory resolve to the same bot token or account fingerprint
- **THEN** diagnostics report a blocking or high-severity warning that shared-room machine-bot mode requires distinct bot/app identities and must not start duplicate local ingress for the same account when unsafe

#### Scenario: Cross-machine duplicate cannot be proven
- **WHEN** setup guidance describes shared-room deployment across multiple machines
- **THEN** it explicitly states that PiRelay cannot guarantee global duplicate-token prevention without broker coordination and that each machine must be configured with its own dedicated bot/app token for no-federation shared-room mode

### Requirement: Shared-room setup guidance
The system SHALL guide users to create one shared room per messenger and invite every participating machine bot/app with the permissions required by that platform.

#### Scenario: Telegram shared-room guidance is requested
- **WHEN** `/relay setup telegram` describes shared-room mode
- **THEN** it explains that multiple machine bots require a Telegram group or supergroup, that each machine needs a dedicated bot token, and that ordinary unaddressed prompts require bot privacy mode or permissions that allow the bot to see group messages

#### Scenario: Discord shared-room guidance is requested
- **WHEN** `/relay setup discord` describes shared-room mode
- **THEN** it explains that each machine uses a dedicated Discord application/bot identity in a shared server channel, that reliable text-prefix or mention forms are preferred, and that required intents/scopes/channel permissions must be enabled

#### Scenario: Slack shared-room guidance is requested
- **WHEN** `/relay setup slack` describes shared-room mode
- **THEN** it explains that each machine uses a dedicated Slack app/bot identity in a shared channel or DM-equivalent supported by Slack, with event scopes and channel membership sufficient for the selected command and mention fallback behavior
