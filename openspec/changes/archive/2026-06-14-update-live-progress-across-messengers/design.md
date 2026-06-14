## Context

The live-progress coalescing work introduced a shared progress model and Telegram edit-in-place delivery. Telegram direct and broker runtimes now maintain a live message reference and update it when possible, while Slack and Discord still send a new coalesced snapshot for each eligible progress flush. This means the user experience remains inconsistent: Telegram can show one evolving progress card, but Slack and Discord can still accumulate progress messages.

Slack and Discord both support updating bot-owned messages, but PiRelay's current operation contracts do not expose the required message references. Slack `postMessage` returns `ts` and `chat.update` can update the message. Discord message create returns an `id`, and the bot can edit its own channel message with that id.

## Goals / Non-Goals

**Goals:**

- Provide edit/update-in-place live progress for Slack and Discord where platform APIs support it.
- Keep progress delivery semantics consistent across Telegram, Slack, Discord, and broker paths.
- Use a single clear fallback invariant: update existing live progress, send a live/editable progress message, send a plain snapshot, then swallow final failure.
- Preserve per-binding progress mode filtering, coalescing, rate limiting, destination scoping, and binding authority checks.
- Keep final assistant output separate from live progress updates.
- Add parity tests for update success, update failure fallback, live-send failure fallback, unsupported update fallback, and filtered-empty cleanup.

**Non-Goals:**

- Do not merge live progress into terminal completion/failure/abort messages.
- Do not add progress updates for `quiet` or ordinary tool progress for `completion-only`.
- Do not require every future adapter to support editing; unsupported adapters must keep safe snapshot fallback.
- Do not persist live progress message references in tunnel state.
- Do not add external dependencies.

## Decisions

### 1. Treat live-progress editing as an optional channel capability

Slack and Discord should implement the existing optional `ChannelAdapter.sendLiveProgress()` and `ChannelAdapter.updateLiveProgress()` capability, returning a `ChannelLiveProgressRef` when a live message reference is available. Unsupported adapters continue to use plain `sendText()` snapshots.

Rationale: the channel adapter contract already models optional live progress editing. Reusing it avoids creating messenger-specific runtime APIs for every platform.

Alternative considered: copy Telegram runtime-specific methods into Slack and Discord runtimes. Rejected because that spreads the same fallback state machine across more places.

### 2. Extend platform operations to return message references

Slack `postMessage` should return a small result containing `ts` when available. Discord `sendMessage` should return a small result containing the created message `id` when available. Live operations add update/edit methods:

- Slack: `updateMessage({ channel, ts, text, blocks? })`
- Discord: `editMessage({ channelId, messageId, content, components? })`

Rationale: runtimes cannot update a message unless the adapter returns a platform reference from the original send.

Alternative considered: parse references from inbound events or store synthetic references only in tests. Rejected because live outbound messages need real platform refs.

### 3. Use a shared TypeScript helper for live progress delivery when practical

Introduce a pure or near-pure helper for TypeScript runtimes that owns the fallback ladder:

```text
if text is unchanged: return
if ref exists: try update; on failure clear ref
try sendLive; on success store ref and text
try sendPlain; on success store text without ref
if all fail: clear ref and return
```

Broker can keep a small JavaScript mirror or call a JS-compatible helper if practical.

Rationale: repeated Copilot feedback showed the fallback state machine is easy to get subtly wrong. Centralizing it reduces drift.

Alternative considered: leave per-runtime implementations. Rejected as likely to repeat the same bugs across Slack and Discord.

### 4. Keep refs scoped to destination state only

Live progress refs remain in memory in the per-destination progress state. They are cleared on terminal route state, route unregister, binding mismatch, paused/revoked/moved state, filtered-empty pending progress, update failure, and runtime stop.

Rationale: message ids/timestamps are not secrets, but persisting them is unnecessary and can create stale cross-turn behavior.

### 5. Use platform-specific formatting only at the adapter edge

The shared progress formatter produces safe bounded text. Adapters may transform it into Slack blocks or Discord components only when equivalent text remains available as fallback.

Rationale: progress should remain safe and readable across clients and logs.

## Risks / Trade-offs

- **Risk: Slack `chat.update` may fail for deleted/old/non-bot messages** → Clear the ref and fall back to a new live/plain snapshot.
- **Risk: Discord message editing may fail due to permissions or message deletion** → Clear the ref and fall back to a new live/plain snapshot.
- **Risk: Edits may not notify users** → This is intended for progress; terminal completion still sends a separate message.
- **Risk: Operation signature changes ripple through tests/fakes** → Keep return shapes optional and backward-compatible where possible.
- **Risk: Shared helper over-abstracts platform behavior** → Keep helper focused on fallback state only; adapters still own platform API calls and formatting.
- **Risk: Progress card can outlive a turn** → Clear refs on terminal state, unregister, and binding authority changes.

## Migration Plan

- No persisted state migration is required.
- Existing Slack/Discord progress behavior remains safe while live-update support is absent or disabled.
- Rollback is safe: runtimes can fall back to `sendText()` snapshots if update methods are removed or fail.

## Open Questions

- Should Slack progress use plain text only or Block Kit formatting? Initial implementation should prefer plain text to minimize update complexity.
- Should Discord progress include components? Initial implementation should avoid components for progress to simplify edits.
- Should compaction progress edit from started to completed, or remain separate durable messages? Initial behavior should follow the same progress mode and live card policy, with terminal/final output still separate.
