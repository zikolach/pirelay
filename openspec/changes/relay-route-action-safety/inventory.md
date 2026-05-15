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
