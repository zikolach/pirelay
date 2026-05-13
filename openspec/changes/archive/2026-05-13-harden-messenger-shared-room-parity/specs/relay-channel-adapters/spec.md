## ADDED Requirements

### Requirement: Shared-room platform parity inventory
The system SHALL maintain a tested inventory of shared-room capabilities and known limitations for each first-class messenger adapter.

#### Scenario: Capability inventory is generated or documented
- **WHEN** developers inspect shared-room adapter support
- **THEN** PiRelay provides a checked-in document, test fixture, or diagnostic source of truth that lists Telegram, Discord, and Slack support for private chats, group/channel messages, ordinary text visibility, bot/app mentions, replies, platform commands, media attachments, inline buttons/actions, activity indicators, command fallback, authorization model, and optional E2E status

#### Scenario: Adapter declarations disagree with documentation
- **WHEN** an adapter declares shared-room capabilities that are stronger or weaker than the documented inventory
- **THEN** tests fail or diagnostics report the discrepancy so users are not promised unsupported shared-room behavior

#### Scenario: Platform command surface is unreliable
- **WHEN** a platform may reserve, intercept, or route command syntax in a way that prevents reliable delivery to PiRelay
- **THEN** the inventory and setup guidance name the reliable fallback first, such as Telegram `/command@bot`, Discord `relay <command>` or mentions, and Slack app mentions or documented channel command forms

### Requirement: Shared-room parity tests
The system SHALL test shared-room behavior consistently across Telegram, Discord, and Slack according to each adapter's declared capabilities and safe defaults.

#### Scenario: Shared-room test matrix runs
- **WHEN** adapter shared-room tests run
- **THEN** they cover local target routing, remote target silence, ambiguous target handling, active selection scoping, unauthorized rejection, channel/guild disabled rejection, media gating, and safe output rendering for each adapter that declares the corresponding capability

#### Scenario: Capability is intentionally unsupported
- **WHEN** a messenger adapter intentionally does not support a shared-room behavior
- **THEN** tests assert the explicit unsupported diagnostic or fallback text rather than silently omitting coverage
