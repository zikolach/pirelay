## Why

PiRelay currently reports adapter process state in the Pi status line with labels such as `telegram: ready` and `slack: ready`, but users reasonably read that as "this session is connected/paired." This causes confusion after restarts or when a bot/socket is healthy but the current Pi session has no active messenger binding.

## What Changes

- Split messenger status-line semantics into runtime readiness and current-session binding state.
- Show distinct status labels for unconfigured/off, runtime error, ready-but-unpaired, paired, paired channel/DM where available, and paused binding states.
- Keep status-line text concise and consistent across Telegram, Discord, and Slack.
- Update `/relay status` or related diagnostics only if needed to keep terminology aligned; no pairing or authorization behavior changes.

## Capabilities

### New Capabilities
- `relay-runtime-status-line`: Defines user-facing status-line semantics for relay adapter readiness and current-session pairing/binding state.

### Modified Capabilities

## Impact

- Affected runtime UI code: `extensions/relay/runtime/extension-runtime.ts` and adapter status helpers as needed.
- Affected persisted-state lookups: read-only binding checks through `TunnelStateStore` for the current route/session.
- Tests: integration/unit coverage for Telegram, Discord, and Slack status labels in configured, ready, paired, channel/DM, paused, and error states where practical.
- No new runtime dependencies expected.
