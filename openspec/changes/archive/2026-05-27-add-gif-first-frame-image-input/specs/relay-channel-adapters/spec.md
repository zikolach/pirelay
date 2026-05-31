## ADDED Requirements

### Requirement: Adapters distinguish direct image MIME support from convertible inbound image support
Messenger adapters SHALL normalize inbound GIF media as convertible image input without treating raw GIF bytes as a model-ready image content format.

#### Scenario: Telegram GIF document is normalized as convertible image media
- **WHEN** Telegram receives an authorized document attachment with MIME type `image/gif`
- **THEN** the Telegram adapter or runtime marks it as an image attachment eligible for first-frame conversion rather than rejecting it as an unsupported document or forwarding raw GIF bytes to Pi

#### Scenario: Discord GIF attachment is normalized as convertible image media
- **WHEN** Discord receives an authorized attachment with MIME type `image/gif`
- **THEN** the Discord adapter or runtime marks it as an image attachment eligible for first-frame conversion when Discord media prompt delivery is enabled

#### Scenario: Slack GIF file is normalized as convertible image media
- **WHEN** Slack receives an authorized file event with MIME type `image/gif`
- **THEN** the Slack adapter or runtime marks it as an image attachment eligible for first-frame conversion when Slack media prompt delivery is enabled

#### Scenario: Adapter capability reports conversion honestly
- **WHEN** a messenger adapter declares supported inbound image formats or reports unsupported-media guidance
- **THEN** it distinguishes direct model-ready image MIME types such as JPEG, PNG, and WebP from convertible inbound formats such as GIF

#### Scenario: Raw GIF is not emitted as outbound image content
- **WHEN** shared relay code constructs Pi image prompt content from a GIF attachment
- **THEN** the emitted image content uses the converted static image MIME type and data, not the original raw GIF MIME type and bytes
