## Why

Pi sessions are currently easiest to monitor and steer from the terminal where they are running. A Telegram tunnel would let a trusted user leave a long-running Pi task unattended, receive a concise completion summary on mobile, request the full output when needed, and send follow-up or steering commands back to the exact session that was paired.

## What Changes

- Add a Pi package that provides a Telegram-backed remote-control tunnel for the currently active Pi session.
- Pair a private Telegram chat to a session by running a Pi command/skill in that session and scanning a QR code containing a Telegram bot deep link.
- Send task lifecycle notifications, completion summaries, and on-demand full output to the paired Telegram chat.
- Preserve important decision points when long assistant output would otherwise be cropped in Telegram, including chunked continuation or explicit full-output affordances.
- Accept authorized Telegram messages and commands, routing them back into the paired Pi session as normal prompts, steering messages, follow-ups, or control operations.
- Support a structured mobile answer workflow for assistant outputs that contain questions or choices, so the user can respond interactively without manually retyping long option blocks.
- Persist session-scoped binding metadata so a resumed session can reconnect, while keeping bot tokens and pairing secrets out of session history.
- Include guardrails for Telegram message limits, authorization, pairing expiry, disconnect/revoke, and multi-session routing.

## Capabilities

### New Capabilities
- `telegram-session-tunnel`: Pair a Telegram private chat with a specific Pi session, stream lifecycle notifications, deliver summaries/full output, and accept remote commands for that session.

### Modified Capabilities

## Impact

- New Pi package resources: a runtime extension, a discoverability/usage skill, optional prompts/docs, and package metadata.
- New dependencies likely include a Telegram Bot API client (`grammy` or equivalent) and QR generation (`qrcode`/`qrcode-terminal`).
- Uses Pi extension APIs for commands, session lifecycle events, message/agent events, `sendUserMessage`, `ctx.abort`, `ctx.compact`, session state, and custom TUI rendering/widgets.
- Requires a Telegram bot token configured via environment variable or a local user config file; no public webhook endpoint is required for the polling-based MVP.
