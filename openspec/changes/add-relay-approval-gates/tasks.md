## 1. OpenSpec refresh

- [x] 1.1 Reframe approval gates as messenger-neutral instead of Telegram-session-tunnel-specific.
- [x] 1.2 Align the design with current Pi `tool_call` preflight hooks, broker topology, remote requester context, and revoked-binding hardening.
- [x] 1.3 Split requirements across current capabilities: approval gates, interaction middleware, messenger sessions, broker topology, and configuration.
- [x] 1.4 Add approve-once, approve-for-session, and explicitly opt-in persistent grant semantics.

## 2. Policy and state

- [ ] 2.1 Define approval policy configuration, defaults, environment/config parsing, and doctor diagnostics.
- [ ] 2.2 Add pure policy matching for Pi tool calls (`bash`, `write`, `edit`, and custom tools) and category/pattern rules.
- [ ] 2.3 Add safe operation summary formatting and redaction helpers.
- [ ] 2.4 Add pending approval, reusable approval grant, and bounded audit event state types.
- [ ] 2.5 Add active requester/binding lookup helpers for approval target selection and grant validation.
- [ ] 2.6 Add grant matching, expiry, revocation, and audit helpers for session-scoped and persistent grants.

## 3. In-process approval flow

- [ ] 3.1 Hook Pi `tool_call` preflight and classify operations before execution.
- [ ] 3.2 Register approval requests, block pending tool calls, and enforce timeout/cancellation behavior.
- [ ] 3.3 Send messenger-neutral approval requests through Telegram, Discord, and Slack renderers.
- [ ] 3.4 Resolve approved-once, approved-for-session, persistent-grant, denied, expired, cancelled, stale, unauthorized, paused, and revoked callbacks/actions safely.
- [ ] 3.5 Ensure approve-once decisions are single-use and scoped to session, operation id, user, conversation/thread, and active persisted binding.
- [ ] 3.6 Ensure reusable grants are scoped to matcher fingerprint, grant scope, session where applicable, requester binding, expiry, and active persisted binding.

## 4. Broker parity

- [ ] 4.1 Add broker IPC messages for approval request, decision, cancellation, timeout, and failure.
- [ ] 4.2 Mirror approval rendering and callback/action handling in broker mode.
- [ ] 4.3 Ensure broker reconnect/resync cannot resurrect expired approval requests/grants or bypass client-side pending-operation checks.
- [ ] 4.4 Ensure broker failure, missing route, timeout, revoked binding, paused binding, or expired/revoked grant does not auto-approve.

## 5. Commands, audit, and docs

- [ ] 5.1 Add approval audit and grant retrieval/revocation commands or document config-only policy management if no commands are added.
- [ ] 5.2 Record bounded non-secret audit events for request, decision, timeout, cancellation, failure, grant creation/use, and grant revocation.
- [ ] 5.3 Update README, config docs, testing docs, adapter docs, and relay skill docs with policy examples and smoke scenarios.

## 6. Tests and validation

- [ ] 6.1 Add unit tests for policy matching, grant matching, redaction, summary formatting, timeout, and state transitions.
- [ ] 6.2 Add Telegram, Discord, and Slack runtime tests for approval request/decision UX and stale/unauthorized callbacks.
- [ ] 6.3 Add broker tests for approval request/decision round-trips, disconnect during pending approval, timeout, and reconnect/resync.
- [ ] 6.4 Add regression tests proving no prompts appear and behavior is unchanged when approval policies are disabled.
- [ ] 6.5 Run `npm run typecheck`.
- [ ] 6.6 Run `npm test`.
- [ ] 6.7 Run `openspec validate add-relay-approval-gates --strict`.
