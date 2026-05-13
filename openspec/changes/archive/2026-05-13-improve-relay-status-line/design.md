## Context

PiRelay exposes adapter lifecycle through Pi UI status entries such as `telegram: ready`, `discord: ready`, and `slack: ready`. Those labels are currently set when adapter runtime startup succeeds, but pairing/binding state is stored separately in persisted tunnel state. A healthy Slack Socket Mode runtime can therefore show `slack: ready` even when the current Pi session is not paired, is paired only in a channel/thread, or has a paused binding.

The runtime already has the pieces needed to improve this without state migrations: `currentRoute.sessionKey`, adapter runtime status, and `TunnelStateStore` binding lookups. The status line should remain compact because it shares space with other Pi status entries.

## Goals / Non-Goals

**Goals:**

- Make the status line distinguish adapter readiness from current-session pairing/binding state.
- Use consistent terminology across Telegram, Discord, and Slack.
- Show enough binding detail to answer "will messages route to this session?" at a glance: ready, paired, paired DM/channel, paused, or error.
- Update status after connect, pairing completion, disconnect, session route changes, and runtime startup/error transitions.
- Keep the implementation read-only with respect to persisted binding state.

**Non-Goals:**

- Do not change pairing, trust, allow-list, or authorization rules.
- Do not add new persisted state fields.
- Do not make the status line a replacement for `/relay status` or `/relay doctor` diagnostics.
- Do not expose secrets, raw chat ids, bot tokens, or full user identifiers in the status line.

## Decisions

### Compute status labels from runtime and binding state

Status text should be derived from three layers:

1. configuration/runtime state (`off`, `error`, `ready`),
2. current session binding state (`paired`, `paused`, none),
3. messenger-specific conversation kind where already known (`dm`, `channel`, `group`).

This keeps the status line accurate after restarts because persisted bindings can be re-read for the current `sessionKey` rather than relying on transient in-memory flags.

Alternative considered: keep `ready` and add details only to `/relay status`. That does not solve the immediate confusion because the misleading status line remains visible all the time.

### Keep labels compact and non-sensitive

Use short forms such as `slack: ready`, `slack: paired channel`, `slack: paused dm`, and `slack error: ...`. Avoid raw conversation ids or full user ids in the status line. More detail belongs in `/relay status`.

Alternative considered: include user id or channel id in the status line. That can help debugging but consumes space and may leak identifiers in screenshots.

### Update through a shared helper

A shared extension-runtime helper should compute and set messenger status labels when route state changes or adapter runtimes start. Messenger-specific runtimes can continue exposing low-level runtime health through `getStatus()`, while persisted binding checks stay in the extension edge where `currentRoute` is known.

Alternative considered: teach every adapter runtime to own Pi UI status updates. That spreads UI policy across adapters and makes cross-messenger consistency harder.

## Risks / Trade-offs

- **Extra state reads on route updates** → Use targeted current-session binding lookups and avoid polling loops.
- **Status can briefly show `ready` before pairing completion write is visible** → Refresh status after route registration and local pairing notification paths.
- **Conversation kind may be absent for older bindings** → Fall back to `paired` or infer private/channel only when metadata supports it.
- **Text may still be too terse for debugging** → Keep detailed diagnostics in `/relay status` and `/relay doctor`.
