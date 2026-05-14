---
name: relay
description: Pair the current Pi session with a messenger private chat for remote prompts, status checks, summaries, and abort/compact controls. Use when the user wants to monitor or steer Pi from Telegram, Discord, Slack, or another configured messenger.
license: MIT
---

# PiRelay

Use the extension command for all runtime actions:

- `/relay setup <messenger>` shows setup guidance and validates configured credentials
- `/relay connect <messenger> [name]` generates a messenger pairing flow for the current session with an optional display label
- `/relay disconnect` revokes the active binding
- `/relay status` shows local relay state
- `/relay setup telegram|discord|slack` shows secret-safe channel setup guidance
- `/relay connect telegram|discord|slack [name]` creates a time-limited pairing instruction for the selected channel
- `/relay doctor` checks channel readiness, credentials, allow-lists, unsafe modes, and config/state permissions

## Setup

1. Configure `TELEGRAM_BOT_TOKEN`
2. Run `/relay setup telegram`
3. Run `/relay connect telegram`
4. Scan the QR code and press **Start** in Telegram
5. Confirm locally if asked

## Telegram-side commands

- `/help`
- `/status`
- `/sessions`
- `/use <session>`
- `/progress <quiet|normal|verbose|completion-only>`
- `/alias <name|clear>`
- `/recent` or `/activity`
- `/forget <session>`
- `/to <session> <prompt>`
- `/summary`
- `/full`
- `/images`
- `/send-image <relative-path>`
- `/send-file <relative-path> [caption]`
- `/steer <text>`
- `/followup <text>`
- `/abort`
- `/compact`
- `/pause`
- `/resume`
- `/disconnect`

Plain text messages are delivered as normal Pi prompts when idle and as follow-up/steer messages when busy. Telegram photos and supported image documents are delivered as image prompts when the current Pi model supports image input; captions become the prompt text. Accepted idle prompts show Telegram's `typing...` activity while Pi works instead of a noisy "Prompt delivered to Pi" acknowledgement; busy follow-up/steer messages keep their queued acknowledgement and continue the activity indicator.

If multiple Pi sessions are paired to the same Telegram chat, use `/sessions` to list numbered sessions with stable visual markers, aliases/labels, online/offline state, active marker, idle/busy state, model, last activity, and quick-action buttons. Multi-session notifications include the same marker + label so source sessions are easier to distinguish. Use `/use <number|alias|label>` to switch the active one, `/forget <number|label>` to remove an offline paired session from the list, or `/to <session> <prompt>` to send a one-shot prompt without changing the active session. Quote `/to` labels that contain spaces, for example `/to "docs team" run tests`. Pair with `/relay connect telegram docs` or run `/use docs` then `/alias phone` when you want friendlier names; otherwise PiRelay falls back to the Pi session name, project folder name, session file basename, then a short session id.

During long-running turns, PiRelay sends safe, rate-limited progress updates by default. Use `/progress quiet` for completion-only style behavior, `/progress verbose` for more frequent safe updates, and `/recent` to retrieve recent safe progress/lifecycle activity on demand.

PiRelay runs one authoritative broker per machine. Multiple same-machine Pi sessions share that broker. If the same bot/account is configured on multiple machines, configure one ingress owner and broker federation so non-owner machines register routes instead of polling the same bot concurrently.

No-federation shared-room mode uses one dedicated bot/app identity per machine. Invite those machine bots into one Telegram group, Discord channel, or Slack channel, then use machine-aware commands such as `/use <machine> <session>` and `/to <machine> <session> <prompt>`. Only the selected or explicitly addressed machine bot should answer; other bots stay silent. Telegram group plain-text prompts require bot privacy mode/permissions that let the bot see ordinary messages, otherwise use mentions or replies.

Configure credentials in namespaced `messengers.<kind>.<instance>` config entries, preferably with `tokenEnv` / `signingSecretEnv`. Use `/relay setup discord` for bot-token/client-id invite guidance, Message Content Intent reminders, and DM troubleshooting. Use `/relay setup slack` for Socket Mode/webhook signing guidance. The setup output links to Telegram BotFather docs (<https://core.telegram.org/bots/features#botfather>), Discord Developer Portal bot docs (<https://discord.com/developers/docs/quick-start/getting-started>), and Slack app setup (<https://api.slack.com/apps>).

## Guided Telegram answer flow

If the latest Pi output contains numbered options or explicit questions, Telegram preserves that trailing decision block and supports a lightweight guided answer flow:

- tap an inline option button when choices are recognized
- tap **Custom answer** and send a free-form answer as the next message
- reply with a short unambiguous option number for direct choice selection
- reply with an explicit phrase such as `option 1`, `choose B`, or `answer 2`
- send `answer` to step through a guided answer flow
- send `cancel` to leave the guided answer flow

Normal prompt-like messages (long text, new questions, Markdown/code, or implementation/exploration instructions) are not treated as guided answers unless the user explicitly entered answer mode or used an explicit answer phrase. If a short reply is ambiguous, PiRelay asks whether to send it as a prompt, answer the previous question, or cancel.

Completion or decision messages also expose full-output buttons when the latest assistant output is longer than the inline preview. If a decision/options message follows a completion summary, only the decision message gets those buttons:

- **Show in chat** sends Telegram-sized chunks
- **Download .md** sends a Markdown attachment

Markdown tables shown in chat are reformatted into mobile-friendly code-style blocks because Telegram does not render Markdown tables. The downloaded `.md` keeps the original Markdown table format aside from configured redaction.

If the latest completed turn produced image outputs from tools or mentioned a safe workspace image path such as `outputs/result.png`, use `/images` or the inline image button to download those outputs as Telegram documents. Use `/send-image <relative-path>` to explicitly send a validated workspace PNG/JPEG/WebP file. For a remote user's natural-language request to receive a safe workspace artifact, use the assistant tool `relay_send_file` with a workspace-relative path and optional caption when it is available; it only delivers to the current authorized requester conversation/thread. PiRelay does not automatically echo input images back to Telegram or browse arbitrary workspace files.

This helps when the important decision prompt appears near the end of a long assistant response.

## Security reminders

- private chats only
- Telegram Bot API is not end-to-end encrypted
- pairing links are single-use and expire quickly
- only non-secret binding metadata is stored in Pi session history
- images can contain visual secrets; outbound image delivery requires explicit `/images`, button, or `/send-image <relative-path>` action
