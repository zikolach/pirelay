## Context

PiRelay can already inject prompts, abort work, compact context, and send completion output. The missing safety layer is interactive approval for operations that may have external or destructive effects. Examples include `git push`, `npm publish`, deleting files, or running commands that match user-configured patterns.

## Goals / Non-Goals

**Goals:**
- Allow maintainers to define which operations require Telegram approval.
- Present clear, bounded approval requests with inline Approve/Deny actions.
- Ensure approvals are scoped to session, operation id, chat, and authorized user.
- Record a non-secret audit trail of decisions.

**Non-Goals:**
- Building a general sandbox or command authorization system inside PiRelay.
- Sending full command output or hidden tool context in approval prompts.
- Bypassing local Pi approval semantics if the host already denied an operation.

## Decisions

1. **Policy is explicit and opt-in.**
   Approval gates should not surprise users or block ordinary work unless configured or triggered by an exposed Pi approval hook.

2. **Approval requests use operation summaries.**
   Telegram receives action type, short description, working directory/session label, risk category, and timeout. Raw hidden content and oversized payloads are excluded.

3. **Approvals are single-use and scoped.**
   Callback data references an internal pending approval id. The runtime validates binding, user, chat, session, expiry, and current pending state before resolving.

4. **Deny and timeout are safe defaults.**
   If no authorized approval arrives before expiry, the operation is denied or left unresolved according to Pi host semantics. PiRelay never auto-approves on error.

5. **Broker parity is required.**
   In broker mode, the broker owns Telegram polling while the session-owning client owns operation execution. Approval resolution must round-trip over IPC.

## Risks / Trade-offs

- Pi may not expose enough structured approval hooks; implementation may need a compatibility layer or start with known command categories.
- Too many approval prompts can slow down remote workflows; policies need allowlist/session controls.
- Approval summaries may leak sensitive arguments; apply redaction and allow users to keep policies coarse.
- Multi-session approval routing must be exact to avoid approving the wrong operation.

## Migration Plan

1. Add approval policy configuration and pending approval state types.
2. Add in-process approval request/resolve flow and Telegram callbacks.
3. Add broker IPC for approval request and resolution.
4. Add audit event recording and retrieval.
5. Document policy examples and safe defaults.
