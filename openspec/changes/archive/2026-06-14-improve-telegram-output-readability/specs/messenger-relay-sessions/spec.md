## MODIFIED Requirements

### Requirement: Messenger final output follows shared mode-aware policy
The system SHALL apply the same terminal assistant-output delivery policy across Telegram, Discord, Slack, and future live messengers, with only platform-specific rendering and capability fallbacks differing.

#### Scenario: Quiet binding receives terminal output without progress noise
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is quiet
- **THEN** PiRelay suppresses non-terminal progress updates for that binding
- **AND** it delivers the terminal assistant output using the same safe full-output chunk-or-document policy as other terminal-notification modes
- **AND** quiet mode does not by itself cause short final assistant output to be summarized, excerpted, or whitespace-collapsed

#### Scenario: Normal binding receives full final output
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is normal
- **THEN** PiRelay sends the latest assistant output as paragraph-aware message chunks when it fits safe platform limits
- **AND** it preserves user-visible paragraph breaks, bullets, code-ish lines, and validation-result blocks in the delivered assistant output
- **AND** for Telegram, it renders supported Markdown constructs with Telegram-safe chat formatting when the rendered message fits the configured safe chunk limit
- **AND** Telegram falls back to plain text when no Markdown formatting is needed or the rendered markup would exceed safe chunk limits
- **AND** Telegram offers a Markdown download action when the source output contains Markdown tables that are rendered with chat-safe fallbacks
- **AND** it uses a document fallback when chunking would be excessive and the adapter supports documents

#### Scenario: Verbose binding receives progress and full final output
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is verbose
- **THEN** PiRelay sends non-terminal progress updates according to verbose policy
- **AND** sends the latest assistant output using the same chunk-or-document rules as normal mode

#### Scenario: Completion-only binding receives full final output without progress
- **WHEN** a Pi turn completes for a messenger binding whose progress mode is completion-only
- **THEN** PiRelay suppresses non-terminal progress updates
- **AND** sends the latest assistant output using the same chunk-or-document rules as normal mode

#### Scenario: Progress mode does not determine final-output length
- **WHEN** a completed assistant output would fit within the messenger's configured safe text chunk policy after redaction and formatting
- **THEN** PiRelay sends that output losslessly as chat text for every progress mode that emits terminal notifications
- **AND** it does not replace the output with a whitespace-collapsed deterministic summary only because the binding uses quiet mode or only to reduce a comparable-size message

#### Scenario: Shortened output offers full retrieval
- **WHEN** PiRelay sends a terminal notification whose visible assistant text is summarized, excerpted, truncated, reformatted, or otherwise not equal to the latest full assistant output
- **THEN** the notification includes a supported `/full` hint, button, equivalent command, or document/download action for retrieving the full output

#### Scenario: Broker and in-process terminal output are equivalent
- **WHEN** the same Telegram completion is delivered through the in-process runtime and the broker-owned runtime
- **THEN** both paths apply the same progress-mode, chunking, formatting-preservation, summary/excerpt, and full-output retrieval policy
- **AND** neither path silently downgrades a small readable output to a collapsed summary while the other sends it in full

#### Scenario: Full output is never silently truncated
- **WHEN** a final assistant output exceeds platform text limits and document delivery is unavailable
- **THEN** PiRelay reports an explicit capability limitation or retrieval fallback
- **AND** does not silently drop critical trailing content
