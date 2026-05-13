## ADDED Requirements

### Requirement: Slack latest-image retrieval participates in shared media semantics
The system SHALL expose latest-image retrieval and explicit safe image delivery through Slack when the Slack adapter declares and provides live outbound file upload capability.

#### Scenario: Latest image retrieval works through Slack
- **WHEN** an authorized Slack user requests latest images for a session with valid latest-turn image outputs
- **THEN** PiRelay sends those images through Slack's file transport using the same bounded latest-image set as other messengers
- **AND** skips invalid images with safe explanatory text instead of failing the whole command when at least one valid image can be sent

#### Scenario: Slack image retrieval has no images
- **WHEN** an authorized Slack user requests latest images and no latest-turn image outputs or safe workspace image references are available
- **THEN** PiRelay returns the shared no-images guidance adapted to Slack command wording

#### Scenario: Slack upload capability is unavailable
- **WHEN** the active Slack runtime cannot upload files because live operations or app scopes are unavailable
- **THEN** PiRelay returns a capability-specific limitation or setup guidance
- **AND** it does not fall through to unknown-command help

#### Scenario: Slack upload preserves authorization boundary
- **WHEN** an unauthorized Slack user sends `pirelay images`, `pirelay send-image <path>`, or an equivalent action
- **THEN** PiRelay rejects the event before loading workspace files or calling Slack upload APIs

### Requirement: Messenger final output follows shared mode-aware policy
The system SHALL apply the same terminal assistant-output delivery policy across Telegram, Discord, Slack, and future live messengers, with only platform-specific rendering and capability fallbacks differing.

#### Scenario: Quiet binding receives concise completion
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is quiet
- **THEN** PiRelay sends a concise completion message or summary
- **AND** it offers `/full`, an equivalent command, or a downloadable Markdown action where supported for retrieving the full output

#### Scenario: Normal binding receives full final output
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is normal
- **THEN** PiRelay sends the latest assistant output as paragraph-aware message chunks when it fits safe platform limits
- **AND** it uses a document fallback when chunking would be excessive and the adapter supports documents

#### Scenario: Verbose binding receives progress and full final output
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is verbose
- **THEN** PiRelay sends non-terminal progress updates according to verbose policy
- **AND** sends the latest assistant output using the same chunk-or-document rules as normal mode

#### Scenario: Completion-only binding receives full final output without progress
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is completion-only
- **THEN** PiRelay suppresses non-terminal progress updates
- **AND** sends the latest assistant output using the same chunk-or-document rules as normal mode

#### Scenario: Full output is never silently truncated
- **WHEN** a final assistant output exceeds platform text limits and document delivery is unavailable
- **THEN** PiRelay reports an explicit capability limitation or retrieval fallback
- **AND** does not silently drop critical trailing content
