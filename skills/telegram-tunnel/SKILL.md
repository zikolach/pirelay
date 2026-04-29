---
name: telegram-tunnel
description: Pair the current Pi session with a Telegram private chat for remote prompts, status checks, summaries, and abort/compact controls. Use when the user wants to monitor or steer Pi from Telegram.
license: MIT
---

# Telegram Tunnel

Use the extension command for all runtime actions:

- `/telegram-tunnel setup` validates `TELEGRAM_BOT_TOKEN` and caches the bot username
- `/telegram-tunnel connect` generates the QR code + Telegram deep link for the current session
- `/telegram-tunnel disconnect` revokes the active binding
- `/telegram-tunnel status` shows local tunnel state

## Setup

1. Configure `TELEGRAM_BOT_TOKEN`
2. Run `/telegram-tunnel setup`
3. Run `/telegram-tunnel connect`
4. Scan the QR code and press **Start** in Telegram
5. Confirm locally if asked

## Telegram-side commands

- `/help`
- `/status`
- `/sessions`
- `/use <session>`
- `/summary`
- `/full`
- `/steer <text>`
- `/followup <text>`
- `/abort`
- `/compact`
- `/pause`
- `/resume`
- `/disconnect`

Plain text messages are delivered as normal Pi prompts when idle and as follow-up/steer messages when busy. Accepted idle prompts show Telegram's `typing...` activity while Pi works instead of a noisy "Prompt delivered to Pi" acknowledgement; busy follow-up/steer messages keep their queued acknowledgement and continue the activity indicator.

If multiple Pi sessions are paired to the same Telegram chat, use `/sessions` to list them and `/use <session>` to switch the active one.

## Guided Telegram answer flow

If the latest Pi output contains numbered options or explicit questions, Telegram preserves that trailing decision block and supports a lightweight guided answer flow:

- reply with an option number for direct choice selection
- send `answer` to step through a guided answer flow
- send `cancel` to leave the guided answer flow

This helps when the important decision prompt appears near the end of a long assistant response.

## Security reminders

- private chats only
- Telegram Bot API is not end-to-end encrypted
- pairing links are single-use and expire quickly
- only non-secret binding metadata is stored in Pi session history
