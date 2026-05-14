## 1. Revocation Authority Helpers

- [x] 1.1 Add shared active-binding lookup helpers that return active Telegram and channel bindings only when persisted state is non-revoked and matches the expected session, conversation, user, channel, and instance.
- [x] 1.2 Add helper tests for active, revoked, missing, paused, wrong-conversation, wrong-user, wrong-instance, and wrong-session binding records.
- [x] 1.3 Update local status derivation to prefer persisted active-binding helpers over stale in-memory binding data where practical.

## 2. Remote Disconnect State Cleanup

- [x] 2.1 Harden Telegram in-process `/disconnect` to clear route binding, active selection, activity/progress state, guided-answer state, shared-room destination, and callback/action state for the revoked chat.
- [x] 2.2 Harden Telegram broker `/disconnect` with equivalent state cleanup and persisted revocation handling.
- [x] 2.3 Verify Discord remote disconnect clears recent binding cache, active selection, activity state, and any protected action state for the revoked conversation.
- [x] 2.4 Verify Slack remote disconnect clears owned/recent binding caches, active selection, reaction/progress state, and thread-scoped action state for the revoked conversation.

## 3. Broker Registration and Resync Guards

- [x] 3.1 Update broker `registerRoute` to strip or ignore stale Telegram binding data when persisted state marks the session binding revoked.
- [x] 3.2 Update broker route resync/reconnect handling so stale client route descriptors cannot re-upsert revoked bindings as active.
- [x] 3.3 Update client-side route publication if needed so it refreshes current route binding from persisted active state after remote revocation.
- [x] 3.4 Add broker tests for stale route registration after Telegram disconnect and route resync after broker reconnect.

## 4. Outbound Delivery Guards

- [x] 4.1 Guard Telegram `sendToBoundChat`, completion notifications, full-output buttons/downloads, latest-image delivery, progress delivery, and activity timers with persisted active-binding checks.
- [x] 4.2 Guard Telegram callbacks and guided-answer actions so pre-disconnect buttons fail safely after binding revocation.
- [x] 4.3 Guard Discord completion, progress, lifecycle, image/file, and recent-binding fallback delivery against revoked channel bindings.
- [x] 4.4 Guard Slack completion, progress, lifecycle, image/file, reaction, thread, and recent-binding fallback delivery against revoked channel bindings.
- [x] 4.5 Ensure lifecycle notification bookkeeping skips revoked bindings and cannot recreate active pairing state.

## 5. Cross-Messenger Regression Coverage

- [x] 5.1 Add a regression test for Telegram `/disconnect`, then Slack-originated or Slack-kept session completion, proving Telegram receives no completion/output/buttons while Slack still does.
- [x] 5.2 Add a regression test proving `/sessions` from the disconnected Telegram chat still returns safe broker-level no-paired-sessions guidance.
- [x] 5.3 Add a regression test for completion racing with disconnect where persisted revocation is visible before the messenger API send.
- [x] 5.4 Preserve and extend local `/relay disconnect` tests proving local disconnect still revokes all messenger bindings for the session.

## 6. Documentation and Diagnostics

- [x] 6.1 Update README and adapter docs to clarify remote `/disconnect` is requester-conversation scoped while local `/relay disconnect` disconnects the session from all messengers.
- [x] 6.2 Update testing docs with smoke scenarios for remote disconnect followed by output from another messenger.
- [x] 6.3 Add or update safe diagnostics/status wording for stale binding suppression if user-visible diagnostics are introduced.

## 7. Validation

- [x] 7.1 Run targeted revocation, broker, Telegram, Discord, Slack, and local-disconnect tests.
- [x] 7.2 Run `npm run typecheck`.
- [x] 7.3 Run `npm test`.
- [x] 7.4 Run `openspec validate harden-revoked-binding-delivery --strict`.
