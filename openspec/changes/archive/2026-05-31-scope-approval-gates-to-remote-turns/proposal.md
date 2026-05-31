## Why

Approval gates are intended as optional remote-turn guardrails, but matching tool calls can currently block local Pi prompts when no active remote requester exists. This makes local work unexpectedly depend on messenger approval state and creates friction even though local users already have direct control of the session.

## What Changes

- Make approval gates explicitly disabled by default unless `approvalGates.enabled` or `PI_RELAY_APPROVAL_ENABLED=true` enables them.
- Scope approval enforcement to accepted remote messenger turns with a current authorized requester context.
- Allow local-only turns to proceed without approval, even when an enabled approval rule would match the tool call.
- Keep fail-closed behavior for remote turns when requester context is stale, revoked, paused, missing after a previously accepted remote turn, or approval delivery/timeout fails.
- Document and test the distinction between local prompts, remote prompts, disabled approval gates, and stale remote requester state.

## Capabilities

### New Capabilities

- `relay-approval-gates`: Defines approval gate enablement defaults, local-vs-remote scope, requester requirements, and fail-closed remote approval behavior.

### Modified Capabilities

- `relay-configuration`: Clarifies approval gate defaults and environment/config disable behavior.
- `messenger-relay-sessions`: Clarifies that approval requester context is established only by accepted remote turns and must not affect later local turns.

## Impact

- Affected code: extension `tool_call` approval preflight, requester lifecycle handling, approval config loading/diagnostics, docs, and tests.
- Safety posture: remote approval requests remain fail-closed. Local prompts are explicitly out of approval-gate scope rather than treated as missing remote approval targets.
- No dependency changes or state schema changes are expected.
