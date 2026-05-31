## 1. Approval Scope Audit

- [x] 1.1 Trace local prompt, remote prompt, busy follow-up, steer, and broker-driven remote prompt flows to confirm when `remoteRequester` and pending-turn markers are set and cleared.
- [x] 1.2 Add focused tests that reproduce the current local prompt failure when approval gates are enabled and a matching tool call has no active remote requester.
- [x] 1.3 Add tests proving accepted remote turns still fail closed when the requester context or binding is stale, revoked, paused, or unavailable.

## 2. Runtime Enforcement

- [x] 2.1 Update the `tool_call` approval preflight to bypass approval gates for local-only turns without creating failure audit events.
- [x] 2.2 Preserve fail-closed behavior for remote-owned turns whose matching tool call cannot be safely approved.
- [x] 2.3 Ensure remote requester context is cleared or ignored for later local turns and cannot leak approval requests to a previous requester.
- [x] 2.4 Verify Discord, Slack, Telegram, and broker prompt paths still establish requester context only after successful prompt acceptance.

## 3. Configuration and Docs

- [x] 3.1 Verify `approvalGates.enabled` defaults to disabled in both config loaders and that `PI_RELAY_APPROVAL_ENABLED=false` overrides configured rules.
- [x] 3.2 Update README/config docs to state approval gates are disabled by default and scoped to remote messenger-owned turns only.
- [x] 3.3 Update `/relay doctor` or relevant diagnostics text if it implies approval gates protect local prompts.

## 4. Validation

- [x] 4.1 Run `npm run typecheck`.
- [x] 4.2 Run `npm test`.
- [x] 4.3 Run `openspec validate scope-approval-gates-to-remote-turns --strict`.
