## Why

PiRelay already supports multiple paired Pi sessions through one Telegram bot, but the UX can be clearer when a single chat controls more than one session. The improvement should stay small and explicit: one active session pointer, compact switching, useful labels, and no distributed hub complexity.

## What Changes

- Make `/telegram-tunnel connect [name]` accept an optional human-friendly session label for pairing and Telegram session lists.
- Improve the default session label to prefer the project folder name when no explicit connect name or Pi session name is available.
- Refine `/sessions` to show a compact, understandable list with active/online/busy/offline status and enough disambiguation for duplicate labels.
- Keep `/use <number|name>` as the explicit way to switch the active session for a chat.
- Add `/to <session> <prompt>` as an optional one-shot prompt target without changing the active session.
- Ensure notifications identify the originating session when a chat has multiple paired sessions.
- Document the simple invariant: one bot token has one authoritative broker; same-machine multiplexing is supported, cross-machine one-chat hub mode is out of scope.

## Capabilities

### New Capabilities

### Modified Capabilities
- `telegram-session-tunnel`: refines session naming, selection, one-chat/multiple-session routing, and multiplexing UX.

## Impact

- Affected code: local `/telegram-tunnel connect` command parsing, route/session label generation, broker session selection, Telegram `/sessions`, `/use`, notification formatting, tests, and documentation.
- Existing paired sessions continue to work with their saved labels.
- No support for multiple brokers sharing one bot token, remote relay hubs, group chats, broadcast prompts, or natural-language session guessing in this change.
