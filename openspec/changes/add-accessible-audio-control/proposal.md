## Why

PiRelay can become more inclusive by supporting audio-first interaction for visually impaired users and users who cannot conveniently type or read long mobile messages. This is broader than voice-note transcription: it requires voice commands, spoken summaries, accessible rendering, repeat/readback controls, and safe confirmation flows.

## What Changes

- Add an accessible audio control mode that accepts authorized voice/audio input as prompts or relay commands.
- Add speech-to-text integration for voice prompts and command phrases when configured.
- Add text-to-speech output for concise completion summaries, guided answer choices, status, approval prompts, and explicit readback requests.
- Add audio-aware rendering for assistant output containing code, diffs, file paths, tables, logs, and structured choices.
- Add voice-friendly controls such as repeat, read last answer, read choices, choose option, custom answer, status, abort, approve/deny, slower/faster, and text transcript fallback.
- Enforce privacy boundaries: redact before speech, never read hidden prompts/tool internals, require explicit opt-in for spoken full output, and confirm sensitive actions.

## Capabilities

### New Capabilities
- `audio-accessible-relay`: defines audio-first relay interaction, voice command handling, spoken output rendering, and accessibility safety requirements.

### Modified Capabilities

## Impact

- Affected code: future middleware pipeline, channel adapters that can receive/send audio, Telegram voice/audio transport, guided answer workflow, approval gates, output formatting, redaction, config, tests, and documentation.
- This change should build on or align with `add-relay-middleware-architecture` and `add-channel-adapter-architecture` so audio accessibility is reusable across Telegram, Discord, Slack, Signal, local microphone, or future channels.
- The existing `add-mobile-media-inputs` proposal may be refined later to focus on documents/media ingestion while this proposal owns audio-first accessibility behavior.
