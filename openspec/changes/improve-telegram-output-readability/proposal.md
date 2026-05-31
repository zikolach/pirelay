## Why

Short Telegram completion notifications can be harder to read than the available full output because the broker fallback path currently collapses paragraph/list formatting into a 320-character deterministic summary even when the full assistant message is small enough to fit safely in chat. Users should not need `/full` to recover readability when the original message is already within platform limits.

## What Changes

- Preserve readable final assistant output for Telegram terminal notifications when the output fits within existing safe message/chunk limits.
- Make broker-owned Telegram delivery follow the same terminal-output policy as in-process delivery instead of always reducing completed output to a collapsed summary.
- Decouple progress mode from terminal-output length: `quiet` controls non-terminal progress noise, not whether a short final answer is summarized.
- Use summaries or excerpts only when platform limits, adapter capabilities, or an explicit future terminal-output preference require shortening.
- Offer `/full`, full-output buttons, or Markdown document fallback whenever the terminal notification is shortened, summarized, excerpted, or otherwise differs from the full assistant output.
- Keep existing Telegram platform limits, redaction, chunking, document fallback, and protected binding checks intact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `messenger-relay-sessions`: Clarify readable terminal output delivery, progress-mode separation, and broker/in-process parity for Telegram completion notifications.
- `relay-file-delivery`: Clarify when full assistant output is sent as chat text versus shortened or delivered as a Markdown document fallback.

## Impact

- Affected runtime paths: Telegram in-process runtime completion delivery, broker runtime `sendToBoundChat` completion forwarding, and shared final-output/summary helpers.
- Affected UX: Telegram completion notifications preserve paragraphs/lists for small outputs in all progress modes that send terminal notifications, and expose full-output retrieval whenever text is shortened.
- Affected tests/docs: add regression tests for short formatted outputs, broker parity, quiet-mode non-terminal progress behavior, and full-output action availability.
- No new runtime dependencies or breaking configuration changes are expected.
