## Why

When a local Pi user runs `/new`, PiRelay currently marks the old paired session offline because the session id/file changes, even though the user usually expects relay control to continue for the same workspace. Messenger users also cannot request a new Pi session remotely, which makes long-running remote workflows harder to reset safely.

## What Changes

- Add a canonical remote `/new` command, and equivalent adapter forms, for authorized messenger users to request a new Pi session for the selected live route.
- Add a route-action outcome for new-session requests so adapters report idle, busy, offline, ambiguous, unsupported, cancelled, and success states consistently.
- Handoff eligible messenger bindings and active selections from an old route to the replacement route when a new session is started locally or remotely and strict safety conditions are met.
- Delay or suppress misleading offline lifecycle notifications during a short local `/new` handoff window, replacing them with a clear moved-to-new-session notification when migration succeeds.
- Preserve authorization and stale-action safety: old route actions/buttons become stale, revoked/paused/moved bindings are not used, and no prompt is injected into an offline or wrong session.
- Support Telegram direct and broker paths first, with Slack/Discord command parity and explicit capability fallbacks where session-control context is unavailable.

## Capabilities

### New Capabilities

<!-- None. This change extends existing relay session, command, adapter, and route-action contracts. -->

### Modified Capabilities

- `messenger-relay-sessions`: Remote session renewal and binding handoff semantics for local or remote `/new`.
- `messenger-command-surfaces`: Canonical command metadata and help/menu surfaces include the new-session command where supported.
- `relay-route-action-safety`: Route-action outcomes include safe new-session execution and unavailable/busy/cancelled reporting.
- `relay-channel-adapters`: Live adapters route new-session commands through shared route-action safety and expose explicit capability fallbacks.

## Impact

- Affected runtime code: `extensions/relay/runtime/extension-runtime.ts` for command-capable context capture, new-session route action, handoff state, and lifecycle notification handling.
- Affected broker/adapter code: Telegram direct/broker command routing plus Discord/Slack parity surfaces and fallback messages.
- Affected state code: binding migration helpers, active selection updates, old-binding moved/revoked handling, and stale action checks.
- Affected tests: route-action safety tests, runtime integration tests, broker process tests, Telegram/Slack/Discord command parity tests, and lifecycle notification tests.
- No new runtime dependencies are expected.
