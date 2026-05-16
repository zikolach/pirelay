## 1. Delegation Domain Model

- [x] 1.1 Add pure delegation task types, status enums, lifecycle transition helpers, and validation helpers under shared relay core.
- [x] 1.2 Add task id generation, expiry checks, parent/depth tracking, and duplicate event/action idempotency helpers.
- [x] 1.3 Add safe task-card summary formatting and redaction helpers with bounded field lengths.
- [x] 1.4 Add unit tests for lifecycle transitions, stale actions, expiry, duplicate claims, and loop-prevention helpers.

## 2. State and Configuration

- [x] 2.1 Extend persisted state with backward-compatible optional delegation task records and bounded audit history.
- [x] 2.2 Add config schema/loading for delegation enablement, autonomy level, trusted peers, room scope, capabilities, expiry, timeout, and max depth.
- [x] 2.3 Add doctor/setup diagnostics for delegation readiness, unsafe autonomy, missing peer trust, unknown bot identity, and platform limitations.
- [x] 2.4 Add tests for config parsing, state migration/backward compatibility, diagnostics, and secret redaction.

## 3. Command and Card Rendering

- [x] 3.1 Add messenger-neutral parsing for task commands such as delegate/propose, claim, decline, cancel, status, and history.
- [x] 3.2 Add shared task-card renderers for proposed, awaiting approval, claimed, running, blocked, completed, failed, declined, cancelled, and expired states.
- [x] 3.3 Add platform affordance mapping for buttons/components/Block Kit/Telegram inline keyboards where available and text fallbacks everywhere.
- [x] 3.4 Add command-surface/help/docs updates for delegation commands without advertising unsupported platform behavior.
- [x] 3.5 Add tests for card rendering, action ids, text fallbacks, and command parser ambiguity.

## 4. Shared-Room Runtime Routing

- [x] 4.1 Add shared-room pre-routing for validated delegation task creation/actions while keeping ordinary bot-authored output inert.
- [x] 4.2 Implement trusted peer checks separate from human allow-lists for Telegram, Discord, and Slack inbound task events/actions.
- [x] 4.3 Implement target/capability eligibility checks, exact-machine targeting, safe silence for non-target brokers, and human disambiguation for ambiguous local targets.
- [x] 4.4 Add platform-specific handling for Discord threads/buttons, Slack threads/Block Kit/response URLs, and Telegram compact cards/replies/inline buttons.
- [x] 4.5 Add runtime tests for trusted peer creation, untrusted peer rejection, local/remote target silence, capability matching, duplicate delivery, and stale task actions.

## 5. Delegated Prompt Execution

- [x] 5.1 Implement claim-to-prompt handoff that injects bounded task context into the selected local route using existing route-action safety helpers.
- [x] 5.2 Report successful claim/start only after the target route accepts the prompt handoff.
- [x] 5.3 Report delegated completion, failure, abort, blocked, and unavailable states to the originating room/thread through the target machine bot identity.
- [x] 5.4 Ensure source-session follow-up injection is disabled by default or gated by explicit config and active authorization checks.
- [x] 5.5 Add tests for route unavailable races, revoked bindings, paused sessions, output scoping, and terminal task reporting.

## 6. Approval-Gate Integration

- [x] 6.1 Coordinate with `add-relay-approval-gates` implementation and add task id/context to approval request targeting when delegated work is active.
- [x] 6.2 Add task-scoped approval grant semantics that are narrower than session grants and expire with task/session/binding lifecycle.
- [x] 6.3 Add approval UI options for approve once, approve for task, approve for session when enabled, and deny.
- [x] 6.4 Add tests proving task approval does not escape to other tasks, sessions, requesters, revoked bindings, or persistent grants.

## 7. Loop Prevention and Autonomy Policies

- [x] 7.1 Enforce autonomy levels `off`, `propose-only`, `auto-claim-targeted`, and `auto-claim-safe-capability` as upper bounds on bot-authored task behavior.
- [x] 7.2 Enforce maximum delegation depth and parent task tracking for child delegations.
- [x] 7.3 Ignore self-authored task cards, ordinary bot output, completion summaries, and malformed bot-authored delegation-like text.
- [x] 7.4 Add tests for feedback-loop prevention, delegation depth, auto-claim policy boundaries, and cancellation behavior.

## 8. Broker and Documentation

- [x] 8.1 Keep no-federation delegation state local to the claimant broker and document that shared-room messages are the coordination medium.
- [x] 8.2 Add broker restart/stale route handling for pending/running delegation tasks.
- [x] 8.3 Update README, docs/adapters.md, docs/config.md, docs/testing.md, and shared-room parity docs with delegation setup and smoke checks.
- [x] 8.4 Add optional live/manual smoke checklist for two or more machine bots delegating in Discord/Slack/Telegram shared rooms.

## 9. Delegation Control-Plane Hardening

- [x] 9.1 Centralize delegation admission checks so Telegram, Discord, and Slack require explicit shared-room opt-in, authorization, and pairing/binding before task handling.
- [x] 9.2 Make bot-authored non-delegation messages inert before normal prompt routing in all adapters/runtimes.
- [x] 9.3 Scope task lookup, listing, history, mutation, and result delivery by full room ref: messenger, instance id, conversation id, and thread/reply id when available.
- [x] 9.4 Enforce action-scoped peer trust so create-only peers cannot claim, approve, cancel, decline, or otherwise control tasks.
- [x] 9.5 Prevent claim-before-approval and overlapping active delegated tasks for the same session unless queued prompt task ids are implemented.
- [x] 9.6 Persist delegation event/action idempotency keys and apply them to create and mutation paths across messenger redelivery/retry.
- [x] 9.7 Mark unsafe in-flight delegation tasks stale on runtime/broker startup and enforce running timeouts.
- [x] 9.8 Add regression tests for the hardening invariants above across core helpers, state store, and Telegram/Discord/Slack runtimes.

## 10. Validation

- [x] 10.1 Run `npm run typecheck`.
- [x] 10.2 Run `npm test`.
- [x] 10.3 Run `npm run openspec:validate`.
- [x] 10.4 Run `openspec validate add-shared-room-agent-delegation --strict`.
- [x] 10.5 Review changed files for unrelated edits, leaked secrets, hidden prompt exposure, and accidental implementation outside this change.
