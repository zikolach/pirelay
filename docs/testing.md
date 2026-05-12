# Manual Testing Checklist

Use this checklist when validating the PiRelay against a real Pi session and a real Telegram client.

## Preconditions

- `TELEGRAM_BOT_TOKEN` or `~/.pi/agent/pirelay/config.json` is configured
- Pi is running with this package loaded
- no stale broker process is running from an older checkout

Recommended reset before testing:

```bash
pkill -f 'extensions/relay/broker/entry.js' || true
```

Then restart Pi or run `/reload`.

## 1. Pairing and local Pi responsiveness

1. Run `/relay setup telegram`
2. Run `/relay connect telegram`
3. While the QR/link is visible, verify the local Pi session still accepts built-in commands
4. Complete Telegram pairing and local confirmation
5. Immediately submit a normal local Pi prompt
6. Invoke a Pi skill locally, for example `/skill:relay`
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

1. Pair one Pi session with `/relay connect telegram docs`.
2. Pair a second Pi session to the same Telegram chat with `/relay connect telegram api`.
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

## 6. Relay setup wizard, Discord, and Slack smoke checklist

These adapter foundations are DM-first and use channel-specific credentials/config namespaces. For a live integration or mocked platform client, verify the checklist below. For the opt-in automated Slack suite, see [Slack live integration suite](./slack-live-integration.md).

1. Run `/relay doctor` with no optional channel config and verify it explains Telegram setup plus Discord/Slack opt-in without printing secrets.
2. Run `/relay setup telegram` and `/relay setup telegram`; both should validate the same Telegram token path.
3. Run `/relay connect telegram smoke` and `/relay connect telegram smoke`; both should create the same Telegram pairing style for the current session.
4. Run `/relay setup matrix` and `/relay connect matrix`; both should list supported channels and should not create pairing state.
5. Discord config uses `discord.botToken` or `PI_RELAY_DISCORD_BOT_TOKEN`; Slack config uses `slack.botToken`, `slack.signingSecret`, and for Socket Mode `slack.appToken`/`slack.appTokenEnv` or the matching env vars. `slack.appId`/`PI_RELAY_SLACK_APP_ID` enables App Home QR/open links, and `slack.botUserId` is a non-secret fallback when auth discovery is unavailable.
6. Run `/relay setup discord` with `discord.applicationId`/`PI_RELAY_DISCORD_APPLICATION_ID` (`clientId` aliases are accepted) and verify the interactive setup wizard uses tab-like navigation with diagnostics, env snippet, config snippet, links, and troubleshooting content separated; it includes a Discord invite URL/QR-ready link, Message Content Intent guidance, DM-first guidance, allow-list recommendations, placeholder snippets, and no secret values. Press `c` and verify the env snippet is copied to the clipboard (or falls back to the Pi editor when clipboard tools are unavailable); after exporting required env vars, press `w` and verify config is updated with env var references rather than resolved secrets. In a no-UI/headless run, verify the plain text fallback includes equivalent guidance and does not write config implicitly.
7. In the Discord Developer Portal, ensure the app has a Bot user, enable **Message Content Intent**, copy the bot token/Application ID into PiRelay config, and invite with the `bot` scope plus `permissions=0`. The `applications.commands` scope is optional for a future native `/relay <subcommand>` UX and is not required for reliable `relay <command>` DM text controls.
8. Restart/reload Pi, run `/relay doctor`, and verify Discord shows the bot token configured for live Gateway login without printing the token.
9. Run `/relay connect discord docs`, scan the QR bot profile/DM link when `discord.applicationId` is configured, then DM the bot `relay pair <pin>` before expiry (`/start <pin>` remains a compatibility alias). Confirm the pairing locally in Pi, optionally choosing to trust the Discord user. If the bot cannot be DM'd, check shared-server membership, server member DM privacy settings, and that the bot was already invited with the `bot` scope during setup.
10. After pairing, send `relay status` and `relay sessions` in the Discord DM and verify the same core fields/semantics as Telegram: safe session label, online state, busy state, model, progress mode, last activity, active marker, and no raw session file path or binding storage key. Bare `/status` and `/sessions` may work when Discord delivers them as text, but smoke tests should not depend on those aliases.
11. Send a normal Discord DM prompt while Pi is idle and verify it reaches the current Pi session and the final Pi completion returns to Discord; repeat while busy and verify the configured busy delivery acknowledgement plus terminal completion/failure/abort notification.
12. Exercise Discord command parity using the reliable prefix forms: `relay use`, `relay to`, `relay alias`, `relay progress`, `relay recent`, `relay summary`, `relay full`, `relay images`, `relay send-image`, `relay steer`, `relay followup`, `relay abort`, `relay compact`, `relay pause`, `relay resume`, and `relay disconnect`; verify commands either work with Telegram-equivalent semantics or return an explicit capability/configuration limitation, not generic unsupported-command help.
13. Enable Discord guild-channel control without `allowGuildIds`; verify `/relay doctor` reports an actionable warning/error and `/relay connect discord` refuses pairing until fixed.
14. Run `/relay setup slack` for `eventMode: "socket"` and verify it recommends Socket Mode, requires an app-level token with `connections:write`, exposes a copyable App manifest tab/action, explains App Home Messages Tab plus `message.im`/`im:history`/`im:read` for DMs and `reactions:write` for thinking indicators, and warns when workspace, App ID, or bot-user identity cannot be established; switch to `eventMode: "webhook"` without a signing secret and verify doctor reports the webhook signing requirement.
15. Run `/relay connect slack docs` with enabled mock config and verify the displayed pairing instruction is time-limited, channel-specific, short PIN-style, highlighted in the QR dialog, and copyable with `c`; when `slack.appId` is configured or discovered from `auth.test`, verify the TUI renders a Slack App Home QR/open link and clearly offers both paths: open App Home DM via QR/link or paste the command directly in an invited Slack channel/thread after enabling `slack.allowChannelMessages`.
16. Discord DM messages normalize to `channel: discord`, private conversations, stable user ids, and supported image attachments.
17. Discord guild-channel messages are rejected unless guild-channel control is explicitly enabled by the integration.
18. Discord long output is chunked to the adapter max, buttons map to components, and latest images/files respect configured size/MIME limits.
19. Slack HTTP/event requests with invalid signature or stale timestamp are rejected before route lookup or prompt injection.
20. Slack DM messages normalize to `channel: slack`, private conversations, workspace/user identity metadata, Socket Mode envelope/event ids for dedupe, and supported file/image attachments.
21. Slack public/private channel events are rejected unless channel control is explicitly enabled by the integration.
22. Slack long output is chunked, buttons map to Block Kit button values, and uploads respect configured size/MIME limits.
23. Simultaneous Telegram, Discord, and Slack adapters produce channel-qualified binding keys such as `telegram:<session>`, `discord:<session>`, and `slack:<session>`.
24. Exported/shared session history contains only non-secret binding metadata, never bot tokens, Slack signing secrets, OAuth tokens, or active pairing secrets.

## 7. Optional Telegram two-bot shared-room smoke checklist

Run this only with disposable bots and a disposable test group. Do not paste production tokens, pairing codes, hidden prompts, or transcripts into logs.

Preconditions:
- Two Telegram bot tokens exist for dedicated machine bots.
- BotFather Bot-to-Bot Communication Mode is enabled for both bots.
- Both bots are members of the same group/supergroup.
- Bot privacy mode may stay enabled; addressed-command fallback should still work.

Checklist:
1. Pair one PiRelay instance to bot A and one PiRelay instance to bot B.
2. In the group, send `/sessions@bot_a` and verify only machine A responds.
3. Send `/sessions@bot_b` and verify only machine B responds.
4. Send `/use@bot_a <session>` and then ordinary or addressed text for bot A; verify machine B stays silent.
5. Send a bot-authored message from bot B targeting bot A only if both bots have Bot-to-Bot Communication Mode enabled; verify machine A accepts it only when the sender identity is explicitly authorized/trusted.
6. Send an untargeted bot-authored message and verify both PiRelay instances ignore it.
7. Send a self-authored/local-bot message and verify PiRelay ignores it to prevent feedback loops.
8. Disable Bot-to-Bot Communication Mode for one bot and verify `/command@bot` user fallback still works while bot-authored delivery is unavailable.

## 8. Regression notes to capture

When a test fails, record:
- Telegram client and platform
- whether Bot-to-Bot Communication Mode was enabled for both bots
- whether the broker had been restarted after code changes
- whether the failure affects only local Pi input, only Telegram behavior, or both
- the exact final assistant output if answer parsing behaved incorrectly
