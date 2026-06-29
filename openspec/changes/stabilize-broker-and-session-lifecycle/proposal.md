## Why

PiRelay currently allows stale same-workspace sessions to accumulate in `/sessions`, and concurrent same-machine Pi sessions can compete during broker startup, causing one session to appear online while another paired session appears offline. This makes the intended "one broker per machine" model unclear in code and creates noisy, hard-to-maintain session selection UX.

## What Changes

- Document and enforce the machine-local broker singleton invariant for each broker scope: `{stateDir, bot token hash, brokerNamespace}`.
- Move broker startup ownership/recovery into a clear supervisor-level contract so Pi session runtimes connect as clients instead of independently racing to spawn brokers.
- Introduce workspace-aware stale-session handling so older offline bindings from the same machine/workspace are hidden or marked superseded when a newer live session for that workspace exists.
- Keep historical bindings recoverable through explicit "all sessions"/diagnostic views or direct `/forget`, but stop presenting stale duplicates as primary choices.
- Simplify session-list buttons: remove low-value `Recent` buttons from default rows, replace offline rows with cleanup-oriented actions, and prioritize useful actions for online/current/busy sessions.
- Preserve `/recent`/`/activity` as command-level safe activity inspection, not a default per-session button.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `relay-broker-topology`: Clarify and strengthen singleton broker supervision, startup locking, stale coordination recovery, and client route re-registration semantics.
- `messenger-relay-sessions`: Add workspace-aware stale/superseded session listing behavior and default session-list action semantics.
- `messenger-command-surfaces`: Clarify that `/recent` remains supported while default session-list buttons should prioritize actionable session controls over recent-activity shortcuts.

## Impact

- Affected areas:
  - `extensions/relay/broker/supervisor.ts`
  - `extensions/relay/broker/tunnel-runtime.ts`
  - `extensions/relay/broker/process.js`
  - `extensions/relay/core/session-selection.ts`
  - Telegram/Discord/Slack session-list presenters and button builders
  - persisted relay state handling for bindings, active selections, and stale/superseded metadata
- Tests:
  - broker singleton/supervisor concurrency tests
  - route re-registration/reconnect tests
  - session list filtering and stale duplicate tests
  - Telegram session menu button tests and cross-adapter parity tests
- No new runtime dependencies are expected.
- No breaking command removals: `/recent` remains available; only default button placement changes.
