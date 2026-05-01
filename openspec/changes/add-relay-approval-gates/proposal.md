## Why

Remote control from Telegram is powerful, but some operations deserve explicit human confirmation when the user is away from the terminal. Approval gates make remote work safer by requiring Telegram confirmation before sensitive actions proceed.

## What Changes

- Add configurable approval policies for sensitive action categories such as push, publish, destructive shell commands, or user-defined patterns.
- Send Telegram approval requests with inline Approve/Deny actions scoped to the current session and pending operation.
- Add timeout, denial, stale-action, and offline behavior for approval requests.
- Add a local/Telegram audit trail of approval decisions.
- Preserve existing behavior when no approval policy is configured or when Pi/tooling does not expose approvable operations.

## Capabilities

### New Capabilities

### Modified Capabilities
- `telegram-session-tunnel`: adds remote approval, policy, timeout, and audit requirements for sensitive Pi actions.

## Impact

- Affected code: Telegram runtime, broker runtime, callback handling, config, state store, command help, tests, and documentation.
- Possible integration dependency: Pi must expose approvable operation hooks or confirmation events; otherwise this change starts with policy plumbing and simulated/test hooks.
- No breaking changes to existing prompt delivery or notification behavior.
