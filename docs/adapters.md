# Channel adapter architecture

PiRelay keeps Telegram compatibility while introducing channel-neutral boundaries for future adapters such as Discord, Slack, Signal, or Matrix.

## Layers

- **Channel adapter**: owns protocol-specific I/O, update parsing, callback encoding, activity indicators, message/document delivery, buttons, and platform limits.
- **Relay core**: owns Pi session routing, authorization, pause/offline/busy behavior, prompt delivery, latest output/image retrieval, and guided answer workflows.
- **Pi session actions**: remain at the edge and perform actual Pi runtime actions such as sending a prompt, aborting, compacting, or loading a workspace image.

## Adapter contract

Adapters declare `ChannelCapabilities` so the relay core can choose safe fallbacks:

- inline buttons and callbacks
- text, document, and image support
- activity indicators
- private/group chat support
- text and file size limits
- accepted image MIME types

Inbound channel events are normalized as messages or actions before relay handling. Outbound responses are normalized as text, document, image, activity, or action-answer payloads before the adapter renders them for the concrete channel.

## Telegram compatibility

Telegram remains the first adapter and keeps existing behavior:

- `/telegram-tunnel` local commands and Telegram slash commands continue to work
- existing config keys, state directory, binding metadata, and pairing flow are unchanged
- `/relay setup telegram`, `/relay connect telegram [name]`, and `/relay doctor` are generic aliases/guidance around the same Telegram authorization and state rules

## Middleware layer

Between adapters and relay core, PiRelay uses an interaction middleware pipeline for reusable channel-neutral behavior. Middleware receives normalized relay events, runs in deterministic phases, and can produce prompts, channel-only responses, internal relay actions, blocked outcomes, or safe errors.

Pipeline phases are:

1. inbound preprocessing, such as media normalization or future speech transcription
2. intent/action resolution, such as commands, guided answers, approval decisions, or repeat/read-last actions
3. delivery hooks, such as prompt shaping, busy-mode selection, or confirmation requirements
4. outbound post-processing, such as redaction, chunking, documents, progress shaping, or future spoken-output rendering

Middleware declares capabilities, ordering constraints, recoverable/fatal failure behavior, and safety classification. Authorization is an explicit pipeline boundary: middleware that downloads media, transcribes audio, extracts documents, invokes callbacks, or injects prompts must not run before the identity and route are authorized.

Example future accessible audio flow:

1. the adapter receives an authorized voice message and exposes it as audio media
2. audio middleware downloads/transcribes it only after authorization
3. the transcript becomes a normal prompt or a guided-answer/action intent
4. outbound middleware can request spoken output only from content classified as safe for speech and after configured redaction
5. sensitive actions use `requires-confirmation` before Pi delivery or control actions

## Discord and Slack foundations

Discord and Slack adapters are DM-first foundations with mockable platform operations. They normalize direct-message text, action callbacks, files/images, identity metadata, and platform limits into the shared channel contract. Discord guild messages and Slack channel events remain rejected by default unless an integration explicitly enables those broader scopes. Slack request signatures are verified before events are accepted.

The local setup wizard exposes these foundations without requiring live platform clients in tests:

- `/relay setup telegram` links to Telegram BotFather docs and reports how to set `TELEGRAM_BOT_TOKEN` (<https://core.telegram.org/bots/features#botfather>).
- `/relay setup discord` links to Discord Developer Portal bot setup docs, reports missing Discord credentials, DM-first/allow-list guidance, and an invite URL when `discord.clientId` or `PI_RELAY_DISCORD_CLIENT_ID` is configured (<https://discord.com/developers/docs/quick-start/getting-started>).
- `/relay setup slack` links to Slack app setup docs, reports missing Slack credentials, workspace/user allow-list guidance, and whether Socket Mode or webhook mode is configured (<https://api.slack.com/apps>).
- `/relay connect discord|slack [name]` creates a time-limited pairing instruction for the current Pi session without persisting token, signing-secret, OAuth, or active pairing-secret values in session history.
- `/relay doctor` validates credential categories, explicit Discord guild ids for guild-channel control, Slack webhook signing-secret requirements, and secret-safe config/state permission warnings.

## Future adapters

A new adapter should implement the channel adapter interface, declare capabilities honestly, and avoid duplicating relay semantics. Authorization must happen before media download, transcription, prompt injection, callbacks, or control actions.
