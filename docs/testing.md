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
- replying `1` or `2` works directly
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

1. Pair one Pi session
2. Pair a second Pi session to the same Telegram chat
3. Use `/sessions` and `/use <session>` in Telegram
4. Disconnect one session locally
5. Verify the remaining session still works
6. Reconnect the disconnected session and verify local prompts still work there too

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

## 6. Regression notes to capture

When a test fails, record:
- Telegram client and platform
- whether the broker had been restarted after code changes
- whether the failure affects only local Pi input, only Telegram behavior, or both
- the exact final assistant output if answer parsing behaved incorrectly
