## 1. Context/API Safety Audit

- [x] 1.1 Audit `extensions/relay/runtime/extension-runtime.ts` for callbacks that capture `ctx` or `pi` beyond the immediate command/session event.
- [x] 1.2 Identify all call sites that use `latestContext ?? ctx`, `ctx.ui`, `ctx.abort`, `ctx.compact`, `ctx.sessionManager`, `ctx.model`, `ctx.modelRegistry`, `ctx.cwd`, `pi.sendUserMessage`, `pi.sendMessage`, or `pi.appendEntry` from deferred callbacks.
- [x] 1.3 Audit Telegram, Discord, Slack, and broker client code for direct `route.actions.context` usage in long-lived or remote-triggered paths.
- [x] 1.4 Classify each context/API-dependent call as best-effort local UI/status, required live Pi control, prompt injection, media/file lookup, audit/persistence, or lifecycle bookkeeping.

## 2. Live Context/API Guard

- [x] 2.1 Add a small runtime helper for resolving the current live extension context/API and detecting stale-context or stale-session-bound-API failures.
- [x] 2.2 Add safe wrappers for local notify, status-line update, status refresh, pairing confirmation, lifecycle warning reporting, audit append, binding persistence, and prompt delivery.
- [x] 2.3 Ensure stale-context detection redacts messages and clears or ignores unusable context/API references without exposing secrets.
- [x] 2.4 Ensure live context resolution verifies the current context belongs to the same route/session before context-dependent route controls use it.
- [x] 2.5 Add unit tests for the helper using fake contexts and API objects whose UI/session/API methods throw stale-context shaped errors.

## 3. Route Action Facade

- [x] 3.1 Add narrow lifetime-safe route action helpers for idle state, workspace root, model lookup, prompt injection, audit append, binding persistence, local notification, status refresh, abort, compact, latest images, and image-by-path.
- [x] 3.2 Update `buildRoute` so long-lived route actions resolve live context/API at execution time instead of using captured command/session contexts or captured extension API methods.
- [x] 3.3 Update route action results so required controls fail with safe unavailable/offline outcomes when no matching live context/API exists.
- [x] 3.4 Deprecate or quarantine direct `SessionRouteActions.context` usage, keeping it only for short-term compatibility if full removal is too disruptive.

## 4. Runtime Call-Site Updates

- [x] 4.1 Update `notifyLocal`, `refreshLocalStatus`, pairing confirmation, image lookup, abort, compact, prompt/control paths, audit append, and binding persistence to fail safely when no matching live context/API exists.
- [x] 4.2 Update `publishRouteStateSoon`, `publishRouteState`, and lifecycle notification diagnostic paths to skip or safely record local UI/status updates when context/API state is stale.
- [x] 4.3 Update registered tool and local command helper paths so delayed `relay_send_file` and local file/image helpers do not use stale route context for workspace access.
- [x] 4.4 Ensure best-effort local UI/status failures do not mark Telegram, Discord, or Slack runtime health as unhealthy.

## 5. Adapter and Broker Call-Site Updates

- [x] 5.1 Update Telegram runtime paths that call `route.actions.context` for `isIdle`, `cwd`, UI status, model, and summary behavior to use lifetime-safe route actions.
- [x] 5.2 Update Discord runtime paths that call `route.actions.context` for idle checks, workspace root, status rendering, and prompt/file/media behavior to use lifetime-safe route actions.
- [x] 5.3 Update Slack runtime paths that call `route.actions.context` for idle checks, workspace root, status rendering, and prompt/file/media behavior to use lifetime-safe route actions.
- [x] 5.4 Update `BrokerTunnelRuntime` status serialization, prompt delivery, requester-file delivery, image retrieval, abort, compact, and audit paths to use lifetime-safe route actions and return safe broker errors when unavailable.
- [x] 5.5 Add or update import/usage checks if practical so runtime hot paths do not reintroduce direct raw context usage in adapters or broker code.

## 6. Regression Coverage

- [x] 6.1 Add tests that lifecycle notification failure reporting does not throw when the initiating context or route API is stale.
- [x] 6.2 Add tests that deferred status refresh and route publish error reporting do not call stale contexts.
- [x] 6.3 Add tests that remote abort/compact/prompt actions return safe unavailable/offline responses when no matching live context/API exists.
- [x] 6.4 Add tests that remote file/image delivery refuses workspace access when only a stale route context is available.
- [x] 6.5 Add tests that stale `pi.sendUserMessage`, `pi.sendMessage`, and `pi.appendEntry` failures are contained or converted to safe route-action errors.
- [x] 6.6 Add tests that normal live-context behavior still updates local status, notifications, prompt delivery, audit append, binding persistence, and remote controls as before.

## 7. Validation

- [x] 7.1 Run the project's TypeScript typecheck or equivalent compile validation.
- [x] 7.2 Run the relevant relay runtime/unit tests.
- [x] 7.3 Run the full test suite if practical.
- [x] 7.4 Run `openspec validate fix-stale-extension-context --strict`.
