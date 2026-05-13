## Context

PiRelay already maintains a current `SessionRoute`, restores persisted messenger bindings on `session_start`, unregisters routes on `session_shutdown`, and sends terminal turn notifications on `agent_end`. Remote chats can ask for status or learn that a session is offline after attempting to interact, but they do not receive proactive lifecycle messages when the local Pi session exits, restarts, or is intentionally disconnected locally.

The feature crosses extension lifecycle handling, messenger runtimes, persisted binding state, and notification formatting. Delivery must remain best-effort because abrupt process death, network loss, or messenger API failure can prevent an exit notification from being sent.

## Goals / Non-Goals

**Goals:**
- Notify paired Telegram, Discord, and Slack conversations when the local Pi session becomes temporarily offline during normal shutdown.
- Notify paired conversations when a session starts and restores an existing binding after having been offline.
- Notify paired conversations when the local Pi user intentionally disconnects/unpairs the session.
- Keep messages secret-safe, concise, and platform-appropriate.
- Suppress spam through persisted lifecycle notification metadata and rate limits.
- Contain lifecycle notification delivery failures without changing runtime health or blocking shutdown/disconnect.

**Non-Goals:**
- Guaranteed crash/power-loss detection when the Pi process cannot run shutdown handlers.
- Full broker-mediated heartbeat/presence for all failure modes.
- Storing transcripts, hidden prompts, tool details, messenger tokens, or new secrets.
- Changing remote authorization or pairing semantics beyond adding lifecycle notifications.

## Decisions

### Use best-effort extension lifecycle notifications first

Lifecycle messages will be emitted from the existing extension lifecycle edges: restored startup, normal `session_shutdown`, and local `/relay disconnect`. This keeps the first version small and aligned with current architecture.

Alternative considered: broker-mediated presence detection. A broker could detect socket disconnects and notify even if a Pi session crashes while the broker survives. That is more robust, but it introduces ownership, heartbeat, and duplicate-notification questions across local and federated broker topologies. This change will not require broker-mediated presence, though the lifecycle state format should not preclude it later.

### Distinguish offline from disconnected

Shutdown/offline notifications mean the binding remains valid and the session may come back after restart. Local disconnect notifications mean the binding was intentionally revoked and the chat must pair again before controlling the session.

This distinction avoids teaching remote users that every local exit is an unpairing event, and it keeps safety boundaries clear.

### Centralize lifecycle message formatting

A shared formatter will produce messenger-neutral lifecycle text using session label, event kind, and optional command guidance. Adapter-specific code will only deliver the text and apply platform-specific command wording where necessary.

This reduces drift across Telegram, Discord, and Slack, especially for Slack where leading slash commands are not reliable.

### Persist minimal lifecycle notification metadata

The state store will record non-secret lifecycle metadata per channel binding/session, such as last lifecycle state and last notified timestamp. This enables deduplication across quick restarts and prevents repeated startup messages for a session that was already online.

The metadata must not contain bot tokens, pairing codes, prompts, transcripts, hidden tool data, or raw internal status payloads.

### Deliver through existing authorized bindings

Lifecycle notifications will use the same persisted binding records and instance scoping already used by remote routing. Delivery will only target active bindings for the current session and configured messenger instance. Revoked bindings are excluded.

Local disconnect notifications should be sent before revocation where possible so the chat receives the final unpairing message, then the binding is revoked and future events are rejected.

## Risks / Trade-offs

- **Normal shutdown delivery can fail** → Treat notifications as best-effort, use short time-bounded sends when needed, and never block shutdown indefinitely.
- **Startup notifications can become noisy** → Persist lifecycle state and rate-limit repeated messages for the same binding/session/event.
- **Duplicate notifications across multiple runtimes** → Scope delivery by session key, messenger kind, and instance id; only the runtime that owns the active route/binding should deliver for that binding.
- **Lifecycle delivery failures could look like runtime failure** → Log or audit safe diagnostics without setting core runtime health errors for best-effort notification failures.
- **Remote users may confuse offline with unpaired** → Use distinct wording for temporary offline vs local disconnect/revoke.
- **Slack command guidance could use slash forms accidentally** → Lifecycle formatter/adapters must use Slack-safe `pirelay <command>` wording when command guidance is included.

## Migration Plan

Existing state files will load without lifecycle metadata and default to `unknown` lifecycle state. The first startup after upgrade should not spam every existing binding unless the prior state indicates the session was offline; implementation may initialize state silently on first observation.

Rollback is safe because older versions will ignore unknown persisted lifecycle metadata if it is added in a backward-compatible state shape.

## Open Questions

- Should startup notifications be sent after every previous normal shutdown, or only after the session was offline longer than a threshold?
- Should lifecycle notifications be configurable per binding through existing notification/progress preferences, or always sent because they communicate availability/security state?
- Should future broker-mediated presence be a separate change once best-effort lifecycle notifications prove useful?
