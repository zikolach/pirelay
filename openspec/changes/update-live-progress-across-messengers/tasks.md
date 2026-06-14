## 1. Shared Live Progress Delivery Model

- [ ] 1.1 Add or refine shared live-progress delivery state types for text, live message refs, timers, last-sent timestamps, and pending entries.
- [ ] 1.2 Implement a focused TypeScript helper for the fallback ladder: update existing ref, send live/editable message, send plain snapshot, swallow final failure.
- [ ] 1.3 Ensure the helper clears stale refs on update/live-send failures and does not suppress future eligible progress after fallback.
- [ ] 1.4 Keep terminal completion/failure/abort delivery separate from live progress state and clear live progress refs on terminal/unregister paths.
- [ ] 1.5 Add helper unit tests for unchanged text, update success, update failure, live-send success, live-send failure fallback, plain-send failure, and stale-ref clearing.

## 2. Slack Live Progress Support

- [ ] 2.1 Extend `SlackApiOperations.postMessage` to return an optional Slack message `ts` while keeping existing fake/live callers compatible.
- [ ] 2.2 Add `SlackApiOperations.updateMessage` and implement it in `SlackLiveOperations` using Slack `chat.update`.
- [ ] 2.3 Implement `sendLiveProgress` and `updateLiveProgress` in `SlackChannelAdapter` with safe fallback to text snapshots.
- [ ] 2.4 Update `SlackRuntime` progress state and `flushProgress` to update a live progress card instead of always posting new snapshots.
- [ ] 2.5 Add Slack adapter/runtime/live-client tests for send ref capture, update success, update failure fallback, unsupported update fallback, filtered-empty cleanup, and progress-mode filtering.

## 3. Discord Live Progress Support

- [ ] 3.1 Extend `DiscordApiOperations.sendMessage` to return an optional Discord message id while keeping existing fake/live callers compatible.
- [ ] 3.2 Add `DiscordApiOperations.editMessage` and implement it in `DiscordLiveOperations` using Discord message edit API.
- [ ] 3.3 Implement `sendLiveProgress` and `updateLiveProgress` in `DiscordChannelAdapter` with safe fallback to text snapshots.
- [ ] 3.4 Update `DiscordRuntime` progress state and `flushProgress` to edit a live progress card instead of always posting new snapshots.
- [ ] 3.5 Add Discord adapter/runtime/live-client tests for send ref capture, edit success, edit failure fallback, unsupported edit fallback, filtered-empty cleanup, typing coexistence, and progress-mode filtering.

## 4. Cross-Messenger Parity and Safety

- [ ] 4.1 Verify Telegram direct behavior still passes through the shared fallback invariant or remains behaviorally equivalent with dedicated tests.
- [ ] 4.2 Verify Telegram broker remains behaviorally equivalent, including editable-send failure fallback and edit-path outbox tests.
- [ ] 4.3 Verify Slack, Discord, Telegram direct, and Telegram broker all preserve authorization, paused/revoked/moved binding authority, destination scoping, and stale route checks before sending/updating progress.
- [ ] 4.4 Verify ordinary progress remains suppressed in completion-only and quiet modes, while eligible compaction progress follows the live progress policy.
- [ ] 4.5 Add or update README/help text to explain that supported messengers update a live progress card instead of posting repeated progress messages.

## 5. Validation

- [ ] 5.1 Run `npm run typecheck`.
- [ ] 5.2 Run `npm test`.
- [ ] 5.3 Run `openspec validate update-live-progress-across-messengers --strict`.
