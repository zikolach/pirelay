# PiRelay

**PiRelay** is a Telegram bridge for Pi sessions.

It pairs a private Telegram chat to the exact Pi session you are using, then lets you:

- watch Pi progress from your phone
- receive completion, failure, and abort notifications
- send prompts back into the same live Pi session
- inspect summaries or full output
- answer structured follow-up questions from Telegram
- manage multiple paired Pi sessions through one bot

Under the hood, this package is still installed as `pi-telegram-session-tunnel` and uses the `/telegram-tunnel ...` command family, but **PiRelay** is the intended product-style name.

## What PiRelay does

PiRelay connects Telegram to a live Pi session without replacing the Pi terminal UI.

Typical flow:

1. start working in Pi locally
2. run `/telegram-tunnel connect`
3. scan the QR code with Telegram
4. press **Start** in the bot chat
5. approve the pairing locally if prompted
6. receive updates and send prompts from Telegram while the same Pi session stays usable locally

That means Telegram becomes a **mobile companion** for the current session, not a separate hidden agent.

## Features

### Pairing and session routing
- pairs a **private Telegram chat** to the **current Pi session**
- uses expiring, single-use Telegram deep links
- restores non-secret binding metadata when the session resumes
- supports multiple concurrently registered Pi sessions through a local broker
- exposes `/sessions` and `/use <session>` when more than one session is paired to the same chat

### Remote prompting and control
- plain Telegram text becomes a Pi prompt when the session is idle
- while Pi is busy, Telegram text is queued as a follow-up by default
- `/steer <text>` and `/followup <text>` provide explicit delivery control
- `/abort`, `/compact`, `/pause`, `/resume`, `/status`, `/summary`, `/full`, and `/disconnect` are supported directly from Telegram

### Telegram-native activity feedback
- accepted remote prompts trigger Telegram `typing...`
- activity refreshes while Pi is still working
- if chat actions fail, PiRelay falls back to safe textual acknowledgements
- queued busy-session messages still say clearly that the message was queued

### Long-output and answer workflow
- preserves important trailing decision blocks instead of only sending a head-only preview
- detects structured choices and question sets in the latest completed assistant output
- supports direct option replies when choices are recognized
- supports an explicit Telegram answer draft via `answer`
- supports `cancel` to leave the active answer flow

### Security and resilience
- bot token is loaded from environment or local config, never from session history
- pairing nonces are short-lived and single-use
- only non-secret binding metadata is persisted in Pi session history
- unauthorized users are rejected before any prompt reaches Pi
- Telegram Bot API limitations are handled with chunking, retry/backoff, and offline/busy responses

## Requirements

- Pi installed and working
- Node.js compatible with this package (`>=20.6.0`)
- a Telegram bot token from **BotFather**
- a private Telegram chat with that bot

## Installation

Install from a local checkout:

```bash
pi install /absolute/path/to/pi-telegram-session-tunnel
```

Or add the package to your Pi package/settings configuration.

## Quick start

### 1. Create a Telegram bot
Use [@BotFather](https://t.me/BotFather) in Telegram:

1. run `/newbot`
2. choose a bot name
3. choose a unique bot username
4. copy the bot token

### 2. Configure PiRelay
Recommended:

```bash
export TELEGRAM_BOT_TOKEN="<your-bot-token>"
```

Alternative local config file:

```json
{
  "botToken": "<your-bot-token>",
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

### 3. Validate setup
In Pi:

```text
/telegram-tunnel setup
```

This checks the token and caches the bot identity.

### 4. Pair the current session
In Pi:

```text
/telegram-tunnel connect
```

Then:

1. scan the QR code or open the Telegram deep link
2. press **Start** in Telegram
3. approve the pairing locally if Pi asks for confirmation

After that, the Telegram chat is bound to the current Pi session.

## Local Pi commands

PiRelay adds the following Pi-side commands:

| Command | Purpose |
|---|---|
| `/telegram-tunnel setup` | validate the bot token and cache the bot username |
| `/telegram-tunnel connect` | create a QR/deep-link pairing flow for the current session |
| `/telegram-tunnel disconnect` | revoke the active binding |
| `/telegram-tunnel status` | show local tunnel status |

## Telegram commands

Once paired, the Telegram bot supports:

| Command | Purpose |
|---|---|
| `/help` | show available Telegram tunnel commands |
| `/status` | show session identity, online/offline state, busy/idle state, model, and activity |
| `/sessions` | list online paired Pi sessions for this chat |
| `/use <session>` | switch the active session for this chat |
| `/summary` | show the latest concise summary |
| `/full` | show the latest assistant output in Telegram-sized chunks |
| `/steer <text>` | queue steering text while Pi is running |
| `/followup <text>` | queue an explicit follow-up |
| `/abort` | request cancellation of the current run |
| `/compact` | trigger Pi context compaction |
| `/pause` | pause remote delivery |
| `/resume` | resume remote delivery |
| `/disconnect` | revoke the current chat binding |

## Prompt routing behavior

### When Pi is idle
A normal Telegram text message is delivered as a standard Pi prompt.

Expected Telegram behavior:
- the bot shows `typing...` while Pi starts working
- no noisy delivery acknowledgement is sent unless Telegram chat actions fail

### When Pi is busy
A normal Telegram text message is delivered using the configured busy mode.

Default:
- `followUp`

Expected Telegram behavior:
- the bot may continue showing `typing...` for the active run
- PiRelay replies with a clear queue acknowledgement such as:
  - `Pi is busy; your message was queued as followUp.`

### Explicit delivery controls
Use these when you want to override the default:

- `/steer <text>`
- `/followup <text>`

## Guided answer flow

PiRelay supports structured answering from Telegram when the **latest completed assistant output** contains a reliable choice set or question set.

### Choice-style answers
If Pi ends with something like:

```text
Choose:
1. sync specs now
2. archive without syncing
```

Telegram can:
- reply directly with `1` or `2`
- reply with the option text if it matches cleanly
- send `answer` to open a normalized answer draft

It also supports inline lettered choices such as:

```text
What should we do next? A) test B) commit C) ship
```

### Question-style answers
If Pi ends with explicit questions, `answer` opens a draft like:

```text
Q1: What environment should we target?
A1:

Q2: Do we archive immediately?
A2:
```

You can then:
- fill in the `A1:` / `A2:` template and send it back
- or answer step-by-step as prompted

### Fallback behavior
PiRelay is intentionally conservative.

If the latest output is not reliably structured:
- it will **not** enter answer mode
- it will tell you to use `/full` or send a normal text reply instead

### Exit answer mode
Send:

```text
cancel
```

## Multi-session behavior

PiRelay uses a local singleton broker per bot token so multiple active Pi sessions can share one Telegram bot safely.

If one Telegram chat is paired to multiple live sessions:
- use `/sessions` to list them
- use `/use <session>` to pick the active target

This avoids Telegram polling conflicts and keeps routing explicit.

## Configuration

Supported configuration keys include:

```json
{
  "botToken": "<telegram-bot-token>",
  "stateDir": "~/.pi/agent/telegram-tunnel",
  "pairingExpiryMs": 300000,
  "busyDeliveryMode": "followUp",
  "allowUserIds": [123456789],
  "summaryMode": "deterministic",
  "maxTelegramMessageChars": 3900,
  "sendRetryCount": 3,
  "sendRetryBaseMs": 800,
  "pollingTimeoutSeconds": 20,
  "redactionPatterns": ["token\\s*[:=]\\s*\\S+"]
}
```

Environment variables:

- `TELEGRAM_BOT_TOKEN`
- `PI_TELEGRAM_TUNNEL_CONFIG`
- `PI_TELEGRAM_TUNNEL_STATE_DIR`
- `PI_TELEGRAM_TUNNEL_PAIRING_EXPIRY_MS`
- `PI_TELEGRAM_TUNNEL_BUSY_MODE`
- `PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS`
- `PI_TELEGRAM_TUNNEL_SUMMARY_MODE`
- `PI_TELEGRAM_TUNNEL_MAX_MESSAGE_CHARS`
- `PI_TELEGRAM_TUNNEL_SEND_RETRY_COUNT`
- `PI_TELEGRAM_TUNNEL_SEND_RETRY_BASE_MS`
- `PI_TELEGRAM_TUNNEL_POLLING_TIMEOUT_SECONDS`

For more detail, see [docs/config.md](docs/config.md).

## Security notes

Please treat PiRelay as a convenience/control channel, not a secret-safe transport.

Important points:

- only **private Telegram chats** are supported
- Telegram Bot API traffic is **not end-to-end encrypted**
- bot tokens are not stored in Pi session history
- exported/shared Pi sessions only contain non-secret tunnel metadata
- pairing links are single-use and expire quickly
- `allowUserIds` can restrict which Telegram users may control the tunnel
- redaction patterns can scrub common secret shapes before Telegram delivery

## Troubleshooting

### Telegram does not respond
- run `/telegram-tunnel setup`
- verify `TELEGRAM_BOT_TOKEN`
- confirm the bot exists and the username resolves in Telegram

### Pairing link expired
- run `/telegram-tunnel connect` again
- use the newly generated QR/deep link

### Telegram says the session is offline
- resume or reopen the paired Pi session locally
- if multiple sessions exist, use `/sessions` and `/use <session>`

### No visible `typing...`
- on Telegram clients, bot `typing...` commonly appears in the **top header under the bot name** rather than next to the message bubble
- if chat actions fail, PiRelay falls back to a textual acknowledgement

### Answer mode says there is nothing to answer
- the latest completed assistant output was not reliably recognized as structured
- use `/full` to inspect the full result
- send a normal reply manually if needed

### You changed code but behavior looks stale
PiRelay uses a detached local broker process.

Restart it before retesting:

```bash
pkill -f 'extensions/telegram-tunnel/broker.js'
```

Then reload Pi.

## Architecture overview

PiRelay consists of:

- a Pi extension at `extensions/telegram-tunnel/`
- a companion skill at `skills/telegram-tunnel/`
- a local broker process for multi-session Telegram polling/routing
- persisted local state under `~/.pi/agent/telegram-tunnel/`

The extension listens to Pi lifecycle events, tracks task state, publishes route updates to the broker, and injects authorized Telegram input back into the session.

## Development

```bash
npm install
npm run typecheck
npm test
```

Real Telegram regression checks and manual smoke-test steps live in:

- [docs/testing.md](docs/testing.md)

## Current limitations

- private chats only
- no Telegram group-chat support
- no end-to-end encryption beyond Telegram Bot API transport
- answer workflow depends on conservative structured-output detection
- one active OpenSpec implementation task still remains for broader integration-style coexistence/reconnect tests

## Related files

- configuration reference: [docs/config.md](docs/config.md)
- manual testing checklist: [docs/testing.md](docs/testing.md)
- Pi skill entrypoint: [skills/telegram-tunnel/SKILL.md](skills/telegram-tunnel/SKILL.md)
