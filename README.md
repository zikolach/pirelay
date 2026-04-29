# pi-telegram-session-tunnel

Telegram-backed remote control and notification tunnel for Pi sessions.

## What it does

- pairs a private Telegram chat to the current Pi session
- renders a Telegram deep-link QR code from `/telegram-tunnel connect`
- accepts authorized Telegram prompts and tunnel commands
- sends completion, failure, and abort notifications back to Telegram
- restores non-secret binding metadata when a Pi session resumes
- runs a singleton local broker per bot token for multi-session Telegram routing

## Install

```bash
pi install /absolute/path/to/pi-telegram-session-tunnel
```

Or add the package to `.pi/settings.json`.

## Configure

Preferred:

```bash
export TELEGRAM_BOT_TOKEN="<bot-token>"
```

Optional local config file:

```json
{
  "botToken": "<bot-token>",
  "busyDeliveryMode": "followUp",
  "allowUserIds": [123456789],
  "summaryMode": "deterministic"
}
```

Default config path:

```text
~/.pi/agent/telegram-tunnel/config.json
```

Recommended permissions:

```bash
chmod 600 ~/.pi/agent/telegram-tunnel/config.json
```

See [docs/config.md](docs/config.md) for all settings.

## Usage

1. Run `/telegram-tunnel setup`
2. Run `/telegram-tunnel connect`
3. Scan the QR code or open the deep link
4. Press **Start** in Telegram
5. Confirm locally if asked

After pairing, Telegram supports:

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

Plain text messages are delivered as:

- a normal Pi prompt while idle
- a follow-up or steer message while Pi is busy, based on config

When multiple Pi sessions are paired to the same Telegram chat, use `/sessions` to list them and `/use <session>` to switch the active target.

## Guided answers for long outputs

When a Pi response ends with structured choices or questions, the tunnel preserves that trailing decision block in Telegram instead of only showing a head-only preview.

- if the assistant returned numbered options, Telegram sends the option block as a follow-up message
- you can reply with the option number directly for a quick answer
- or send `answer` to enter a guided question/answer flow
- send `cancel` to leave the guided flow

This is especially useful when the most important part of the output appears near the end.

## Security notes

- only private Telegram chats are supported
- bot tokens are loaded from env or local config, never from Pi session history
- pairing uses short-lived, single-use nonces
- exported Pi sessions only contain non-secret binding metadata
- Telegram Bot API traffic is **not** end-to-end encrypted

## Development

```bash
npm install
npm run typecheck
npm test
```
