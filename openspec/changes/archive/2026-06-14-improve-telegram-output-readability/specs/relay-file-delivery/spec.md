## MODIFIED Requirements

### Requirement: Full-output document fallback is messenger-neutral
PiRelay SHALL expose full assistant output as message chunks or a downloadable Markdown document according to shared final-output policy and adapter capabilities.

#### Scenario: Quiet mode suppresses progress but preserves final-output policy
- **WHEN** a paired session completes while a messenger binding is in quiet progress mode
- **THEN** PiRelay suppresses non-terminal progress updates for that binding
- **AND** sends the final assistant output according to the same bounded chunk or Markdown document fallback policy used for terminal output in other progress modes
- **AND** does not summarize or collapse formatting for output that already fits the bounded chunk policy solely because the binding is quiet

#### Scenario: Normal mode sends full final output
- **WHEN** a paired session completes while a messenger binding is in normal progress mode
- **THEN** PiRelay sends the final assistant output to the messenger conversation as paragraph-aware message chunks when it fits within bounded chunk limits
- **AND** it does not summarize or collapse formatting for outputs that already fit the bounded chunk policy
- **AND** falls back to a Markdown document when chunking would exceed the configured safe threshold and the adapter supports document delivery

#### Scenario: Verbose mode sends progress and full final output
- **WHEN** a paired session completes while a messenger binding is in verbose progress mode
- **THEN** PiRelay sends progress updates according to verbose policy and sends the final assistant output according to the same full-output chunk/file rules as normal mode

#### Scenario: Completion-only mode sends final output without progress
- **WHEN** a paired session completes while a messenger binding is in completion-only mode
- **THEN** PiRelay suppresses non-terminal progress updates and sends the final assistant output according to the same full-output chunk/file rules as normal mode

#### Scenario: Retrieval actions appear when chat output is shortened
- **WHEN** PiRelay sends a terminal chat notification containing only a summary or excerpt of the latest assistant output
- **THEN** it exposes a full-output chat or Markdown document retrieval path supported by the target adapter
- **AND** the availability of that retrieval path does not depend solely on the full output exceeding a fixed long-output character threshold

#### Scenario: Adapter lacks document delivery
- **WHEN** full output is too large for safe message chunks and the target adapter cannot send documents
- **THEN** PiRelay returns an explicit capability limitation instead of silently truncating the output
