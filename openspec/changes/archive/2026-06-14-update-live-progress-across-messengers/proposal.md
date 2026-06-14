## Why

PiRelay now coalesces live progress and Telegram can edit a single live progress message, but Slack and Discord still receive repeated progress snapshots. This creates inconsistent UX across messengers and leaves the original chat-noise problem only partially solved.

## What Changes

- Extend Slack and Discord live operations to return message references from outbound bot messages and to update bot-owned messages when the platform supports it.
- Implement `sendLiveProgress` / `updateLiveProgress` capability for Slack and Discord channel adapters using Slack `chat.update` and Discord message edit APIs.
- Update Slack and Discord runtimes to keep per-destination live progress references and update one live progress card instead of posting a new progress snapshot for every flush.
- Preserve the same fallback invariant across messengers: try edit-in-place, then send a live/editable progress message, then send a plain snapshot, and swallow final failures because progress is best-effort.
- Keep terminal completion/failure/abort output separate from live progress messages.
- Preserve authorization, binding authority, paused/revoked/moved checks, destination scoping, rate limiting, progress-mode filtering, and secret-safe formatting.

## Capabilities

### New Capabilities

<!-- None. This extends existing relay progress and adapter capabilities. -->

### Modified Capabilities

- `messenger-relay-sessions`: Shared progress delivery semantics require edit/update-in-place where a live messenger platform supports bot-message updates.
- `relay-channel-adapters`: Channel adapter contracts and parity expectations cover optional live progress references and update fallback behavior for Telegram, Slack, Discord, and future adapters.
- `slack-runtime-client`: Slack live operations support bot-message references and `chat.update` for live progress updates.
- `discord-runtime-client`: Discord live operations support bot-message references and bot-message edit for live progress updates.

## Impact

- Affected adapter contracts: Slack and Discord operation interfaces gain optional message-reference return/update operations; existing tests and fakes must be updated.
- Affected runtimes: Slack and Discord progress state stores live message refs and uses edit/update fallback behavior.
- Affected live clients: Slack adds `chat.update`; Discord adds message edit and returns message ids from send.
- Affected tests: shared progress helper tests, Slack runtime/client tests, Discord runtime/client tests, adapter parity tests, and failure-fallback tests.
- No new runtime dependencies are expected.
