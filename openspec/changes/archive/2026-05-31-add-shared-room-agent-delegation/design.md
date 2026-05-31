## Context

PiRelay now has the pieces required for messenger-native multi-agent coordination: distinct machine bots in shared rooms, explicit machine targeting, active selection, command surfaces, Slack/Discord/Telegram adapter parity, safe file delivery, route-action safety, and binding-authority checks. The remaining gap is coordination between agents. Today a human can target machine bots, but one Pi agent cannot safely delegate a bounded task to another machine bot in the same room without falling back to fragile free-form chat.

The desired product direction is agent-directed delegation with human supervision. That implies PiRelay must treat messenger rooms as visible operations rooms, not hidden RPC buses. Agents may create or claim tasks only through explicit, bounded, human-readable delegation objects that humans can approve, cancel, and audit.

This change should be designed alongside `add-relay-approval-gates`. Delegation approval answers “may this agent ask that agent to do this bounded task?” Approval gates answer “may this session execute this sensitive tool/action now?” They are related but not identical.

## Goals / Non-Goals

**Goals:**

- Let trusted agents publish visible delegation tasks into shared messenger rooms.
- Let target machine bots claim, decline, update, complete, fail, or cancel those tasks.
- Keep humans in supervision control through explicit approvals, cancellations, status, and audit.
- Support targeted delegation (`server`) and capability-oriented delegation (`linux-tests`) with conservative defaults.
- Inject claimed work into the target local Pi session as a transparent prompt with task id, goal, constraints, and report destination.
- Integrate with approval-gate semantics, including task-scoped grants for repeated safe operations within one delegated task.
- Prevent loops, duplicate claims, stale task execution, and accidental prompt injection from bot-authored ordinary output.
- Work through messenger-native surfaces: Discord/Slack threads and buttons when available, Telegram compact cards/replies/buttons when available, text commands everywhere.

**Non-Goals:**

- Do not build free-form bot-to-bot chat where arbitrary bot output becomes another bot's prompt.
- Do not build a hidden cross-broker RPC layer for delegation in the first release.
- Do not allow untrusted bots or stale/revoked bindings to create, claim, or approve tasks.
- Do not auto-approve sensitive tool calls just because a task was claimed.
- Do not require full autonomy. Conservative propose/claim flows are acceptable before auto-claim policies mature.
- Do not replace human-directed shared-room commands such as `/use`, `/to`, and `/sessions`.

## Decisions

1. **Delegation is a visible task object, not free-form bot chat.**
   - Agents create normalized task cards through explicit delegation commands or structured events.
   - Other bots act only on validated task objects, not arbitrary bot-authored text.
   - Alternative considered: parse natural-language bot messages for intents. Rejected because it is loop-prone and impossible to audit reliably.

2. **Task cards are human-readable first and machine-parseable second.**
   - Cards show task id, source machine/session, target machine or capability, goal, status, expiry, and safe action commands/buttons.
   - Persisted task state stores non-secret identifiers, status, room/thread references, trust scope, parent task id, and bounded audit events.
   - Raw prompts, hidden context, tool inputs, full transcripts, tokens, and file bytes are not embedded in cards or task state.

3. **Peer bot trust is separate from human allow-lists.**
   - Human allow-lists authorize people to control PiRelay. Peer trust authorizes another bot identity to request or claim delegated work.
   - A bot may be trusted for creation, claiming, or both, and may be constrained by room, messenger instance, machine id, and capability.
   - Alternative considered: reuse `allowUserIds` for bot peers. Rejected because bot delegation carries different risk and needs separate diagnostics/revocation.

4. **Delegation has a bounded lifecycle.**
   - Proposed tasks expire if unclaimed. Claimed/running tasks have their own timeout or heartbeat/update expectations.
   - A task can have at most one active claimant unless later designs add explicit fan-out tasks.
   - Human cancellation, source cancellation, target decline, route unavailability, binding revocation, and expiry move tasks to terminal or blocked states.

5. **Claiming a task does not approve every tool call.**
   - Claiming authorizes injecting a bounded task prompt into a target session under policy.
   - Sensitive tool calls still require approval gates.
   - Delegation adds an approval scope that is narrower than session: `task`. Task-scoped grants apply only to matching operations within the delegated task, target session, requester/approver scope, and TTL.

6. **Autonomy is policy-driven and conservative.**
   - Initial autonomy levels should be explicit, for example `off`, `propose-only`, `auto-claim-targeted`, and `auto-claim-safe-capability`.
   - Default behavior should require human approval before agent-originated delegation can cause prompt injection, unless configuration explicitly allows targeted low-risk auto-claiming.
   - Broadcast capability tasks should be more conservative than exact-machine tasks.

7. **Messenger threading is used opportunistically.**
   - Discord and Slack should keep task discussion and updates in threads when available.
   - Telegram should use compact cards and replies/buttons because thread semantics differ.
   - Text fallbacks must exist for every state transition.

8. **Shared-room delegation remains room-visible coordination by default.**
   - In no-federation shared-room mode, each broker observes its own bot/app ingress and owns only local execution state.
   - A delegated task may be visible to all bots, but only the target or eligible claimant acts.
   - Broker federation may later carry task events directly, but this change should not require NAT traversal, hosted services, or shared bot tokens.

## Delegation Control-Plane Invariants

The implementation must treat delegation as a guarded control plane layered on top of shared-room authorization, not as a separate early adapter shortcut.

1. **Shared-room admission is mandatory.** Delegation commands and task-card actions are accepted only in messenger conversations that satisfy the same shared-room opt-in, allow-list, pairing/binding, and active room checks as ordinary room controls for that platform.
2. **Bot output is inert unless explicitly structured.** Bot-authored messages are dropped before normal prompt routing unless they parse as an explicit delegation command or task-card action and pass peer trust for the exact action.
3. **Task room identity is full-fidelity.** Visibility, status, history, mutation, and result delivery are scoped by messenger, instance id, conversation id, and thread/reply id when the platform provides one; conversation ids alone are never globally authoritative.
4. **Peer trust is action-scoped.** A trusted peer may create, claim, or perform future control actions only when that specific action is configured. Human approval/cancel/decline authority is not implied by peer create trust.
5. **Claim and prompt execution are atomic.** A task is not moved to claimed/running unless execution is allowed and the target prompt is accepted or safely queued with an unambiguous task association. If human supervision is still required, the task remains awaiting approval or claimable.
6. **One active delegated turn per session by default.** Until queued turns carry their own task ids, runtimes must reject or block overlapping delegated claims for a session that already has active delegated work.
7. **Runtime state loss is explicit.** Startup marks unsafe claimed/running work stale or blocked before accepting new delegation actions, and running-timeout policy is enforced so tasks cannot stay active forever.
8. **Messenger redelivery is idempotent.** Task creation and task mutations use persisted event/action keys so retries or polling redelivery do not duplicate tasks or repeat state transitions.
9. **Approval gates remain separate.** Task approval permits bounded delegation flow; sensitive tool execution still depends on the approval-gate control plane and task-scoped grant matching.

## Risks / Trade-offs

- **Bot loops and noisy rooms** → Only validated task cards/commands are actionable, ordinary bot output is inert, parent task ids and max depth are enforced, self-authored cards are ignored.
- **Over-permissive peer trust** → Keep peer trust separate from human authorization, default to no peer delegation, require explicit room/machine/capability constraints, and add doctor diagnostics.
- **Approval fatigue** → Use task-scoped approval grants for repeated matching operations, but keep persistent grants disabled by default.
- **Task state drift from messenger history** → Persist bounded local task state and treat message cards as UI, not the source of truth; expired/stale cards cannot be claimed.
- **Duplicate claims across bots** → Use task status transitions with compare-and-set/lock semantics locally; in no-federation mode rely on visible claim messages plus local idempotency and reject later duplicate claims observed by the same broker.
- **Telegram limitations** → Keep Telegram task cards compact and rely on addressed commands/replies; do not promise Discord-like threads.
- **Capability matching ambiguity** → Prefer exact machine targets first; capability broadcasts require policy and may ask for human confirmation when multiple local sessions match.

## Migration Plan

1. Add pure delegation domain helpers and task state schema with backward-compatible optional fields.
2. Add configuration and diagnostics for peer trust, capabilities, autonomy, expiry, and max delegation depth.
3. Add command parsing and renderer text for task cards and lifecycle transitions.
4. Add messenger runtime handling in conservative manual/propose mode first.
5. Add target-session prompt injection and terminal update reporting.
6. Integrate task-scoped approval grants with approval-gate implementation when that change is available.
7. Expand to safe auto-claim policies after manual claim/approval behavior is tested.

## Open Questions

- Should the first implementation require human approval before every agent-originated task claim, or allow exact-machine low-risk auto-claiming from trusted peers?
- Should task ids be room-local short ids, globally unique ids, or both?
- Should task cards be edited in place where platforms support it, or should updates always be appended as room/thread messages?
- How should a source agent receive final structured results: only as room-visible text, or also injected back into the source session as a follow-up?
- Should delegation capabilities be manually configured only, or can sessions advertise capabilities inferred from local environment and skills?
