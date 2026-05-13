## ADDED Requirements

### Requirement: Messenger shared-room readiness diagnostics
The system SHALL report per-platform shared-room readiness and known gaps without implying unsupported parity.

#### Scenario: Telegram shared-room readiness is diagnosed
- **WHEN** `/relay doctor` or setup guidance checks a Telegram messenger intended for shared-room use
- **THEN** it reports dedicated bot identity readiness, group/supergroup requirement, privacy-mode addressed command fallback, Telegram Bot-to-Bot Communication Mode as enabled/unknown/manual-check as appropriate, and optional live smoke-test instructions

#### Scenario: Discord shared-room readiness is diagnosed
- **WHEN** `/relay doctor` or setup guidance checks a Discord messenger intended for shared-room use
- **THEN** it reports dedicated application/bot identity readiness, guild-channel enablement, allowed guild ids, Message Content Intent, channel permissions, reliable `relay <command>` or mention fallback, and slash-command collision caveats

#### Scenario: Slack shared-room readiness is diagnosed
- **WHEN** `/relay doctor` or setup guidance checks a Slack messenger intended for shared-room use
- **THEN** it reports dedicated app/bot identity readiness, Socket Mode or webhook readiness, signing-secret readiness, workspace boundary, channel-message enablement, required scopes/event subscriptions, app mention/channel command fallback, and any runtime parity gaps that remain unsupported

#### Scenario: Shared-room parity gap exists
- **WHEN** any messenger lacks implementation for a capability advertised by shared-room docs or adapter declarations
- **THEN** diagnostics and setup guidance identify that gap as unsupported or experimental until implementation and tests prove the behavior
