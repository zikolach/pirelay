## 1. Shared File Request Model

- [x] 1.1 Add messenger-neutral requester context types for remote file delivery, including messenger kind, instance id, conversation/thread ids, authorized user id, session key, and safe labels.
- [x] 1.2 Extract a shared requester-scoped file delivery helper that reuses `loadWorkspaceOutboundFile`, adapter limits, normalized document/image payloads, and safe result formatting.
- [x] 1.3 Keep existing local `/relay send-file ...` behavior working by routing it through the shared helper where practical without changing local fan-out semantics.
- [x] 1.4 Add unit tests for requester target resolution, destination rejection, validation result formatting, and no-secret error redaction.

## 2. Remote Requester Context Plumbing

- [x] 2.1 Extend session route actions or route state so authorized remote prompt/command handlers can record current requester context for the selected route/turn.
- [x] 2.2 Populate requester context from Telegram private/group command and prompt handling after authorization and route selection.
- [x] 2.3 Populate requester context from Discord DM/channel command and prompt handling after authorization, active-session selection, and shared-room targeting.
- [x] 2.4 Populate requester context from Slack DM/channel/thread command and prompt handling after authorization, active-session selection, and shared-room targeting.
- [x] 2.5 Add tests proving ambiguous, stale, paused, revoked, offline, and duplicate-ingress contexts fail closed without fallback delivery.

## 3. Explicit Remote Send-File Commands

- [x] 3.1 Add `send-file` / `sendfile` to canonical remote command definitions and help text with requester-scoped usage.
- [x] 3.2 Replace Telegram's remote `send-file` refusal with validated requester-scoped file delivery and safe usage/error messages.
- [x] 3.3 Replace Discord's remote `relay send-file` refusal with validated requester-scoped file delivery and safe usage/error messages.
- [x] 3.4 Replace Slack's remote `pirelay send-file` refusal with validated requester-scoped file delivery, preserving channel/thread metadata.
- [x] 3.5 Add Telegram, Discord, and Slack runtime tests for successful remote file delivery, unsafe path rejection, missing/unsupported/oversized files, missing upload capability, and requester-only delivery.

## 4. Assistant-Callable File Delivery Action

- [x] 4.1 Register a narrow `relay_send_file` custom tool or equivalent assistant-callable action with `relativePath` and optional `caption` parameters.
- [x] 4.2 Enable prompt guidance so the assistant uses the relay file tool for remote requests instead of shelling out to a separate `pi` invocation or calling messenger APIs directly.
- [x] 4.3 Implement tool execution through the shared requester-scoped file delivery helper, requiring an active authorized requester context.
- [x] 4.4 Return safe tool results and local audit entries that include delivery status but exclude tokens, upload URLs, file bytes, hidden prompts, and transcripts.
- [x] 4.5 Add assistant-tool tests covering remote-origin success, local/no-context refusal, stale context refusal, validation failures, and adapter upload failure.

## 5. Broker, Shared-Room, and Parity Behavior

- [x] 5.1 Ensure requester context and remote file actions work when routes are registered through the machine-local broker and do not regress in-process runtime behavior.
- [x] 5.2 Preserve shared-room machine-bot silence rules so non-target adapters do not acknowledge or upload files for another bot's request.
- [x] 5.3 Add or update remote command parity tests so `send-file` is treated as implemented or explicitly capability-gated for every first-class adapter.
- [x] 5.4 Verify remote file delivery remains scoped to the selected session after `/use` and never reads from another paired session's workspace.

## 6. Documentation and Setup Guidance

- [x] 6.1 Update README remote command tables to document requester-scoped `send-file` for Telegram, Discord, and Slack separately from local `/relay send-file` fan-out.
- [x] 6.2 Update adapter docs and testing docs to describe safe remote file requests, conservative file type limits, and requester-only delivery.
- [x] 6.3 Update the relay skill documentation so agents know to use `relay_send_file` for remote natural-language file requests when available.
- [x] 6.4 Update setup/doctor guidance if an adapter lacks document upload scope or capability required for remote file delivery.

## 7. Validation

- [x] 7.1 Run targeted unit/runtime tests for file-delivery helpers, remote commands, assistant tool delivery, and adapter parity.
- [x] 7.2 Run `npm run typecheck`.
- [x] 7.3 Run `npm test`.
- [x] 7.4 Run `openspec validate support-remote-safe-file-requests --strict`.
