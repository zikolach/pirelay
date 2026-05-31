## Why

PiRelay now supports increasingly capable remote control: prompts, steering, abort/compact, media delivery, safe file requests, and assistant-callable file delivery back to the originating remote requester. That power is useful, but it also means an unattended remote turn can reach sensitive Pi tool calls such as `git push`, package publishing, destructive shell commands, or writes to protected files.

Approval gates add a safety layer for that unattended workflow: configured sensitive operations pause before execution and ask the authorized remote controller for an explicit Approve/Deny decision. If the approval context is missing, stale, revoked, paused, or times out, PiRelay fails safely instead of guessing.

## What Changes

- Add explicit, opt-in approval policies for Pi tool-call categories and user-defined patterns, starting from Pi's `tool_call` pre-execution hook.
- Add a messenger-neutral approval request lifecycle with safe operation summaries, expiry, single-use decisions, optional session-scoped grants, tightly controlled persistent grants, and audit events.
- Render approval requests through Telegram, Discord, Slack, or future adapters using buttons where available and documented text/action fallbacks where not.
- Scope approval decisions and reusable grants to the active persisted binding, originating requester/conversation/thread where applicable, session, operation id or matcher fingerprint, authorized user, and expiry window.
- Add broker parity so broker-owned ingress can display approval prompts while the session-owning client blocks/resolves the sensitive operation.
- Preserve existing behavior when no approval policy is configured, when a tool/action is not classified as sensitive, or when PiRelay cannot associate the operation with an authorized approval target.

## Capabilities

### New Capabilities
- `relay-approval-gates`: defines approval policy matching, safe approval request summaries, decision lifecycle, timeout behavior, and audit events.

### Modified Capabilities
- `relay-interaction-middleware`: carries approval/confirmation classifications and action state through shared middleware without channel-specific coupling.
- `messenger-relay-sessions`: defines approval UX and authorization parity across Telegram, Discord, Slack, and future messengers.
- `relay-broker-topology`: defines broker/client approval request and decision routing.
- `relay-configuration`: defines explicit approval policy configuration and safe defaults.

## Impact

- Affected code: Pi extension runtime `tool_call` handling, config loading/doctor output, state store, messenger callback/action handling, broker protocol/process/runtime bridge, adapter renderers, audit rendering, docs, and tests.
- Integration basis: Pi exposes a blocking `tool_call` event that can inspect tool name and input before execution. Future Pi host approval hooks may extend this, but they are not required for the first useful implementation.
- Security posture: approval gates are not a sandbox. They are a configurable remote confirmation layer for selected operations. Deny, timeout, revoked binding, paused binding, stale action, broker failure, or an expired/revoked grant must not auto-approve. Persistent grants are disabled by default and require explicit configuration if supported.
- No breaking changes to existing prompt delivery, media delivery, or notifications when approval policies are disabled.
