## Why

PiRelay currently maps Pi's live session event stream too directly into messenger chat messages. Streaming assistant updates and overlapping tool lifecycle events can produce duplicated or low-value messages, while Pi's own terminal renders the same events as mutable live state.

Remote users need timely awareness without chat spam. PiRelay should coalesce volatile progress into stable messenger updates, using edit-in-place when a messenger supports it and sending only the final coalesced progress snapshot when it does not.

## What Changes

- Introduce a messenger-neutral live progress delivery model that separates volatile Pi stream state from stable milestone notifications.
- Coalesce repeated or superseded progress updates before messenger delivery.
- Prefer editing a single live progress/status message for messengers that support message updates, starting with Telegram where practical.
- For messengers without edit-in-place support or where updating fails, send only coalesced snapshots at a controlled cadence rather than every raw event.
- Keep terminal completion/failure/abort notifications and full final output delivery as separate messages.
- Preserve compaction start/end notifications in every progress mode except quiet.
- Clarify normal vs verbose progress behavior:
  - normal: stable milestones and coalesced live status only
  - verbose: may include more detailed technical progress, still deduplicated and rate-limited
  - completion-only: final results plus explicitly allowed lifecycle notices such as compaction
  - quiet: suppress progress notifications
- Do not relay hidden thinking, raw transcripts, tool internals, pairing codes, destination identifiers, or secrets.

## Capabilities

### New Capabilities

### Modified Capabilities
- `messenger-relay-sessions`: Progress delivery SHALL coalesce live Pi session state and use edit-in-place or final coalesced snapshots instead of emitting duplicate raw stream-event messages.

## Impact

- Affected runtime code:
  - `extensions/relay/runtime/extension-runtime.ts`
  - `extensions/relay/notifications/progress.ts`
  - Telegram, Discord, Slack direct runtimes
  - Telegram broker progress delivery path
- Affected tests:
  - progress helper tests
  - Telegram runtime/broker progress tests
  - Slack and Discord progress parity tests
  - integration tests for safe assistant/tool progress handling
- No new runtime dependencies are expected.
- State changes, if needed for editable message ids, must be backward-compatible and must not persist sensitive transcript content.
