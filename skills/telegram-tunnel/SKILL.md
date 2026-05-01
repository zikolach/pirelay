---
name: telegram-tunnel
description: Pair the current Pi session with a Telegram private chat for remote prompts, status checks, summaries, and abort/compact controls. Use when the user wants to monitor or steer Pi from Telegram.
license: MIT
---

# Telegram Tunnel

Use the extension command for all runtime actions:

- `/telegram-tunnel setup` validates `TELEGRAM_BOT_TOKEN` and caches the bot username
- `/telegram-tunnel connect [name]` generates the QR code + Telegram deep link for the current session with an optional display label
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
- `/to <session> <prompt>`
- `/summary`
- `/full`
- `/images`
- `/send-image <relative-path>`
- `/steer <text>`
- `/followup <text>`
- `/abort`
- `/compact`
- `/pause`
- `/resume`
- `/disconnect`

Plain text messages are delivered as normal Pi prompts when idle and as follow-up/steer messages when busy. Telegram photos and supported image documents are delivered as image prompts when the current Pi model supports image input; captions become the prompt text. Accepted idle prompts show Telegram's `typing...` activity while Pi works instead of a noisy "Prompt delivered to Pi" acknowledgement; busy follow-up/steer messages keep their queued acknowledgement and continue the activity indicator.

If multiple Pi sessions are paired to the same Telegram chat, use `/sessions` to list numbered sessions with stable visual markers, labels, online/offline state, active marker, and idle/busy state. Multi-session notifications include the same marker + label so source sessions are easier to distinguish. Use `/use <number|label>` to switch the active one, or `/to <session> <prompt>` to send a one-shot prompt without changing the active session. Quote `/to` labels that contain spaces, for example `/to "docs team" run tests`. Pair with `/telegram-tunnel connect docs` or another short label when you want friendlier names; otherwise PiRelay falls back to the Pi session name, project folder name, session file basename, then a short session id.

One bot token has one authoritative local broker. Multiple same-machine Pi sessions can share it, but multiple independent brokers on different machines must not poll the same bot token concurrently; cross-machine hub mode is future work.

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

If the latest completed turn produced image outputs from tools or mentioned a safe workspace image path such as `outputs/result.png`, use `/images` or the inline image button to download those outputs as Telegram documents. Use `/send-image <relative-path>` to explicitly send a validated workspace PNG/JPEG/WebP file. PiRelay does not automatically echo input images back to Telegram or browse arbitrary workspace files.

This helps when the important decision prompt appears near the end of a long assistant response.

## Security reminders

- private chats only
- Telegram Bot API is not end-to-end encrypted
- pairing links are single-use and expire quickly
- only non-secret binding metadata is stored in Pi session history
- images can contain visual secrets; outbound image delivery requires explicit `/images`, button, or `/send-image <relative-path>` action
