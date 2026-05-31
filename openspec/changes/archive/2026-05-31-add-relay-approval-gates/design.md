## Context

PiRelay's remote surface has grown from Telegram-only prompt delivery into a messenger-neutral relay with Telegram, Discord, Slack, broker federation, media delivery, safe file delivery, and revoked-binding hardening. Remote control is now powerful enough that safety should not be limited to pairing authorization and output redaction.

Pi itself intentionally avoids built-in permission popups, but its extension API exposes a blocking `tool_call` event. PiRelay can use that hook to classify tool calls before execution and, when configured, ask the authorized remote controller to approve or deny sensitive operations.

## Goals / Non-Goals

**Goals:**
- Let maintainers explicitly configure which Pi tool calls/actions require remote approval.
- Start with Pi `tool_call` preflight so `bash`, `write`, `edit`, and future/custom tools can be classified before execution.
- Present clear, bounded approval requests through Telegram, Discord, Slack, and future adapters.
- Scope approval decisions to session, operation id, active persisted binding, authorized user, conversation/thread, and expiry.
- Keep broker mode equivalent: broker displays/receives messenger actions while the owning client blocks/resolves the operation.
- Record bounded, non-secret audit events for request, approve, deny, expiry, cancellation, and failure.

**Non-Goals:**
- Building a general sandbox or full command authorization system inside PiRelay.
- Replacing local Pi security controls, OS permissions, containers, or git review practices.
- Sending hidden prompts, raw tool internals, full command output, file bytes, or full transcripts in approval prompts.
- Allowing arbitrary remote users or stale/revoked bindings to approve operations.
- Adding policy enforcement when no approval policy is explicitly enabled.

## Current Architectural Fit

The useful path is now clearer than when this PR was first opened:

```text
Pi tool_call event
      │
      ▼
classify toolName + safe input summary
      │
      ├─ no matching approval policy ───────────────► allow tool call
      │
      └─ approval policy matched
             │
             ▼
       choose approval target
             │
             ├─ active remote requester/binding exists ─► send approval request
             │                                      │
             │                                      ├─ approve ─► allow exactly once
             │                                      ├─ deny ────► block
             │                                      └─ timeout ─► block
             │
             └─ no safe target / revoked / paused ─────► block or fall back to local host semantics
```

This should sit alongside, not inside, ordinary inbound prompt parsing. It is about tool/action preflight after a prompt has been accepted.

## Approval Targeting

Approval requests should prefer the remote requester context for the active turn when available, because that is the person who initiated remote work and expects to steer it. The requester context must still be revalidated against persisted state before each send and before each decision.

If a sensitive operation comes from a local-only turn, PiRelay should not surprise-send approval prompts to a messenger unless a future explicit configuration names an approval destination. For the first implementation, local-only operations can use existing local UI semantics or fail closed when a policy requires remote approval but no safe remote target exists.

## Policy Shape

Approval policy should be explicit and opt-in. A practical initial model:

- `enabled`: boolean
- `timeoutMs`: bounded default
- `rules`: ordered list matching:
  - tool name (`bash`, `write`, `edit`, custom tool name)
  - category (`shell`, `file-write`, `publish`, `git-remote`, `destructive`, `custom`)
  - command/path/text pattern after redaction/summarization
  - optional workspace/session constraints
- `defaultDecisionOnTimeout`: safe value, effectively deny/block

Policy matching should operate on normalized operation summaries. Raw inputs may be used locally for matching, but persisted/requested summaries must be redacted and bounded.

## Request, Decision, and Grant State

Pending approval state needs enough identity to be safe, not enough data to leak secrets:

```text
approvalId
sessionKey
operationId / toolCallId
toolName
riskCategory
safeSummary
matcherFingerprint
requester: channel + instanceId + conversationId + userId + optional thread
expiresAt
status: pending | approved | denied | expired | cancelled
```

The operation resolver must be single-use for `approve once`. Once approved, denied, expired, or cancelled, callbacks/actions against the same pending approval id are stale.

Approvals should also support reusable grants so remote work does not devolve into repeated prompts for the same safe pattern:

```text
Approval grant
  scope: once | session | persistent
  matcherFingerprint
  sessionKey?              required for session grants
  requester/binding scope  channel + instanceId + conversationId + userId + optional thread
  createdBy
  createdAt
  expiresAt / revokedAt
```

**Session grants** are useful enough for the first implementation. They approve future matching operations only for the same session, same authorized requester/binding scope, same matcher fingerprint, and within a bounded TTL. They expire on session shutdown/switch where practical, local `/relay disconnect`, remote conversation-scoped `/disconnect`, binding revocation, or configured TTL.

**Persistent grants** are riskier because a remote action can weaken future policy. They should be disabled by default. If supported, they require explicit local configuration such as `allowRemotePersistentGrants`, narrow matcher fingerprints, audit events, and a revocation path. A safe first implementation may document persistent grants as local-config-only while still reserving the state model.

## Messenger Rendering

Adapters should expose a shared approval rendering concept:

- Telegram: inline Approve once / Deny buttons, plus Approve for session when session grants are enabled.
- Discord: components/buttons where available, text/action fallback otherwise.
- Slack: Block Kit buttons where available, thread-aware response where applicable.

All renderers should show the same safe semantic fields: session label, operation category, short description, timeout, grant scope options, and a warning that timeout denies. Persistent/forever approval options should not appear unless explicitly enabled by local configuration.

## Broker Parity

Broker mode splits responsibility:

```text
session-owning client                         broker / ingress owner
        │                                                │
        ├─ tool_call blocks                              │
        ├─ creates approval request ────────────────────►│
        │                                                ├─ sends messenger prompt
        │                                                ├─ receives callback/action
        │◄──────────────────── decision / timeout ──────┤
        ├─ resolves blocked operation                    │
        └─ records local audit                           └─ records/send safe response
```

The broker must not be able to resurrect revoked bindings or approve without the owning client still recognizing the pending operation. The client must not auto-approve if the broker disconnects or times out.

## Revocation, Pause, and Stale-State Rules

Recent revoked-binding hardening should become a core invariant for approvals:

- A request is not sent to a revoked, paused, mismatched, or stale binding.
- A decision callback/action rechecks persisted active binding state before resolving.
- `/disconnect`, route unregister, session switch, timeout, and terminal cancellation clear or expire pending approval state.
- Broker route resync cannot recreate approval state for an already-expired operation.

## Audit

Audit events should be bounded and non-secret:

- requested / approved / approved-for-session / persistent-grant-created / denied / expired / cancelled / failed / grant-revoked
- session label/key hash or safe identity
- channel and user display label/id
- category/tool name
- matcher fingerprint label or hash
- redacted summary
- timestamps and expiry

Audit should be useful for answering “what did I approve remotely, and for how long?” without becoming a transcript or secret store.

## Risks / Trade-offs

- Too many prompts can make remote work annoying. Policies need coarse defaults and examples.
- Pattern matching shell commands is imperfect. This is a guardrail, not a sandbox.
- Safe summaries are hard: arguments may contain secrets. Redaction and length bounds are mandatory.
- Parallel tool calls require independent approval ids and careful timeout handling.
- Session grants reduce prompt fatigue but must be narrowly fingerprinted and revoked with binding/session lifecycle.
- Persistent grants are convenient but risky; they should require explicit opt-in and strong audit/revocation semantics.
- Cross-messenger parity adds work, but Telegram-only approval would now create architectural debt.

## Migration Plan

1. Refresh specs around messenger-neutral approval gates and current Pi `tool_call` integration.
2. Implement pure policy classification and safe summary formatting with tests.
3. Add pending approval state and in-process approval lifecycle.
4. Add adapter rendering/action handling for Telegram, Discord, and Slack.
5. Add broker IPC request/decision/timeout parity.
6. Add docs, doctor/config examples, and smoke tests.
