# Route action safety implementation inventory

## Task 1.2: Current fallible route action call sites

This inventory captures the high-risk fallible `route.actions.*` and existing narrow-probe call sites present before implementing shared route-action safety helpers. Line numbers are approximate to the implementation baseline on `openspec/relay-route-action-safety`.

### Shared core/status probes

| File | Call site | Current shape | Notes |
| --- | --- | --- | --- |
| `extensions/relay/core/route-actions.ts` | `routeIdleState()` | calls `actions.isIdle()` or deprecated `actions.context.isIdle()` | Converts stale ctx errors to `undefined`; rethrows other failures. |
| `extensions/relay/core/route-actions.ts` | `routeModelState()` | calls `actions.getModel()` then `routeIdleState()` | Independent model/idle probes can disagree during a stale race. |
| `extensions/relay/core/route-actions.ts` | `routeWorkspaceRoot()` | calls `actions.getWorkspaceRoot()` or deprecated `actions.context.cwd` | Converts stale ctx errors to `undefined`; caller owns rendering/rollback. |
| `extensions/relay/core/relay-core.ts` | `statusSnapshotForRoute()` | calls `routeModelState()` and sometimes `routeIdleState()` | Needs coherent probe to preserve unavailable state. |
| `extensions/relay/core/relay-core.ts` | `relayRouteStateForRoute()` | calls `routeModelState()` and sometimes `routeIdleState()` | Needs coherent probe for broker/session listing parity. |

### Telegram runtime

| File | Call site | Area | Current shape |
| --- | --- | --- | --- |
| `extensions/relay/adapters/telegram/runtime.ts` | `routeIdleState()` in route availability/status helpers | status/probe | Used by `isEffectivelyIdle()`/availability helpers. |
| `extensions/relay/adapters/telegram/runtime.ts` | dashboard `abort` | abort/control | Prechecks idle, sets `notification.abortRequested`, calls `actions.abort()`, rolls back only on string-matched unavailable error. |
| `extensions/relay/adapters/telegram/runtime.ts` | dashboard `compact` | compact/control | Calls `actions.compact()` and string-matches unavailable error. |
| `extensions/relay/adapters/telegram/runtime.ts` | `downloadAuthorizedImages()` | media/model | Calls `routeModelState()` before downloading images. |
| `extensions/relay/adapters/telegram/runtime.ts` | `sendPromptSafely()` | prompt | Wraps `actions.sendUserMessage()` and string-matches unavailable error. |
| `extensions/relay/adapters/telegram/runtime.ts` | `deliverAuthorizedPrompt()` | prompt/media | Prechecks route availability, downloads images, starts activity, reserves `remoteRequester`, delegates to `sendPromptSafely()`. |
| `extensions/relay/adapters/telegram/runtime.ts` | `sendFileByPath()` | requester file/workspace | Calls `routeWorkspaceRoot()`, reserves `remoteRequester`, delivers file. |
| `extensions/relay/adapters/telegram/runtime.ts` | `sendImageByPath()` | media/workspace | Calls `actions.getImageByPath()`, renders error string. |
| `extensions/relay/adapters/telegram/runtime.ts` | `sendLatestImages()` | media/cache | Reads `notification.latestImages`, then calls `actions.getLatestImages()`. |
| `extensions/relay/adapters/telegram/runtime.ts` | command `abort` | abort/control | Same precheck/abortRequested/string-match pattern as dashboard. |
| `extensions/relay/adapters/telegram/runtime.ts` | command `compact` | compact/control | Calls `actions.compact()` and string-matches unavailable error. |
| `extensions/relay/adapters/telegram/runtime.ts` | `deliverPlainPrompt()` | prompt | Starts activity, reserves `remoteRequester`, delegates to `sendPromptSafely()`. |
| `extensions/relay/adapters/telegram/runtime.ts` | callback/guided answer paths | prompt | Multiple paths start activity and call `sendPromptSafely()` after a local delivery precheck. |

### Discord runtime

| File | Call site | Area | Current shape |
| --- | --- | --- | --- |
| `extensions/relay/adapters/discord/runtime.ts` | route availability/status helpers | status/probe | `discordRouteAvailability()` uses `routeIdleState()`. |
| `extensions/relay/adapters/discord/runtime.ts` | image attachment handling | media/model | Calls `routeModelState()` before accepting image prompt. |
| `extensions/relay/adapters/discord/runtime.ts` | command `abort` | abort/control | Prechecks idle, sets `notification.abortRequested`, stops typing, calls `actions.abort()`, rolls back only on string-matched unavailable error. |
| `extensions/relay/adapters/discord/runtime.ts` | command `compact` | compact/control | Prechecks availability, appends audit before compaction, string-matches unavailable error. |
| `extensions/relay/adapters/discord/runtime.ts` | `sendFileByPath()` | requester file/workspace | Calls `routeWorkspaceRoot()`, reserves `remoteRequester`, delivers file. |
| `extensions/relay/adapters/discord/runtime.ts` | `sendFileToRequester()` | requester file/workspace | Calls `routeWorkspaceRoot()` for assistant-triggered delivery. |
| `extensions/relay/adapters/discord/runtime.ts` | `deliverDiscordPrompt()` | prompt | Prechecks idle, starts typing, reserves `remoteRequester`, calls `actions.sendUserMessage()`, stops typing only in catch. |
| `extensions/relay/adapters/discord/runtime.ts` | `handlePromptCommand()` | prompt/control | Performs an extra idle precheck before delegating to prompt delivery. |
| `extensions/relay/adapters/discord/runtime.ts` | `sendLatestImages()` | media/cache | Calls `actions.getLatestImages()`. |
| `extensions/relay/adapters/discord/runtime.ts` | `sendImageByPath()` | media/workspace | Calls `actions.getImageByPath()`. |

### Slack runtime

| File | Call site | Area | Current shape |
| --- | --- | --- | --- |
| `extensions/relay/adapters/slack/runtime.ts` | route availability/status helpers | status/probe | `slackRouteAvailability()` uses `routeIdleState()`. |
| `extensions/relay/adapters/slack/runtime.ts` | ordinary bound message prompt | prompt | Prechecks idle, starts activity/reaction, reserves `remoteRequester`, calls `actions.sendUserMessage()` with string-matched unavailable handling. |
| `extensions/relay/adapters/slack/runtime.ts` | `pirelay to` prompt | prompt/shared room | Prechecks target route idle, reserves target `remoteRequester`, starts reaction/activity, calls `actions.sendUserMessage()`. |
| `extensions/relay/adapters/slack/runtime.ts` | command `abort` | abort/control | Prechecks availability, calls `actions.abort()`, string-matches unavailable error; currently no already-idle branch. |
| `extensions/relay/adapters/slack/runtime.ts` | command `compact` | compact/control | Prechecks availability, calls `actions.compact()`, string-matches unavailable error. |
| `extensions/relay/adapters/slack/runtime.ts` | `sendFileByPath()` | requester file/workspace | Calls `routeWorkspaceRoot()`, reserves `remoteRequester`, delivers file. |
| `extensions/relay/adapters/slack/runtime.ts` | `sendFileToRequester()` | requester file/workspace | Calls `routeWorkspaceRoot()` for assistant-triggered delivery. |
| `extensions/relay/adapters/slack/runtime.ts` | `sendLatestImages()` | media/cache | Calls `actions.getLatestImages()`. |
| `extensions/relay/adapters/slack/runtime.ts` | `sendImageByPath()` | media/workspace | Calls `actions.getImageByPath()`. |

### Broker runtime

| File | Call site | Area | Current shape |
| --- | --- | --- | --- |
| `extensions/relay/broker/tunnel-runtime.ts` | `statusSnapshotForRoute()` / `relayRouteStateForRoute()` | status/probe | Broker status/session listing delegates to shared snapshot helpers. |
| `extensions/relay/broker/tunnel-runtime.ts` | `deliverPrompt` request | prompt | Prechecks availability, optionally reserves requester, calls `actions.sendUserMessage()`, no typed outcome wrapper. |
| `extensions/relay/broker/tunnel-runtime.ts` | `sendFileToRequester` request | requester file/workspace | Calls `routeWorkspaceRoot()`, reserves requester, delivers file. |
| `extensions/relay/broker/tunnel-runtime.ts` | `getLatestImages` request | media/cache | Calls `actions.getLatestImages()`. |
| `extensions/relay/broker/tunnel-runtime.ts` | `getImageByPath` request | media/workspace | Calls `actions.getImageByPath()`. |
| `extensions/relay/broker/tunnel-runtime.ts` | `abort` request | abort/control | Prechecks idle, sets `notification.abortRequested`, calls `actions.abort()`, rolls back on catch. |
| `extensions/relay/broker/tunnel-runtime.ts` | `compact` request | compact/control | Prechecks availability, calls `actions.compact()`. |

### Extension runtime route action implementations

| File | Call site | Area | Current shape |
| --- | --- | --- | --- |
| `extensions/relay/runtime/extension-runtime.ts` | route `getWorkspaceRoot` | workspace | Resolves workspace via current live route context. |
| `extensions/relay/runtime/extension-runtime.ts` | route `sendUserMessage` | prompt | Clears requester state on unavailable live context or stale send failure; sets `remoteRequesterPendingTurn` on accepted prompt. |
| `extensions/relay/runtime/extension-runtime.ts` | route `getImageByPath` | media/workspace | Returns safe unavailable result when live context is unavailable. |
| `extensions/relay/runtime/extension-runtime.ts` | route `promptLocalConfirmation` | local UI | Returns deny on unavailable/stale context. |
| `extensions/relay/runtime/extension-runtime.ts` | route `abort` | abort/control | Throws unavailable on missing/stale live context. |
| `extensions/relay/runtime/extension-runtime.ts` | route `compact` | compact/control | Rejects unavailable on missing/stale live context. |

### Requester file delivery core

| File | Call site | Area | Current shape |
| --- | --- | --- | --- |
| `extensions/relay/core/requester-file-delivery.ts` | `route.remoteRequester` match | requester ownership | Validates requester identity/session before file delivery; assumes caller supplied safe workspace root. |

## Task 1.3: Call-site classification

### Prompt

- Telegram: `sendPromptSafely()`, `deliverAuthorizedPrompt()`, `deliverPlainPrompt()`, callback answer-option/custom/guided/ambiguity flows, image prompt flows.
- Discord: `deliverDiscordPrompt()`, `handlePromptCommand()`, `handleToCommand()`, ordinary bound messages, image prompt path after model validation.
- Slack: ordinary bound messages, `pirelay to` target prompt, busy follow-up/steer delivery.
- Broker: `deliverPrompt` request handling in `tunnel-runtime.ts`.
- Extension runtime: `SessionRouteActions.sendUserMessage()` implementation; this is the final route action invoked by all prompt helpers.

### Abort

- Telegram: dashboard abort callback and `/abort` command.
- Discord: `/abort` command.
- Slack: `pirelay abort` command.
- Broker: `abort` request handling in `tunnel-runtime.ts`.
- Extension runtime: `SessionRouteActions.abort()` implementation.

### Compact

- Telegram: dashboard compact callback and `/compact` command.
- Discord: `/compact` command.
- Slack: `pirelay compact` command.
- Broker: `compact` request handling in `tunnel-runtime.ts`.
- Extension runtime: `SessionRouteActions.compact()` implementation.

### Media/workspace

- Workspace/file: Telegram `sendFileByPath()`, Discord/Slack `sendFileByPath()` and `sendFileToRequester()`, broker requester-file handling, requester-file-delivery core validation.
- Explicit image: Telegram/Discord/Slack `sendImageByPath()`, broker `getImageByPath` request handling, extension runtime `getImageByPath()`.
- Latest images: Telegram/Discord/Slack `sendLatestImages()`, broker `getLatestImages` request handling, extension runtime `getLatestImages()`.
- Image model capability: Telegram `downloadAuthorizedImages()`, Discord image attachment handling.

### Status/probe

- Core: `routeIdleState()`, `routeModelState()`, `routeWorkspaceRoot()`, `statusSnapshotForRoute()`, `relayRouteStateForRoute()`.
- Adapter status/session lists: Telegram, Discord, and Slack availability helpers plus session list/status render paths.
- Broker status/session lists: broker route status and route state snapshots.

### Audit/persist/local side effect

- `actions.appendAudit()` after accepted prompts, pairings, control requests, file delivery results, pause/resume/disconnect events.
- `actions.persistBinding()` on pairing, pause/resume, and local/remote disconnect state transitions.
- `actions.notifyLocal()`, `actions.setLocalStatus()`, and `actions.refreshLocalStatus()` for local UI/status effects.
- `actions.promptLocalConfirmation()` during Telegram/Discord/Slack/broker pairing approval.

### Safe synchronous usage

- Formatting-only reads from `route.notification`, `route.binding`, `route.session*`, and `route.lastActivityAt` are safe as immutable/route-owned metadata, provided they are not used to prove live Pi availability.
- `route.actions.context` should remain quarantined inside compatibility helpers; adapter/broker long-lived code should not use it directly.

## Task 1.4: Mutable state reserved before fallible route actions

### Requester context and pending-turn state

- Adapters/broker reserve `route.remoteRequester` before prompt injection and requester-scoped file delivery.
- Extension runtime `sendUserMessage()` commits `route.remoteRequesterPendingTurn = true` only after prompt acceptance and clears requester state when live context/send fails unavailable.
- Risk: adapter-level prompt unavailable races can retain a just-reserved `remoteRequester` if the shared operation does not explicitly roll back or delegate to the runtime's existing cleanup.

### Activity, typing, and thinking indicators

- Telegram starts an activity indicator before prompt delivery in `deliverAuthorizedPrompt()`, `deliverPlainPrompt()`, answer callbacks, and guided answer flows.
- Discord starts/stops typing activity around `deliverDiscordPrompt()` and stops typing before abort.
- Slack starts best-effort activity or thinking reactions for ordinary prompts and `pirelay to`; reactions are explicitly stopped only in selected unavailable catch paths.
- Risk: unavailable after indicator start can leave refresh timers/reactions active unless rollback hooks are registered and invoked for every prompt outcome.

### Shared-room and output destinations

- Telegram stores shared-room output destinations for group `/to@bot` style interactions and clears them on disconnect/session cleanup.
- Slack/Discord active selections and shared-room routing metadata can select a session/conversation before prompt delivery.
- Risk: one-shot shared-room output state should commit only after prompt acceptance and roll back if route delivery becomes unavailable.

### Abort flags

- Telegram dashboard and command abort paths set `route.notification.abortRequested = true` before calling `actions.abort()` and clear it on caught unavailable failures.
- Discord command abort sets `route.notification.abortRequested = true`, stops typing, calls `actions.abort()`, and clears on caught unavailable failures.
- Broker abort sets `route.notification.abortRequested = true` before `actions.abort()` and clears on catch.
- Slack currently calls `actions.abort()` after availability precheck without setting `abortRequested` in the adapter path.
- Risk: abort helpers must centralize already-idle detection and clear `abortRequested` on all unavailable/non-success outcomes.

### Adapter health and diagnostics

- Discord prompt delivery sets `lastError` for non-unavailable send failures and store update failures.
- Slack/Telegram mostly surface or rethrow non-unavailable failures; platform transport failures should remain platform diagnostics.
- Risk: route-unavailable outcomes must not be written as messenger runtime health failures, while non-unavailable platform/programmer failures must remain distinct.

### Media/cache state

- Latest image actions read `route.notification.latestImages` and `actions.getLatestImages()`; explicit image/file operations rely on route workspace availability.
- Runtime route replacement and stale context invalidation should prevent previous-session image candidates/workspace roots from being reused.
- Risk: workspace/media helpers must fail closed and must not fall back to another route, stale workspace root, or another requester.

## Task 6.2: Media cache route/session scoping

- `extension-runtime.ts` stores latest image content and file candidates in the active extension-runtime closure, not in global adapter state.
- `syncRoute()` calls `clearTurnImageCaches()` when `currentRoute.sessionKey` changes, so a replacement route starts with empty latest-turn media caches.
- `agent_start` also calls `clearTurnImageCaches()` and clears `currentRoute.notification.latestImages`, so a new turn cannot inherit previous-turn media candidates.
- `getLatestImagesForTelegram(route)` first resolves `liveContextForRoute(route)` and returns no images when the requested route is stale/unavailable, preventing old route cache reads after a route switch.
- New shared media helpers add an availability/workspace probe before adapters/broker render media or requester-file operations.

## Task 7.2: Remaining direct route action usage review

Remaining direct `route.actions.*` calls after migration fall into these reviewed categories:

- Shared safety core wrappers in `extensions/relay/core/route-actions.ts`: direct calls to `isIdle`, `getModel`, `getWorkspaceRoot`, `sendUserMessage`, `abort`, `compact`, `getLatestImages`, and `getImageByPath` are intentionally quarantined behind typed outcome helpers.
- Pairing approval: `promptLocalConfirmation()` remains direct in Telegram, Discord, Slack, and broker pairing paths because it is authorization/pairing UI, not a post-authorization route action; the stale-context implementation returns `deny` safely when unavailable.
- Audit/local diagnostics: `appendAudit()`, `notifyLocal()`, `setLocalStatus()`, and `refreshLocalStatus()` remain best-effort side effects whose route implementations already suppress stale local context/API failures.
- Binding persistence: `persistBinding()` remains direct for pairing/pause/resume/disconnect state transitions; this belongs to binding authority and existing stale-context persistence guards, not route-action execution rollback.
- Summary formatting: Telegram `summarizeText()` remains a notification-output helper invoked after completed output, not a prompt/control/media route mutation; failures continue through existing notification error handling.

No adapter or broker path now calls deprecated `route.actions.context` directly; only shared compatibility helpers read it as a fallback.

### Audit and persistence timing

- Prompt audit entries should occur after prompt acceptance, not after unavailable outcomes.
- Compact audit is currently appended before `actions.compact()` in Telegram/Discord command paths; migration should move audit or mark it as attempted only when that wording remains intentional.
- File delivery audit happens after the delivery result and is safe if the operation outcome is explicit.
- Pairing/pause/resume/disconnect persistence is outside route-action safety unless it calls stale local UI/API helpers; binding authority remains a separate OpenSpec change.

## Task 4.7: Prompt rollback test coverage

- Shared helper coverage in `tests/relay/route-actions.test.ts` verifies requester/pending-turn rollback, start/rollback hook invocation, accepted prompt commit hooks, and busy delivery metadata.
- Telegram coverage in `tests/runtime.test.ts` verifies unavailable private prompt delivery, activity cleanup, shared-room output destination rollback, and requester state cleanup through the migrated helper.
- Discord coverage in `tests/discord-runtime.test.ts` verifies unavailable prompt delivery returns safe guidance without marking runtime health unhealthy.
- Slack coverage in `tests/slack-runtime.test.ts` verifies thinking/activity cleanup behavior and keeps best-effort activity failures out of runtime health; migrated prompt paths now share the same core rollback hook contract.
