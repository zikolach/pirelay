## Why

Paired chats currently learn that a Pi session went offline only after someone tries to interact with it, and local disconnects are only announced locally. PiRelay should make session presence explicit so remote users understand whether control is temporarily unavailable, restored after restart, or intentionally unpaired.

## What Changes

- Add best-effort messenger notifications when a paired Pi session exits normally, starts again with an existing binding, or is disconnected locally.
- Distinguish temporary offline/startup presence from intentional local unpairing in remote-facing wording.
- Keep lifecycle notifications secret-safe, authorization-safe, and nonfatal when delivery fails.
- Add deduplication/throttling state so routine restarts do not spam paired chats.
- Cover Telegram, Discord, and Slack relay bindings, including multi-instance Discord/Slack routing.

## Capabilities

### New Capabilities
- `relay-lifecycle-notifications`: Remote notifications for PiRelay session startup, shutdown/offline, and local disconnect lifecycle events.

### Modified Capabilities
- `messenger-relay-sessions`: Existing paired-session behavior gains remote lifecycle presence semantics for restored sessions and local disconnects.

## Impact

- Extension lifecycle handling in `extensions/relay/runtime/extension-runtime.ts`.
- Messenger delivery edges in Telegram, Discord, and Slack runtimes/adapters.
- State persistence in `extensions/relay/state/tunnel-store.ts` for lifecycle notification deduplication metadata.
- Shared formatting/domain helpers for lifecycle event messages.
- Tests covering lifecycle delivery, deduplication, failure containment, and channel/instance routing.
