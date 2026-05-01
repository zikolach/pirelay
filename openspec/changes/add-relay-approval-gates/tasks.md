## 1. Policy and state

- [ ] 1.1 Define approval policy configuration, defaults, and environment parsing.
- [ ] 1.2 Add pending approval and audit event types.
- [ ] 1.3 Add safe operation summary formatting and redaction helpers.

## 2. In-process approval flow

- [ ] 2.1 Add approval request registration and timeout handling.
- [ ] 2.2 Send Telegram approval messages with Approve/Deny inline actions.
- [ ] 2.3 Resolve approved, denied, expired, cancelled, stale, and unauthorized callbacks safely.

## 3. Broker parity

- [ ] 3.1 Add broker IPC messages for approval request, decision, cancellation, and timeout.
- [ ] 3.2 Mirror approval callbacks and audit recording in broker runtime.

## 4. Commands and docs

- [ ] 4.1 Add approval policy/audit commands or document config-only policy management.
- [ ] 4.2 Update README, config docs, testing docs, and Telegram tunnel skill docs.

## 5. Tests and validation

- [ ] 5.1 Add unit tests for policy matching, redaction, timeout, stale callbacks, and authorization.
- [ ] 5.2 Add runtime and broker tests for approval request/decision flows.
- [ ] 5.3 Run typecheck and the full test suite.
