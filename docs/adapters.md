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
- `/relay` is available as a local command alias for the same setup/connect/disconnect/status workflow

## Future adapters

A new adapter should implement the channel adapter interface, declare capabilities honestly, and avoid duplicating relay semantics. Authorization must happen before media download, transcription, prompt injection, callbacks, or control actions.
