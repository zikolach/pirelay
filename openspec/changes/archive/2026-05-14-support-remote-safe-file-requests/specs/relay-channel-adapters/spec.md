## ADDED Requirements

### Requirement: Messenger adapters support requester-scoped remote file requests
Telegram, Discord, Slack, and future first-class messenger adapters SHALL expose remote safe file-request command behavior when their declared capabilities support outbound document or image delivery.

#### Scenario: Telegram remote file request is delivered
- **WHEN** an authorized Telegram user sends `/send-file <relative-path> [caption]` for a supported file in the selected session workspace
- **THEN** the Telegram runtime sends the validated file back to that Telegram chat using normalized document or image delivery
- **AND** preserves safe caption text when provided

#### Scenario: Discord remote file request is delivered
- **WHEN** an authorized Discord user sends `relay send-file <relative-path> [caption]` for a supported file in the selected session workspace
- **THEN** the Discord runtime sends the validated file back to the requesting DM or allowed channel context using normalized file delivery
- **AND** does not depend on unreliable bare slash-command routing for correctness

#### Scenario: Slack remote file request is delivered
- **WHEN** an authorized Slack user sends `pirelay send-file <relative-path> [caption]` for a supported file in the selected session workspace
- **THEN** the Slack runtime sends the validated file back to the requesting DM, channel, or thread context using normalized upload delivery
- **AND** preserves thread timestamp metadata where Slack routing provides it

#### Scenario: Adapter lacks file upload capability
- **WHEN** an authorized remote user requests a file through a messenger adapter that cannot send documents or lacks required platform scopes
- **THEN** PiRelay returns an explicit capability or setup limitation through that messenger
- **AND** it does not claim delivery succeeded or inject the command as an ordinary Pi prompt

#### Scenario: Adapter response is requester-scoped
- **WHEN** a remote file request is handled in a shared room, group, channel, DM, or thread
- **THEN** only the adapter instance and conversation authorized for that request sends the file or error response
- **AND** non-target machine bots or duplicate runtimes remain silent
