## Why

Telegram users currently have to type option numbers or `/full` manually after a shortened Pi completion, and option detection is still heuristic enough to miss real assistant choice blocks. This change makes mobile follow-up decisions more reliable and more native by adding inline buttons for choices, custom answers, and full-output retrieval.

## What Changes

- Improve structured answer detection for final assistant output using broader option patterns and conservative confidence/fallback behavior.
- Send Telegram inline keyboards for detected answer choices so users can tap an option instead of typing its number.
- Add an inline “Custom answer” action that captures the next Telegram text message as the answer for the latest completed turn.
- Add inline full-output actions on completion/answer messages: “Show in chat” for Telegram-sized formatted chunks and “Download .md” for a Markdown attachment containing the latest assistant message.
- Reformat assistant output sent into Telegram chat for mobile readability, especially Markdown tables that Telegram does not render natively.
- Keep `/full`, direct numeric replies, `answer`, and plain text fallback behavior working for clients that do not use buttons.
- Support the same callback/button behavior in both in-process and broker runtimes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `telegram-session-tunnel`: add inline Telegram answer actions, custom-answer capture, stronger structured-output detection, one-click latest-assistant full-output retrieval, and mobile-friendly chat formatting.

## Impact

- Telegram Bot API usage expands from message polling to callback-query polling and inline keyboard reply markup.
- Telegram send helpers need support for callback acknowledgements, reply markup, and Markdown document delivery.
- Telegram chat delivery needs a deterministic formatting pass for mobile-friendly Markdown, including table conversion to readable monospace blocks.
- Runtime state must track per-chat/session/turn callback actions and pending custom-answer capture with expiry.
- Broker IPC must forward callback-driven prompt delivery and full-output actions consistently with the in-process runtime.
- Tests should cover real transcript option detection, callback handling, custom answer capture/cancel/expiry, full-output buttons, Markdown download, and broker parity.
