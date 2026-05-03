# PiRelay

![PiRelay logo](docs/logo.png)

**PiRelay** is a Telegram bridge for Pi sessions.

It pairs a private Telegram chat to the exact Pi session you are using, then lets you:

- watch Pi progress from your phone
- receive completion, failure, and abort notifications
- send prompts and screenshots/photos back into the same live Pi session
- inspect summaries, full output, or latest image artifacts
- answer structured follow-up questions from Telegram
- manage multiple paired Pi sessions through one bot

The npm package is `pirelay`. The canonical Pi command family is `/relay ...`; the old `/telegram-tunnel ...` namespace has been removed.

## What PiRelay does

PiRelay connects Telegram to a live Pi session without replacing the Pi terminal UI.

Typical flow:

1. start working in Pi locally
2. run `/relay connect telegram`
3. scan the QR code with Telegram
4. press **Start** in the bot chat
5. approve the pairing locally if prompted
6. receive updates and send prompts from Telegram while the same Pi session stays usable locally

That means Telegram becomes a **mobile companion** for the current session, not a separate hidden agent.

## Features

### Pairing and session routing
- pairs a private Telegram or Discord DM with the current Pi session
- uses expiring, single-use pairing payloads
- restores non-secret binding metadata when the session resumes
- supports multiple concurrently registered Pi sessions through a local broker
- exposes `/sessions`/`/use <session>` on Telegram and `relay sessions`/`relay use <session>` on Discord when more than one session is paired to the same chat

### Remote prompting and control
- plain Telegram or Discord DM text becomes a Pi prompt when the session is idle
- Telegram photos and supported image documents become Pi image prompts when the current model supports image input
- while Pi is busy, Telegram or Discord text/image prompts are queued as a follow-up by default
- `/steer <text>` and `/followup <text>` on Telegram, or `relay steer <text>` and `relay followup <text>` on Discord, provide explicit delivery control
- Telegram supports slash-style remote commands such as `/status`; Discord's reliable DM command form is `relay status`, `relay full`, `relay sessions`, etc. Bare Discord `/status`-style aliases are best-effort because Discord may route slash commands to another app.

### Telegram-native activity feedback
- accepted remote prompts trigger Telegram `typing...`
- activity refreshes while Pi is still working
- if chat actions fail, PiRelay falls back to safe textual acknowledgements
- queued busy-session messages still say clearly that the message was queued

### Long-output and answer workflow
- preserves important trailing decision blocks instead of only sending a head-only preview
- detects structured choices and question sets in the latest completed assistant output
- shows recognized choices as Telegram inline buttons when available
- supports direct option replies when choices are recognized
- supports a **Custom answer** button that captures your next Telegram message
- adds one-click **Show in chat** and **Download .md** buttons when the latest assistant output is longer than the inline preview, without duplicating them across summary and decision messages
- reformats Markdown tables into mobile-friendly code-style blocks for Telegram chat
- supports an explicit Telegram answer draft via `answer`
- supports `cancel` to leave the active answer flow

### Image bridge
- accepts Telegram photos and image documents (`image/jpeg`, `image/png`, `image/webp` by default) after chat/user authorization
- uses the Telegram caption as the prompt text, or a safe image-inspection fallback for image-only messages
- rejects image prompts when the selected Pi model does not advertise image input support instead of silently dropping the image
- exposes latest tool-result image outputs and safe latest-turn workspace image file references with `/images` or inline image buttons
- supports `/send-image <relative-path>` for explicit delivery of a validated workspace PNG/JPEG/WebP file
- sends outbound images as Telegram documents to avoid recompression
- does not automatically echo local/remote input images or browse arbitrary workspace files

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

Install from npm after the package is published:

```bash
pi install npm:pirelay
```

For a one-off run without adding it to settings:

```bash
pi -e npm:pirelay
```

Install from a local checkout during development:

```bash
pi install /absolute/path/to/pirelay
```

Or add the package to your Pi package/settings configuration.

## Quick start

### 1. Create a Telegram bot
Use [@BotFather](https://t.me/BotFather) in Telegram. Telegram's official BotFather guide is at <https://core.telegram.org/bots/features#botfather>.

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
~/.pi/agent/pirelay/config.json
```

Recommended permissions:

```bash
chmod 600 ~/.pi/agent/pirelay/config.json
```

### 3. Validate setup
In Pi:

```text
/relay doctor
/relay setup telegram
```

`/relay doctor` checks channel readiness and config/state permissions without printing secrets. `/relay setup telegram` checks the token and caches the bot identity.

### 4. Pair the current session
In Pi:

```text
/relay connect telegram
```

`/relay connect telegram` is the canonical pairing command.

Then:

1. scan the QR code or open the Telegram deep link
2. press **Start** in Telegram
3. approve the pairing locally if Pi asks for confirmation

After that, the Telegram chat is bound to the current Pi session.

## Local Pi commands

PiRelay adds the following Pi-side commands:

| Command | Purpose |
|---|---|
| `/relay setup telegram` | validate the bot token and cache the bot username |
| `/relay connect telegram [name]` | create a QR/deep-link pairing flow for the current session with an optional display label |
| `/relay disconnect` | revoke the active binding |
| `/relay status` | show local tunnel status |
| `/relay setup <telegram\|discord\|slack>` | show secret-safe channel setup guidance and readiness diagnostics |
| `/relay connect <telegram\|discord\|slack> [name]` | create an expiring pairing instruction for the selected channel |
| `/relay doctor` | diagnose configured relay channels, credentials, allow-lists, and config/state permissions |
| `/relay disconnect` / `/relay status` | generic aliases for Telegram disconnect/status compatibility |

Discord and Slack foundations are opt-in. Discord now includes a live DM-first bot runtime when `discord.enabled` and `discord.botToken` are configured; run `/relay setup discord` for credential, intent, invite, and DM troubleshooting guidance. Slack remains an adapter foundation until a live Slack runtime is wired. Guild/channel control requires explicit authorization config.

Credential starting points:

- Telegram: create a bot with BotFather, then set `TELEGRAM_BOT_TOKEN` (<https://core.telegram.org/bots/features#botfather>).
- Discord: create an application/bot in the Discord Developer Portal, copy the bot token to `PI_RELAY_DISCORD_BOT_TOKEN` or `discord.botToken`, enable **Message Content Intent** for plain DM prompts and `relay <command>` text controls, and optionally copy the Application ID to `PI_RELAY_DISCORD_CLIENT_ID` or `discord.clientId` for invite URL guidance (<https://discord.com/developers/docs/quick-start/getting-started>). Invite with the `bot` scope and `permissions=0` for DM-first operation; `applications.commands` is only needed for a future native `/relay <subcommand>` UX.
- Slack: create a Slack app, install it to your workspace, set the Bot User OAuth Token as `PI_RELAY_SLACK_BOT_TOKEN` or `slack.botToken`, and set the Signing Secret as `PI_RELAY_SLACK_SIGNING_SECRET` or `slack.signingSecret` (<https://api.slack.com/apps>).

## Remote messenger commands

Once paired, Telegram and Discord DMs support the same canonical command semantics with platform-specific invocation syntax. Telegram uses slash-style commands. Discord's reliable baseline is ordinary DM text prefixed with `relay`; bare Discord `/status`-style aliases are best-effort only because Discord may route slash commands to another app.

| Telegram | Discord reliable form | Purpose |
|---|---|---|
| `/help` | `relay help` | show available PiRelay commands |
| `/status` | `relay status` | show the session dashboard with identity, online/offline state, busy/idle state, model, progress mode, recent activity, and quick-action buttons |
| `/sessions` | `relay sessions` | list paired Pi sessions for this chat with number, alias/label, online/offline state, active marker, and dashboard buttons |
| `/use <session>` | `relay use <session>` | switch the active session by number, label, or session id prefix |
| `/forget <session>` | `relay forget <session>` | remove an offline paired session from the session list |
| `/to <session> <prompt>` | `relay to <session> <prompt>` | send a one-shot prompt to a session without changing the active session |
| `/progress <quiet\|normal\|verbose\|completion-only>` | `relay progress <quiet\|normal\|verbose\|completion-only>` | set per-session progress notification noise |
| `/alias <name\|clear>` | `relay alias <name\|clear>` | set or clear a chat-friendly session alias |
| `/recent` or `/activity` | `relay recent` or `relay activity` | show recent safe progress/lifecycle activity |
| `/summary` | `relay summary` | show the latest concise summary |
| `/full` | `relay full` | show the latest assistant output using the active messenger's chunking/file fallback |
| `/images` | `relay images` | download latest captured image outputs or safe image files referenced by the latest completed turn |
| `/send-image <path>` | `relay send-image <path>` | send a validated workspace PNG/JPEG/WebP file by relative path |
| `/steer <text>` | `relay steer <text>` | queue steering text while Pi is running |
| `/followup <text>` | `relay followup <text>` | queue an explicit follow-up |
| `/abort` | `relay abort` | request cancellation of the current run |
| `/compact` | `relay compact` | trigger Pi context compaction |
| `/pause` | `relay pause` | pause remote delivery |
| `/resume` | `relay resume` | resume remote delivery |
| `/disconnect` | `relay disconnect` | revoke the current chat binding |

## Prompt routing behavior

### When Pi is idle
A normal Telegram text message is delivered as a standard Pi prompt. A Telegram photo or supported image document is delivered as an image prompt when the selected Pi model supports image input.

Expected Telegram behavior:
- the bot shows `typing...` while Pi starts working
- no noisy delivery acknowledgement is sent unless Telegram chat actions fail

### When Pi is busy
A normal Telegram text message, photo, or supported image document is delivered using the configured busy mode.

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

When sending a photo or image document, put `/steer ...` or `/followup ...` in the Telegram caption to choose the delivery mode explicitly.

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
- tap an inline option button when the Telegram client supports buttons
- reply directly with a short unambiguous option such as `1` or `2`
- reply with an explicit answer phrase such as `option 1`, `choose B`, or `answer 2`
- reply with the option text if it matches cleanly and does not look like a new prompt
- tap **Custom answer** and send a free-form answer as the next message
- send `answer` to open a normalized answer draft

Long, question-like, Markdown-like, or instruction-like Telegram messages are treated as normal prompts by default, even if the latest Pi output had answer buttons. If a short reply is ambiguous, PiRelay asks whether to send it as a prompt, answer the previous question, or cancel.

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

### One-click full output
Completion or decision messages include inline full-output actions when the latest assistant message is longer than the inline preview:

- **Show in chat** sends the latest assistant message as Telegram-sized chunks
- **Download .md** sends the latest assistant message as a Markdown attachment

PiRelay shows those actions only once per completed turn. If a structured decision/options message follows the completion summary, the decision message owns the buttons and the summary stays lightweight. Short completions that already fit in the preview avoid redundant buttons. Both actions use only the latest assistant message, not tool logs or the full session transcript. `/full` remains available as a text-command fallback.

When the chat view contains Markdown tables, PiRelay reformats them into aligned code-style blocks because Telegram does not render Markdown tables natively. The **Download .md** action keeps the original Markdown table formatting, aside from configured secret redaction.

## Multi-session behavior

PiRelay uses one local authoritative broker per bot token so multiple active Pi sessions on the same machine can share one Telegram bot safely.

Internally, PiRelay uses channel adapters and interaction middleware so Telegram-specific transport stays separate from reusable session routing, authorization, output retrieval, guided answer, media, redaction, progress, and future accessibility behavior. Telegram remains fully compatible. Discord and Slack adapter foundations are available for DM-first relay integrations with injected/mockable platform clients; Telegram remains the default packaged runtime. See [docs/adapters.md](docs/adapters.md) for the adapter and middleware boundaries.

Pair sessions with short labels when useful:

```text
/relay connect telegram docs
/relay connect telegram api
```

When no label is provided, PiRelay uses the Pi session name when available, then the project folder name, then the session file basename, then a short session id fallback.

If one Telegram chat is paired to multiple sessions:
- use `/sessions` to list numbered sessions with stable visual markers, aliases/labels, active marker, online/offline state, idle/busy state, model, last activity, and dashboard buttons
- use `/use <number|alias|label>` to pick the active target
- use `/forget <number|label>` to remove an offline paired session from the list
- use `/to <session> <prompt>` for a one-shot prompt without changing the active session; quote labels that contain spaces, for example `/to "docs team" run tests`

Duplicate labels are allowed; `/sessions` adds short identifiers when needed and numeric selection always works. Lightweight markers such as `🔵` or `🟢` are derived from stable session identity and de-duplicated within the current session list when possible, so multi-session notifications are easier to distinguish without storing extra state. Ordinary prompts are not guessed when multiple live sessions exist without a selected active session.

PiRelay runs one local broker per machine. If the same bot/account is configured on multiple machines, configure one ingress owner and broker federation so other machines register their routes instead of polling the bot concurrently.

## Configuration

Canonical config lives at `~/.pi/agent/pirelay/config.json` and uses namespaced messenger instances:

```json
{
  "relay": { "machineId": "laptop", "stateDir": "~/.pi/agent/pirelay", "brokerGroup": "personal" },
  "defaults": { "pairingExpiryMs": 300000, "busyDeliveryMode": "followUp" },
  "messengers": {
    "telegram": { "default": { "enabled": true, "tokenEnv": "TELEGRAM_BOT_TOKEN" } },
    "discord": { "personal": { "enabled": true, "tokenEnv": "PI_RELAY_DISCORD_BOT_TOKEN" } },
    "slack": { "work": { "enabled": false, "tokenEnv": "PI_RELAY_SLACK_BOT_TOKEN", "signingSecretEnv": "PI_RELAY_SLACK_SIGNING_SECRET" } }
  }
}
```

Legacy Telegram tunnel config/state under `~/.pi/agent/telegram-tunnel` and `PI_TELEGRAM_TUNNEL_*` env vars are migration fallbacks only. Active non-secret bindings migrate to `telegram:default`; active pairing codes are not copied.

For more detail, see [docs/config.md](docs/config.md).

## Security notes

Please treat PiRelay as a convenience/control channel, not a secret-safe transport.

Important points:

- only **private Telegram chats** are supported in the default runtime; Discord/Slack adapter foundations are DM-first and reject guild/channel control unless explicitly enabled by future runtime wiring
- Telegram Bot API traffic is **not end-to-end encrypted**
- bot tokens are not stored in Pi session history
- exported/shared Pi sessions only contain non-secret tunnel metadata
- pairing links are single-use and expire quickly
- `allowUserIds` can restrict which Telegram users may control the tunnel
- redaction patterns can scrub common secret shapes before Telegram text/document delivery, including progress/recent-activity messages
- image files can contain visual secrets; PiRelay requires explicit `/images`, image button, or `/send-image <relative-path>` action before sending latest image outputs/files back to Telegram
- `/send-image` accepts only relative workspace PNG/JPEG/WebP paths after containment, symlink, MIME, and size validation; it is not a file browser

## Troubleshooting

### Telegram does not respond
- run `/relay setup telegram`
- verify `TELEGRAM_BOT_TOKEN`
- confirm the bot exists and the username resolves in Telegram

### Pairing link expired
- run `/relay connect telegram` again
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
pkill -f 'extensions/relay/broker/entry.js'
```

Then reload Pi.

## Architecture overview

PiRelay consists of:

- a Pi extension at `extensions/relay/`
- a companion skill at `skills/relay/`
- a local broker process for multi-session Telegram polling/routing
- persisted local state under `~/.pi/agent/pirelay/`

The extension listens to Pi lifecycle events, tracks task state, publishes route updates to the broker, and injects authorized Telegram input back into the session.

## Development

```bash
npm install
npm run typecheck
npm test
```

Real Telegram regression checks, manual smoke-test steps, and release notes live in:

- [docs/testing.md](docs/testing.md)
- [docs/releasing.md](docs/releasing.md)

## Current limitations

- private chats only
- no Telegram group-chat support
- no end-to-end encryption beyond Telegram Bot API transport
- answer workflow depends on conservative structured-output detection
- image prompts require a Pi model that supports image input
- image transfer is bounded by configured size and MIME-type limits
- `/images` only considers captured image outputs and obvious image file paths mentioned in the latest Pi turn
- one active OpenSpec implementation task still remains for broader integration-style coexistence/reconnect tests

## Related files

- configuration reference: [docs/config.md](docs/config.md)
- manual testing checklist: [docs/testing.md](docs/testing.md)
- Pi skill entrypoint: [skills/relay/SKILL.md](skills/relay/SKILL.md)
