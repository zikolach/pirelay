## ADDED Requirements

### Requirement: Telegram Bot-to-Bot Communication Mode documentation
The system SHALL document Telegram Bot-to-Bot Communication Mode as an optional shared-room machine-bot capability when Telegram supports bot-to-bot messages and both participating bots enable the platform setting.

#### Scenario: Telegram shared-room setup describes bot-to-bot mode
- **WHEN** setup guidance, docs, or diagnostics describe Telegram shared-room machine bots
- **THEN** they explain that Telegram Bot-to-Bot Communication Mode is optional and must be enabled for each participating bot before bot-authored messages can reach other bots
- **AND** they preserve `/sessions@<bot_username>`, `/use@<bot_username> <session>`, and `/to@<bot_username> <session> <prompt>` as reliable user-driven fallbacks when bot-to-bot mode, privacy settings, or group visibility do not permit ordinary bot-authored text

#### Scenario: Telegram bot-to-bot capability is unknown
- **WHEN** PiRelay cannot verify whether Telegram Bot-to-Bot Communication Mode is enabled for a bot
- **THEN** setup and diagnostics report the capability as unknown or manually verified rather than claiming it is enabled
- **AND** they provide a safe smoke-test checklist that does not print bot tokens, pairing codes, hidden prompts, tool internals, or transcripts

### Requirement: Telegram bot-authored shared-room events are safe
The system SHALL treat bot-authored Telegram shared-room events as eligible for routing only when the event is explicitly addressed to the local machine bot and the sender bot identity is authorized for the intended workflow.

#### Scenario: Authorized bot targets local machine bot
- **WHEN** Telegram delivers a group message authored by another bot that is authorized for bot-to-bot shared-room communication and the message explicitly targets the local machine bot by username, reply, or supported platform metadata
- **THEN** the local broker applies the same shared-room command, authorization, session selection, and busy-delivery rules as an equivalent authorized user event
- **AND** any output is delivered through the local machine bot identity according to normal shared-room output rules

#### Scenario: Bot-authored event targets another machine bot
- **WHEN** Telegram delivers a bot-authored group message that clearly targets another machine bot
- **THEN** the local broker remains silent and does not inject prompts, mutate active selection, download media, acknowledge success, or send typing/activity indicators

#### Scenario: Bot-authored event is not authorized
- **WHEN** Telegram delivers a bot-authored group message from an untrusted or unpaired bot identity
- **THEN** the local broker rejects the event before prompt injection, media download, callback/action execution, or session-state mutation

#### Scenario: Bot feedback loop is possible
- **WHEN** a Telegram bot-authored message originates from the local bot itself or from a bot response that would cause a bot-to-bot feedback loop
- **THEN** PiRelay ignores the event or rejects it safely without sending another bot-authored prompt into the same loop

### Requirement: Telegram bot-to-bot verification coverage
The system SHALL provide automated or opt-in live verification for Telegram bot-to-bot shared-room behavior without requiring live credentials in normal CI.

#### Scenario: Mocked integration tests run in CI
- **WHEN** the normal unit and integration suite runs without Telegram credentials
- **THEN** it verifies bot-authored local-target, remote-target, unauthorized, self-bot, and feedback-loop cases using mocked Telegram updates and adapter operations

#### Scenario: Live Telegram E2E is configured
- **WHEN** disposable Telegram bot tokens and an authorized test group id are supplied through documented environment variables
- **THEN** the optional E2E test or smoke command verifies that one bot can address the other, that the addressed PiRelay bot receives and routes only authorized commands, and that non-target bots remain silent
- **AND** the test output redacts tokens, pairing payloads, hidden prompts, tool internals, and transcripts
