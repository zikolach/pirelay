## 1. Structured Answer Detection

- [x] 1.1 Extend `StructuredAnswerMetadata` to include turn identity, confidence, and parser diagnostics without exposing secrets.
- [x] 1.2 Refactor choice/question extraction into candidate scoring that supports numbered, lettered, parenthesized, `Option A:`, and strongly prompted bullet choices.
- [x] 1.3 Preserve conservative fallback behavior for ambiguous lists, malformed options, code-like content, and ordinary task lists.
- [x] 1.4 Add parser tests for real transcript examples, false positives, scoring thresholds, and stable option identifiers.

## 2. Telegram Callback and Button Transport

- [x] 2.1 Extend Telegram inbound types and polling to include `callback_query` updates with chat, user, message, and callback data.
- [x] 2.2 Add Telegram API helpers for inline-keyboard messages, callback acknowledgements, and Markdown document attachments with retry/backoff and redaction.
- [x] 2.3 Define compact callback-data builders/parsers for answer option, custom answer, show-in-chat, and Markdown download actions.
- [x] 2.4 Add unit tests for callback-data parsing, stale/invalid callback rejection, and Telegram API payload shaping.

## 3. In-Process Runtime Actions

- [x] 3.1 Add inline answer and full-output buttons to in-process completion and decision-block messages when latest assistant output is available.
- [x] 3.2 Handle authorized option-button callbacks by injecting the selected answer with existing busy/idle delivery rules and typing activity.
- [x] 3.3 Implement pending custom-answer state keyed by session, chat, user, and turn; support prompt, next-text capture, `cancel`, command bypass, expiry, and stale-turn rejection.
- [x] 3.4 Handle `Show in chat` callbacks by sending latest assistant output chunks equivalent to `/full`.
- [x] 3.5 Handle `Download .md` callbacks by sending a Markdown document containing only the redacted latest assistant message.

## 4. Broker Runtime Parity

- [x] 4.1 Mirror callback-query polling, inline-keyboard sending, callback acknowledgement, and Markdown document sending in `broker.js`.
- [x] 4.2 Add broker-side state for turn-scoped custom answers and stale callback rejection.
- [x] 4.3 Ensure broker IPC can deliver callback-driven prompts/audits to live Pi routes without blocking local session interactivity.
- [x] 4.4 Add broker integration tests for option callbacks, custom answer capture, full-output actions, offline sessions, and unauthorized users.

## 5. Documentation and Validation

- [x] 5.1 Update README, config/testing docs, and Telegram tunnel skill docs with inline button answer and full-output behavior.
- [x] 5.2 Add manual smoke-test steps for option buttons, custom answer capture, show-in-chat chunks, and Markdown downloads in a real Telegram client.
- [x] 5.3 Run `npx openspec validate improve-telegram-answer-actions --strict`.
- [x] 5.4 Run package typecheck and tests.

## 6. Mobile-Friendly Chat Formatting

- [x] 6.1 Add a deterministic Telegram chat formatter for latest assistant output before chunking/sending chat messages.
- [x] 6.2 Convert Markdown tables to aligned monospace blocks for Telegram chat while preserving raw cell values.
- [x] 6.3 Preserve fenced code blocks and code-like content without table/prose reflow.
- [x] 6.4 Keep `Download .md` source-preserving apart from configured redaction.
- [x] 6.5 Add tests for table formatting, wide tables, code block preservation, redaction interaction, and broker/in-process parity.
- [x] 6.6 Update docs and manual smoke-test checklist for mobile-friendly chat formatting.
- [x] 6.7 Run OpenSpec validation, typecheck, and tests.
