## Why

A remote Telegram `/disconnect` can report that the chat is disconnected while later completion/output messages still arrive when the same Pi session remains active through another messenger such as Slack. This undermines the trust boundary for revocation: once a messenger chat is told it is unpaired, stale in-memory route state or broker re-registration must not resurrect delivery to that chat.

## What Changes

- Harden remote `/disconnect` semantics so it revokes only the requesting messenger conversation binding, while other messenger bindings for the same Pi session remain active.
- Prevent revoked bindings from being reactivated by stale route registration, broker resync, completion fan-out, progress delivery, lifecycle delivery, or cached recent-binding fallback.
- Re-check persisted binding state before sending outbound progress, completion, full-output buttons, latest-output responses, lifecycle notifications, images, or file deliveries to a messenger conversation.
- Keep broker-level status commands available after disconnect, such as `/sessions` returning that no sessions are paired for the chat.
- Clear in-memory route binding, active selection, activity/progress state, guided-answer state, and callback/action state for the revoked conversation.
- Add regression coverage for Telegram disconnect followed by Slack-originated session output, stale route re-registration after revoke, and pre-disconnect button/callback use after revocation.
- No new remote “disconnect all” command is introduced in this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `messenger-relay-sessions`: Remote disconnect is clarified as requester-conversation scoped, and revoked messenger bindings must receive no further session feedback until a fresh pairing is completed.
- `relay-broker-topology`: Broker route registration, route resync, and outbound fan-out must treat persisted revocation as authoritative over stale in-memory route state.
- `relay-lifecycle-notifications`: Lifecycle notification delivery must skip revoked bindings and must not reinitialize notification state for revoked conversations.

## Impact

- Affected code: Telegram broker process, in-process Telegram runtime, Discord/Slack runtime completion delivery, shared state store binding lookup/update helpers, route registration/resync, notification fan-out, callback/action handling, and local status refresh.
- Tests: add runtime/broker regression tests for remote disconnect, stale route registration, cross-messenger completion fan-out, action/callback refusal after revoke, and broker-level `/sessions` after disconnect.
- State: no schema-breaking migration expected; existing `status: "revoked"` and `revokedAt` metadata remain the source of truth.
- Security: strengthens revocation; no tokens, secrets, hidden prompts, transcripts, or file contents are persisted or exposed.
- Dependencies: no new runtime npm dependencies expected.
