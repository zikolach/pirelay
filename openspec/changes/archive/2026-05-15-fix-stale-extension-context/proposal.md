## Why

PiRelay currently can use captured Pi extension command/session objects after Pi has replaced or reloaded that session-bound context. In worker-style `pi --print` sessions this has caused otherwise successful work to exit non-zero with `This extension ctx is stale after session replacement or reload`, making downstream automation misclassify successful turns as failures.

## What Changes

- Prevent PiRelay runtime actions from calling `ctx.ui`, `ctx.abort`, `ctx.compact`, `ctx.sessionManager`, `ctx.model`, `ctx.modelRegistry`, `ctx.cwd`, `pi.sendUserMessage`, `pi.sendMessage`, `pi.appendEntry`, or other session-bound APIs after the owning context/API object is stale.
- Centralize access to the current live extension context and session-bound Pi operations instead of closing over command/session contexts or the extension API in long-lived route actions, lifecycle notifications, timers, broker callbacks, or async messenger callbacks.
- Quarantine or replace direct `route.actions.context` usage in adapters and broker code with narrow route action helpers such as `isIdle`, `workspaceRoot`, `getModel`, `sendUserMessage`, `appendAudit`, `abort`, and `compact` that resolve live context/API state at execution time.
- Make best-effort local UI/status/lifecycle diagnostic updates skip or degrade safely when no live context is available, while required Pi controls fail explicitly with safe unavailable/offline responses.
- Add regression coverage for stale-context and stale-API conditions around lifecycle notification failure reporting, route action callbacks, deferred status refreshes, adapter/broker remote controls, and local prompt/file/image paths.
- Preserve existing relay behavior for active live contexts and do not change messenger authorization, pairing, or binding semantics.

## Capabilities

### New Capabilities
- `relay-context-lifetime-safety`: Safe handling of Pi extension contexts and session-bound extension API operations across session replacement, reload, delayed callbacks, and best-effort UI/status updates.

### Modified Capabilities
- `relay-lifecycle-notifications`: Lifecycle notification failures must not call stale local UI contexts or crash the Pi worker/session.
- `relay-runtime-status-line`: Status refresh and status-line error reporting must be skipped or redirected safely when the previously captured context is stale.

## Impact

- Affects `extensions/relay/runtime/extension-runtime.ts`, especially route construction, `latestContext` handling, lifecycle notification reporting, deferred status refreshes, route action callbacks, and registered tool/local command helpers.
- Affects adapter and broker call sites that currently read `route.actions.context` directly for `isIdle()`, `cwd`, model, UI/status, or other context-dependent behavior.
- May introduce a small context-handle/helper module or route action facade that validates or resolves the latest live context/session-bound API before each context-dependent operation.
- Adds tests around stale context/API simulation and nonfatal behavior for delayed callbacks and remote controls.
- Reduces false worker failures in integrations that spawn PiRelay-enabled `pi --print` subprocesses.
