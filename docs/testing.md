# Manual Testing Checklist

Use this checklist when validating the Telegram tunnel against a real Pi session and a real Telegram client.

## Preconditions

- `TELEGRAM_BOT_TOKEN` or `~/.pi/agent/telegram-tunnel/config.json` is configured
- Pi is running with this package loaded
- no stale broker process is running from an older checkout

Recommended reset before testing:

```bash
pkill -f 'extensions/telegram-tunnel/broker.js' || true
```

Then restart Pi or run `/reload`.

## 1. Pairing and local Pi responsiveness

1. Run `/telegram-tunnel setup`
2. Run `/telegram-tunnel connect`
3. While the QR/link is visible, verify the local Pi session still accepts built-in commands
4. Complete Telegram pairing and local confirmation
5. Immediately submit a normal local Pi prompt
6. Invoke a Pi skill locally, for example `/skill:telegram-tunnel`
7. Verify both the prompt and the skill execute normally

Expected:
- local Pi input remains responsive after connect and after pairing
- local prompts are not blocked by broker sync or guided-answer state

## 2. Telegram typing/activity behavior

1. Send a normal Telegram prompt while Pi is idle
2. Observe whether the Telegram client shows `typing...`
3. Keep Pi busy with a longer-running task and verify `typing...` persists or refreshes
4. Send a guided-answer reply and observe `typing...` again
5. Send a busy-session follow-up and verify the queued text acknowledgement still appears
6. Verify `typing...` stops on completion, failure, abort, disconnect, and pause

Expected:
- accepted remote prompts should attempt to show Telegram-native recipient activity
- if the client never shows `typing...`, document the client/version used and whether fallback text appeared

## 3. Long output and answer workflow

Use a Pi task that ends with structured choices or explicit questions, for example:

```text
Choose:
1. sync — sync specs now, then archive
2. skip — archive without syncing
```

Check:
- the important trailing decision block appears in Telegram even if the full output is long
- recognized choices appear as inline buttons
- tapping a choice button injects that answer into Pi without typing the number
- tapping `Custom answer` prompts for custom text, captures the next non-command message, and `cancel` exits without injection
- replying `1` or `2` works directly when the choice is unambiguous
- explicit phrases such as `option 1`, `choose B`, or `answer 2` work as answers
- a new question/instruction such as `How can we improve this architecture?` is routed as a normal prompt, not as an answer
- short ambiguous answer-like text triggers a prompt-vs-answer confirmation instead of being guessed
- sending `answer` starts guided mode
- sending `cancel` exits guided mode safely
- long completions expose `Show in chat` and `Download .md` buttons
- long structured decision completions show those buttons only on the decision/options message, not both messages
- short completions avoid redundant full-output buttons
- tapping `Show in chat` sends the latest assistant output as chunks
- tapping `Download .md` sends a Markdown file containing the latest assistant output
- Markdown tables in chat are converted to readable aligned code-style blocks
- Markdown tables in the downloaded `.md` remain source-style Markdown, except configured redaction
- fenced code blocks are preserved and not reformatted as tables
- malformed or ambiguous structured output falls back to `/full` or a free-text reply rather than a broken guided flow

## 4. Multi-session and reconnect behavior

1. Pair one Pi session with `/telegram-tunnel connect docs`.
2. Pair a second Pi session to the same Telegram chat with `/telegram-tunnel connect api`.
3. Use `/sessions` and verify the list shows numbers, stable visual markers, aliases/labels, active marker, online/offline state, idle/busy state, model, last activity, and dashboard buttons.
4. Use `/use <number|alias|label>` in Telegram and verify ordinary prompts route to the selected active session.
5. Use `/to <session> <prompt>` and verify the prompt reaches the target session without changing the active session.
6. Pair two sessions with the same label and verify `/use <label>` asks for numeric disambiguation.
7. Disconnect one session locally and verify `/use <number>` reports it as offline while the remaining session still works.
8. Use `/use docs`, then set `/alias phone`, and verify `/sessions` and selectors use the alias while retaining the original label for disambiguation.
9. Use `/progress quiet`, `/progress verbose`, and `/recent` during a run and verify safe progress noise changes without suppressing terminal completion/failure/abort notifications.
10. Reconnect the disconnected session and verify local prompts still work there too.

## 5. Image bridge behavior

1. Switch Pi to a model that supports image input.
2. Send a Telegram photo with a normal caption and verify Pi receives a multimodal prompt.
3. Send a Telegram image document (`png`, `jpg`, or `webp`) with no caption and verify Pi receives the image-inspection fallback prompt.
4. While Pi is busy, send a photo captioned `/steer inspect this screenshot` and verify it queues as steering.
5. Send an unsupported document such as a PDF and verify PiRelay rejects it without injecting a prompt.
6. Switch Pi to a text-only model, send a photo, and verify PiRelay rejects it without injecting the caption as text-only.
7. Run a tool or test fixture that emits an image result, then use `/images` and the inline image button to download the latest image output.
8. Generate or save a workspace image file and have Pi mention its relative path (for example `outputs/example.png`); verify `/images` sends it without needing the agent to re-open/read the file.
9. Use `/send-image outputs/example.png` and verify Telegram receives the validated image document.
10. Try `/send-image ../secret.png`, an absolute path, a hidden path, an oversized image, and a renamed non-image; verify each is rejected with an actionable message.
11. Verify input images are not echoed back by `/images` unless a tool emitted them separately as output.

## 6. Discord and Slack adapter smoke checklist

These adapter foundations are DM-first and use channel-specific credentials/config namespaces. For a live integration or mocked platform client, verify:

1. Discord config uses `discord.botToken` or `PI_RELAY_DISCORD_BOT_TOKEN`; Slack config uses `slack.botToken` plus `slack.signingSecret` or the matching env vars.
2. Discord DM messages normalize to `channel: discord`, private conversations, stable user ids, and supported image attachments.
3. Discord guild-channel messages are rejected unless guild-channel control is explicitly enabled by the integration.
4. Discord long output is chunked to the adapter max, buttons map to components, and latest images/files respect configured size/MIME limits.
5. Slack HTTP/event requests with invalid signature or stale timestamp are rejected before route lookup or prompt injection.
6. Slack DM messages normalize to `channel: slack`, private conversations, workspace/user identity metadata, and supported file/image attachments.
7. Slack public/private channel events are rejected unless channel control is explicitly enabled by the integration.
8. Slack long output is chunked, buttons map to Block Kit button values, and uploads respect configured size/MIME limits.
9. Simultaneous Telegram, Discord, and Slack adapters produce channel-qualified binding keys such as `telegram:<session>`, `discord:<session>`, and `slack:<session>`.
10. Exported/shared session history contains only non-secret binding metadata, never bot tokens, Slack signing secrets, OAuth tokens, or active pairing secrets.

## 7. Regression notes to capture

When a test fails, record:
- Telegram client and platform
- whether the broker had been restarted after code changes
- whether the failure affects only local Pi input, only Telegram behavior, or both
- the exact final assistant output if answer parsing behaved incorrectly
