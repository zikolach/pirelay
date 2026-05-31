## 1. Output Policy Helpers

- [x] 1.1 Audit current terminal-output delivery paths for Telegram in-process runtime, broker runtime, `/full`, and Markdown document fallback.
- [x] 1.2 Add or extend a pure terminal-output policy helper that decides full chat chunks, shortened summary/excerpt, or document fallback from adapter limits, document support, and chunk threshold without using progress mode as a shortening proxy.
- [x] 1.3 Add a format-preserving shortening helper for cases where platform limits or a future explicit terminal-output preference require concise terminal notifications.
- [x] 1.4 Add unit tests for short formatted output across progress modes, oversized output, adapter-without-documents, and full-output-affordance decisions.

## 2. Telegram Runtime Integration

- [x] 2.1 Update in-process Telegram completion delivery to use the shared terminal-output policy without regressing current full-output and document fallback behavior.
- [x] 2.2 Update broker fallback `sendSessionNotification`/`sendToBoundChat` delivery to use the same policy and avoid deterministic 320-character summaries for output that fits safe chat delivery.
- [x] 2.3 Ensure Telegram full-output buttons or `/full` hints are offered whenever terminal notification text differs from the full assistant output, regardless of the existing long-output threshold.
- [x] 2.4 Preserve redaction, source prefixes, image hints, structured-answer actions, binding-authority checks, and stale/revoked binding behavior.

## 3. Tests and Documentation

- [x] 3.0 Add Telegram Markdown rendering tests for bold/code/link/table output, plain-text fallback, table-triggered Markdown download actions, and broker-owned completion delivery.
- [x] 3.1 Add Telegram runtime tests proving short multi-paragraph/list output is delivered readably in quiet, normal, verbose, and completion-only modes.
- [x] 3.2 Add broker parity tests proving broker-owned Telegram delivery matches in-process output policy for short formatted output and large document fallback.
- [x] 3.3 Add quiet-mode tests proving quiet suppresses non-terminal progress updates but does not shorten final output that fits safe chat delivery.
- [x] 3.4 Update docs or smoke-test guidance to describe readable terminal-output delivery and `/full`/document fallback behavior.

## 4. Validation

- [x] 4.1 Run `npm run typecheck`.
- [x] 4.2 Run `npm test`.
- [x] 4.3 Run `openspec validate improve-telegram-output-readability --strict`.
