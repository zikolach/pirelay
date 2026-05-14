## Context

PiRelay now supports multiple messenger bindings for a single Pi session. That makes disconnect semantics more subtle:

```text
Telegram /disconnect
  -> revoke Telegram chat binding only
  -> Slack/Discord bindings for the same Pi session may remain active
  -> the Telegram chat may still ask broker-level questions like /sessions
  -> the Telegram chat must not receive session output until re-paired
```

The current code has several places where old route state can outlive a remote disconnect:

- in-process Telegram runtime keeps `route.binding` in memory until it is cleared;
- the broker process stores route descriptors and can upsert a binding again during `registerRoute`;
- `sendSessionNotification`, `sendToBoundChat`, completion delivery, progress delivery, and callback/action handlers can use a route binding or recent cached binding instead of treating persisted revocation as authoritative;
- Slack/Discord completion fan-out can keep a session active after Telegram disconnects, making stale Telegram delivery visible.

The core bug class is stale authority: an in-memory binding can retain send authority after persisted state says the binding was revoked.

## Goals / Non-Goals

**Goals:**

- Make remote `/disconnect` revoke only the requesting messenger conversation binding.
- Ensure a disconnected messenger conversation receives no more progress, completion, full-output buttons, latest output, image/file delivery, lifecycle notifications, or callback/action effects for that session until re-paired.
- Keep other messenger bindings for the same session active and able to receive their own outputs.
- Keep broker-level commands available after disconnect; `/sessions` can still say no sessions are paired.
- Prevent stale route registration, route resync, and recent-binding caches from reactivating revoked bindings.
- Add regression tests covering Telegram disconnect followed by Slack-originated or other non-Telegram session completion.

**Non-Goals:**

- Adding `/disconnect-all`, `/disconnect-session`, or cross-messenger identity-wide disconnect commands.
- Changing local `/relay disconnect` semantics; it can remain the local all-binding session disconnect path.
- Changing pairing trust, allow-list, or authorization policy beyond enforcing revocation.
- Migrating state schema or deleting historical revoked records.
- Preventing explicitly re-pairing the same chat with a fresh pairing flow.

## Decisions

### Treat persisted revocation as authoritative

Every path that wants to send through a messenger binding should confirm that the binding is still active in `TunnelStateStore` or equivalent broker state immediately before sending. In-memory route objects and recent-binding maps are caches only; they must not override a persisted `status: "revoked"` record.

Alternative considered: rely on clearing `route.binding` at disconnect time. That is necessary but insufficient because route descriptors can be re-registered from old clients, broker sockets can resync, and completion delivery may race with disconnect.

### Make remote disconnect conversation-scoped

Remote `/disconnect` should revoke the binding for the requesting adapter instance, conversation, user, and session. It should not revoke Slack/Discord/Telegram bindings for other conversations on the same session.

Local `/relay disconnect` remains stronger because local Pi users have filesystem/session authority and already expect it to unpair the current session from all messengers.

Alternative considered: make remote Telegram `/disconnect` behave like local `/relay disconnect`. The user clarified the desired behavior is only disconnecting that chat.

### Add an active-binding guard before outbound delivery

Introduce or centralize helper checks such as:

```ts
getActiveTelegramBindingForRoute(sessionKey, chatId, userId)
getActiveChannelBindingForRoute(channel, instanceId, sessionKey, conversationId, userId)
```

The helper should return `undefined` when the persisted binding is missing, revoked, paused for delivery, or does not match the expected conversation. Notification code should skip delivery when the guard fails.

For route registration, if the incoming route contains a binding but persisted state says the same session binding is revoked, the broker should keep the route online without that binding and should not upsert the stale binding.

### Clear local volatile state on revoke

When a remote binding is revoked, clear all volatile state scoped to that binding:

- active session selection for that chat/user;
- activity indicators;
- progress state;
- guided answer state;
- pending ambiguity/custom-answer state;
- shared-room output destination for that session/conversation;
- recent-binding cache entries for the revoked binding.

This is defense in depth; outbound guards remain the authoritative protection.

### Keep broker-level status after disconnect

Authorization for broker-level commands such as `/sessions` may continue to answer based on broker state even when no session binding is active for the chat. This response must not include protected assistant output, route internals, hidden prompts, raw IDs, or callback affordances that mutate a revoked session.

### Revoke-aware callback handling

Buttons and callbacks created before disconnect should fail safely after the binding is revoked. A stale “Show in chat”, “Download .md”, image download, guided-answer, or session action callback must re-check active binding state before returning content or mutating session state.

## Risks / Trade-offs

- **Risk: extra state lookups before sends add overhead.** → Lookups are small local JSON/state reads; correctness matters more than micro-optimization. Cache only active results that are invalidated on revoke.
- **Risk: races between completion and disconnect still send one final message.** → Put guards as close to messenger API calls as practical and clear route/caches immediately on revoke.
- **Risk: route registration silently drops a binding and status looks confusing.** → Refresh local status so it shows ready/unpaired when a binding is revoked while the adapter remains running.
- **Risk: broker and in-process paths diverge.** → Add equivalent tests for broker process behavior and in-process runtime behavior, or extract shared helper logic where practical.
- **Risk: local all-binding disconnect accidentally changes.** → Cover local `/relay disconnect` with existing and new regression tests to preserve all-binding revocation.

## Migration Plan

1. Add revocation-aware active-binding lookup helpers and tests.
2. Update Telegram in-process runtime and broker process to clear binding/caches on remote disconnect and skip stale route binding re-upsert.
3. Update outbound notification/fallback/callback paths to use active-binding guards before sending or serving protected content.
4. Update Discord/Slack recent-binding fallback behavior so revoked channel bindings are not used for completion or file delivery.
5. Add cross-messenger regression tests that reproduce the screenshot scenario.
6. No data migration is required; existing revoked records remain valid. If a binding was accidentally resurrected previously, the user can disconnect once after the fix or re-pair as needed.

## Open Questions

- Should local UI surface a warning when a stale route registration tries to reintroduce a revoked binding?
- Should `/sessions` after disconnect show only “no paired sessions” or also offer concise re-pair guidance with `/relay connect <messenger>`?
- Should remote `/disconnect` also delete stored lifecycle notification metadata for that conversation, or is skipping revoked bindings enough?
