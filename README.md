# PiRelay

![PiRelay logo](docs/logo.png)

**PiRelay** is a messenger bridge for live Pi sessions.

It pairs Telegram, Discord, or Slack chats with the exact Pi session you are using, then lets you monitor progress, receive completion notifications, and send prompts or control commands back into that same local Pi session.

The npm package is `pirelay`. The canonical Pi command family is `/relay ...`; the old `/telegram-tunnel ...` namespace has been removed.

## What PiRelay does

PiRelay keeps Pi local-first. It does not replace the terminal UI or start a hidden standalone agent. Instead, it registers the current Pi session with a local relay runtime and lets an authorized messenger chat steer that session remotely.

Typical flow:

1. start working in Pi locally
2. configure one messenger with `/relay setup <telegram|discord|slack>`
3. run `/relay connect <messenger>`
4. scan/open the QR/deep link or copy the pairing command
5. approve or trust the remote user locally if prompted
6. receive updates and send prompts while the Pi session stays usable locally

## Supported messengers

| Messenger | Current support | Reliable command form |
|---|---|---|
| Telegram | private bot chat, media bridge, inline actions, multi-session broker, BotCommand menu | `/status`, `/full`, `/progress verbose` |
| Discord | live DM-first bot runtime, optional explicit guild/channel control, best-effort native `/relay` | `relay status`, `relay full`, `relay progress verbose` |
| Slack | Socket Mode live runtime, App Home DM pairing, optional explicit channel/thread control, `/relay` manifest surface | `relay status`, `relay full`, `relay progress verbose` |

Discord and Slack still document text prefixes first because native slash commands require platform sync/manifest delivery and can be stale or intercepted by another app.

## Features

### Pairing and session routing

- pairs Telegram private chats, Discord DMs, Slack App Home DMs, or explicitly enabled Slack/Discord channels with the current Pi session
- uses expiring, single-use pairing payloads or mobile-friendly PIN commands
- closes the local pairing QR/dialog automatically when pairing completes
- shows local pairing completion notifications consistently across messengers
- restores non-secret binding metadata when a Pi session resumes with `pi --continue`
- supports multiple concurrently registered Pi sessions through a local broker
- exposes session selection commands when more than one session is paired to the same chat

### Remote prompting and control

- plain authorized text becomes a Pi prompt when the session is idle
- while Pi is busy, prompts are queued as follow-ups by default or steered explicitly when configured
- Telegram photos and supported image documents become Pi image prompts when the selected model supports image input
- Discord and Slack expose the same command semantics with platform-specific text prefixes
- Slack channel/thread prompts are gated by `slack.allowChannelMessages` and an explicit channel pairing

### Progress and activity feedback

- Telegram uses Bot API chat actions such as `typing...` where available
- Discord uses typing activity where available
- Slack uses a `:thinking_face:` reaction on accepted prompts when the app has `reactions:write`
- Slack falls back to a thread-aware ephemeral `Pi is working…` message when reactions are unavailable
- progress notifications support `quiet`, `normal`, `verbose`, and `completion-only`
- Telegram `/recent` and Discord/Slack `relay recent` show recent safe activity

### Long-output and answer workflow

- sends summaries, full output, and latest assistant text with platform-aware chunking/fallbacks
- detects structured choices and question sets in the latest completed assistant output
- supports Telegram inline buttons for recognized choices
- supports direct short option replies and explicit `answer` drafts
- adds one-click **Show in chat** and **Download .md** actions where Telegram supports them
- reformats Markdown tables into mobile-friendly blocks for Telegram chat

### Image bridge

- accepts Telegram photos and image documents (`image/jpeg`, `image/png`, `image/webp` by default) after authorization
- uses the Telegram caption as prompt text, or a safe image-inspection fallback for image-only messages
- rejects image prompts when the selected Pi model does not support image input
- exposes latest tool-result image outputs and safe latest-turn workspace image references with `/images`
- supports `/send-image <relative-path>` for explicit delivery of validated workspace PNG/JPEG/WebP files
- does not browse arbitrary workspace files or automatically echo local/remote input images

### Safety and resilience

- authorization happens before prompt injection, media download, callbacks, or control actions
- pairing links/PINs expire and are single-use
- raw bot tokens, signing secrets, app tokens, hidden prompts, tool internals, and transcripts are not persisted in relay state
- config writer stores secret env var names such as `tokenEnv`, `signingSecretEnv`, and `appTokenEnv`, not resolved secret values
- Telegram/Discord/Slack API limitations are handled with chunking, retry/backoff, explicit unsupported-feature messages, and offline/busy responses

## Requirements

- Pi installed and working
- Node.js compatible with this package (`>=20.6.0`)
- at least one configured messenger:
  - Telegram bot token from BotFather
  - Discord bot token and application id
  - Slack bot token, signing secret, and usually Socket Mode app token

## Installation

Install from npm when available:

```bash
pi install npm:pirelay
```

Install from GitHub or a local checkout during development:

```bash
pi install https://github.com/zikolach/pirelay
pi install /absolute/path/to/pirelay
```

For a one-off run without adding it to settings:

```bash
pi -e npm:pirelay
```

## Quick start

### 1. Choose and configure a messenger

Run the setup wizard inside Pi:

```text
/relay setup telegram
/relay setup discord
/relay setup slack
```

The setup wizard is secret-safe and tab-based. It shows diagnostics, env snippets, config snippets, links/QR guidance, troubleshooting, and for Slack a copyable app manifest that includes App Home, interactivity, scopes, events, and `/relay`.

Useful setup actions:

- `c` copies placeholder env exports to the system clipboard, with Pi editor fallback
- `w` writes/updates canonical config from currently defined env vars without storing secret values
- Slack-only `m` copies a secret-free Slack app manifest

### 2. Pair the current session

```text
/relay connect telegram [name]
/relay connect discord [name]
/relay connect slack [name]
```

Then follow the messenger-specific instructions:

- Telegram: scan/open the bot deep link and press **Start**
- Discord: DM the bot with `relay pair 123-456`
- Slack: open the App Home DM and send `relay pair 123-456`, or invite the app to a channel and paste the command there after enabling `slack.allowChannelMessages`

If the remote identity is not already allow-listed or trusted, Pi asks locally whether to allow, trust, or deny the pairing.

### 3. Check status remotely

```text
/status               # Telegram
relay status          # Discord
relay status        # Slack
```

## Messenger setup details

### Telegram

Create a bot with [BotFather](https://core.telegram.org/bots/features#botfather), then set one of:

```bash
export PI_RELAY_TELEGRAM_BOT_TOKEN="123456789:AA..."
# legacy alias still supported:
export TELEGRAM_BOT_TOKEN="123456789:AA..."
```

Optional allow-list:

```bash
export PI_RELAY_TELEGRAM_ALLOW_USER_IDS="123456789"
```

After startup validation, PiRelay best-effort registers Telegram's bot command menu from the same canonical command registry used by `/help`. Hyphenated commands use Telegram-safe aliases such as `/sendfile` and `/sendimage`; `/send-file` and `/send-image` text remain supported.

### Discord

Create an application/bot in the [Discord Developer Portal](https://discord.com/developers/docs/quick-start/getting-started).

Recommended env:

```bash
export PI_RELAY_DISCORD_BOT_TOKEN="..."
export PI_RELAY_DISCORD_APPLICATION_ID="123456789012345678"
export PI_RELAY_DISCORD_ALLOW_USER_IDS="123456789012345678"
```

Enable **Message Content Intent** for plain DM prompts and `relay <command>` text controls. Invite with `bot applications.commands` scope and `permissions=0` for DM-first operation. PiRelay best-effort syncs one native `/relay` command with subcommands after login, but `relay <command>` text remains the reliable fallback, especially in shared rooms. Guild/channel control requires explicit config.

### Slack

Create a Slack app at <https://api.slack.com/apps>. `/relay setup slack` can copy a ready-to-paste app manifest including the `/relay` slash command. Reinstall/update the app after adding slash commands, scopes, events, or interactivity.

Recommended Socket Mode env:

```bash
export PI_RELAY_SLACK_BOT_TOKEN="xoxb-..."
export PI_RELAY_SLACK_SIGNING_SECRET="..."
export PI_RELAY_SLACK_APP_TOKEN="xapp-..."
export PI_RELAY_SLACK_APP_ID="A0123456789"
export PI_RELAY_SLACK_WORKSPACE_ID="T0123456789"
export PI_RELAY_SLACK_ALLOW_USER_IDS="U0123456789"
```

Slack app requirements:

- Socket Mode enabled for local Pi usage
- App Home → Messages Tab enabled so users can DM the app
- `message.im` event for App Home DMs
- interactivity enabled and the `/relay` slash command installed for native slash-command discovery
- bot scopes including `chat:write`, `im:history`, `im:read`, `reactions:write`, and `files:write` for image/file delivery
- reinstall the app after scope, slash-command, interactivity, or App Home changes

The `/relay <command>` native slash command is a discoverability layer and is requester-scoped when Slack provides a response URL. Plain `relay <command>` text remains the reliable fallback when the slash command has not been installed, synced, or delivered. Older Slack `pirelay <command>` examples are no longer accepted; use `relay <command>` for a single Discord/Slack text prefix.

Slack channel/thread control is explicit:

```bash
export PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES=true
```

Then invite the app to the channel and pair in that channel/thread with `relay pair <pin>`.

## Local Pi commands

| Command | Purpose |
|---|---|
| `/relay setup <telegram\|discord\|slack>` | open setup wizard or show headless setup guidance |
| `/relay connect <telegram\|discord\|slack> [name]` | create an expiring pairing flow for the current session |
| `/relay doctor` | diagnose configured relay channels, credentials, allow-lists, and config/state permissions |
| `/relay status` | show local relay status for the current session |
| `/relay send-file <telegram\|discord\|slack\|messenger:instance\|all> <relative-path> [caption]` | send an explicit safe workspace file/artifact to paired messenger chat(s) |
| `/relay trusted` | list locally trusted relay users |
| `/relay untrust <messenger> <userId>` | revoke local relay trust |
| `/relay disconnect` | locally disconnect the current Pi session from all paired messenger bindings |

## Remote messenger commands

| Purpose | Telegram | Discord/Slack text | Native slash (best-effort) |
|---|---|---|---|
| help | `/help` (also Telegram menu) | `relay help` | `/relay help` |
| status dashboard | `/status` | `relay status` | `/relay status` |
| list sessions | `/sessions` | `relay sessions` | `/relay sessions` |
| select session | `/use <session>` | `relay use <session>` | `/relay use <session>` |
| forget offline session | `/forget <session>` | `relay forget <session>` | `/relay forget <session>` |
| one-shot prompt | `/to <session> <prompt>` | `relay to <session> <prompt>` | `/relay to <session> <prompt>` |
| progress mode | `/progress <mode>` | `relay progress <mode>` | `/relay progress <mode>` |
| current progress mode | `/progress` | `relay progress` | `/relay progress` |
| alias current session | `/alias <name\|clear>` | `relay alias <name\|clear>` | `/relay alias <name\|clear>` |
| recent activity | `/recent` or `/activity` | `relay recent` or `relay activity` | `/relay recent` or `/relay activity` |
| latest summary | `/summary` | `relay summary` | `/relay summary` |
| full output | `/full` | `relay full` | `/relay full` |
| latest images | `/images` | `relay images` | `/relay images` |
| send workspace image | `/send-image <path>` | `relay send-image <path>` | `/relay send-image <path>` |
| send safe workspace file to requester | `/send-file <path> [caption]` | `relay send-file <path> [caption]` | `/relay send-file <path> [caption]` |
| steer active run | `/steer <text>` | `relay steer <text>` | `/relay steer <text>` |
| queue follow-up | `/followup <text>` | `relay followup <text>` | `/relay followup <text>` |
| abort current run | `/abort` | `relay abort` | `/relay abort` |
| compact context | `/compact` | `relay compact` | `/relay compact` |
| pause delivery | `/pause` | `relay pause` | `/relay pause` |
| resume delivery | `/resume` | `relay resume` | `/relay resume` |
| disconnect binding | `/disconnect` | `relay disconnect` | `/relay disconnect` |
| create delegation task (opt-in shared rooms) | `/delegate <machine\|#capability> <goal>` | `relay delegate <machine\|#capability> <goal>` | `/relay delegate <machine\|#capability> <goal>` |
| control delegation task | `/task <claim\|decline\|cancel\|status\|history> [task-id]` | `relay task <claim\|decline\|cancel\|status\|history> [task-id]` | `/relay task <claim\|decline\|cancel\|status\|history> [task-id]` |

`quiet`, `normal`, `verbose`, and `completion-only` are valid progress modes. In quiet mode PiRelay keeps terminal notifications concise and offers `/full`/download actions for the full answer. In normal, verbose, and completion-only modes it sends the full final answer, splitting by paragraphs within platform limits and falling back to a Markdown document when an adapter supports files and the output is too large for a reasonable chat burst.

Remote `/disconnect` is scoped to the requesting chat/conversation only: it revokes that Telegram, Discord, or Slack binding and suppresses future session output/buttons there, without disconnecting other messengers that remain paired to the same Pi session. Local `/relay disconnect` is broader and disconnects the current session from all paired messenger bindings.

Remote `send-file` is requester-scoped: an authorized Telegram/Discord/Slack user may request a workspace-relative, validated path and PiRelay uploads it only back to that same conversation/thread. Targeted fan-out remains local-only via `/relay send-file <messenger|messenger:instance|all> <relative-path> [caption]`; remote forms must not include messenger targets such as `all` or `slack`.

Agent delegation is disabled by default and only applies in explicitly enabled shared rooms. Delegation task cards are visible room messages; bot-authored ordinary output remains inert, peer-bot trust is configured separately from human allow-lists, and claimed work is injected as a bounded delegated-task prompt with completion/failure reported back to the room.

## Prompt routing behavior

### When Pi is idle

A normal authorized message is delivered as a standard Pi prompt. For Slack channel/thread bindings, the sender must be the paired user, the current active selection, or must explicitly address the local machine bot depending on shared-room mode.

Expected feedback:

- Telegram: bot chat action such as `typing...`
- Discord: typing activity where supported
- Slack: `:thinking_face:` reaction, or ephemeral fallback if reactions are unavailable

### When Pi is busy

Prompts use the configured busy delivery mode. Default is `followUp`.

Explicit controls:

- Telegram: `/steer <text>` or `/followup <text>`
- Discord: `relay steer <text>` or `relay followup <text>`
- Slack: `relay steer <text>` or `relay followup <text>`

## Guided answer flow

PiRelay supports structured answering when the latest completed assistant output contains a reliable choice set or question set.

Examples:

```text
Choose:
1. sync specs now
2. archive without syncing
```

Telegram can show inline options where available. All messengers can use short unambiguous replies or `answer` where supported by the command parser. Long or ambiguous messages are treated as normal prompts unless PiRelay can safely identify them as answers.

Use `cancel` to leave an active answer flow.

## Multi-session behavior

PiRelay can track multiple live Pi sessions through a local broker. Pair sessions with labels when useful:

```text
/relay connect telegram docs
/relay connect discord api
/relay connect slack release
```

Use `/sessions` in Telegram or `relay sessions` in Discord/Slack to list targets. Use `/use` or `relay use` to select an active target. Use `/to` or `relay to` for one-shot prompts without switching sessions.

If the same bot/app is configured on multiple machines, use one ingress owner plus broker federation so other machines register routes instead of polling the same messenger concurrently.

## Configuration

Canonical config lives at:

```text
~/.pi/agent/pirelay/config.json
```

Example:

```json
{
  "relay": {
    "machineId": "laptop",
    "stateDir": "~/.pi/agent/pirelay",
    "brokerGroup": "personal"
  },
  "defaults": {
    "pairingExpiryMs": 300000,
    "busyDeliveryMode": "followUp"
  },
  "messengers": {
    "telegram": {
      "default": {
        "enabled": true,
        "tokenEnv": "PI_RELAY_TELEGRAM_BOT_TOKEN"
      }
    },
    "discord": {
      "default": {
        "enabled": true,
        "tokenEnv": "PI_RELAY_DISCORD_BOT_TOKEN",
        "applicationId": "123456789012345678"
      }
    },
    "slack": {
      "default": {
        "enabled": true,
        "tokenEnv": "PI_RELAY_SLACK_BOT_TOKEN",
        "signingSecretEnv": "PI_RELAY_SLACK_SIGNING_SECRET",
        "appTokenEnv": "PI_RELAY_SLACK_APP_TOKEN",
        "appId": "A0123456789",
        "workspaceId": "T0123456789"
      }
    }
  }
}
```

Recommended permissions:

```bash
chmod 600 ~/.pi/agent/pirelay/config.json
```

Legacy Telegram tunnel config/state under `~/.pi/agent/telegram-tunnel` and `PI_TELEGRAM_TUNNEL_*` env vars are migration fallbacks only. Active non-secret bindings migrate to `telegram:default`; active pairing codes are not copied.

For more detail, see [docs/config.md](docs/config.md).

## Security notes

Please treat PiRelay as a convenience/control channel, not a secret-safe transport.

Important points:

- Telegram Bot API traffic is not end-to-end encrypted
- Discord and Slack app/bot traffic follows their platform security model
- bot tokens and app secrets must stay in env vars or local config, never in session history
- pairing links/PINs are single-use and expire quickly
- allow-lists and local trust should be configured before broad remote control
- Slack/Discord channel control is disabled unless explicitly enabled
- redaction patterns can scrub common secret shapes before remote text/document delivery
- image files can contain visual secrets; PiRelay requires explicit image actions before sending latest image outputs/files remotely

## Troubleshooting

### Setup wizard cannot write config

Use `c` to copy env snippets, export real values in your shell/profile, restart Pi or reload the environment, then run setup again and press `w`. Invalid boolean env values such as `sometimes` are rejected instead of silently skipped.

### Telegram does not respond

- run `/relay setup telegram`
- verify `PI_RELAY_TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN`
- confirm the bot exists and the username resolves in Telegram

### Discord does not receive messages

- run `/relay setup discord`
- verify the bot token and application id
- enable Message Content Intent for DM text prompts
- ensure the bot and user can share a DM path, often by sharing a server

### Slack says sending messages to the app is turned off

- enable App Home → Messages Tab → Allow users to send messages to your app
- add the `message.im` event
- add `im:history`, `im:read`, `reactions:write`, and `files:write` scopes
- reinstall the Slack app after changing settings

### Slack still shows `Pi is working…` instead of a reaction

The Slack bot token likely lacks `reactions:write`/`files:write` or the app was not reinstalled after adding scopes. Add the needed scope, reinstall, then restart/reload PiRelay.

### Pairing expired or points to the wrong session

Run `/relay connect <messenger>` again from the Pi session you want to control. Pairing commands are single-use and scoped to the selected messenger/session.

### `pi --continue` and pairing

If you continue the same Pi session and PiRelay uses the same state directory, you usually do not need to pair again. Run the remote status command to verify. Reconnect only if the session key changed, state was deleted, or the binding was disconnected/revoked.

### You changed code but behavior looks stale

Restart the running Pi session/extension process. If a detached broker is still running, stop it before retesting:

```bash
pkill -f 'extensions/relay/broker/process.js'
```

Then restart Pi or reload the package from the updated checkout.

## Architecture overview

PiRelay consists of:

- a Pi extension at `extensions/relay/`
- a companion skill at `skills/relay/`
- adapter runtimes for Telegram, Discord, and Slack
- a local broker process for multi-session routing
- persisted local state under `~/.pi/agent/pirelay/`

The extension listens to Pi lifecycle events, tracks task state, publishes route updates, and injects authorized messenger input back into the session. Adapter modules own platform-specific I/O while shared core helpers own routing, authorization, formatting, media safety, redaction, progress, and setup metadata.

## Development

```bash
npm install
npm run typecheck
npm test
```

OpenSpec validation for active changes:

```bash
openspec validate <change> --strict
```

Manual smoke-test steps and release notes live in:

- [docs/testing.md](docs/testing.md)
- [docs/releasing.md](docs/releasing.md)

## Current limitations

- native Slack typing bubbles are not available through supported Slack Web API / Socket Mode, so PiRelay uses reactions plus ephemeral fallback
- Slack/Discord file upload delivery is still limited compared with Telegram text/image support
- Telegram group-chat support is not the default runtime mode
- no end-to-end encryption beyond each messenger platform's bot/app transport
- answer workflow depends on conservative structured-output detection
- image prompts require a Pi model that supports image input
- image transfer is bounded by configured size and MIME-type limits
- `/images` only considers captured image outputs and obvious image file paths mentioned in the latest Pi turn

## Related files

- adapter/runtime details: [docs/adapters.md](docs/adapters.md)
- configuration reference: [docs/config.md](docs/config.md)
- manual testing checklist: [docs/testing.md](docs/testing.md)
- Pi skill entrypoint: [skills/relay/SKILL.md](skills/relay/SKILL.md)
