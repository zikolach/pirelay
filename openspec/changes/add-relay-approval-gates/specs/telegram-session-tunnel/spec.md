## ADDED Requirements

### Requirement: Remote approval requests
The system SHALL let configured sensitive Pi operations request explicit approval from the authorized Telegram user before proceeding.

#### Scenario: Sensitive operation requires approval
- **WHEN** a paired online Pi session starts an operation that matches an enabled approval policy
- **THEN** the system sends the authorized Telegram chat an approval request with a bounded safe summary and Approve/Deny actions

#### Scenario: User approves pending operation
- **WHEN** the authorized Telegram user taps Approve for the current unexpired pending operation
- **THEN** the system resolves that operation as approved exactly once and acknowledges the approval in Telegram

#### Scenario: User denies pending operation
- **WHEN** the authorized Telegram user taps Deny for the current unexpired pending operation
- **THEN** the system resolves that operation as denied and reports the denial in Telegram

### Requirement: Approval scoping and expiry
The system SHALL scope approval actions to the authorized chat, user, session, and pending operation, and SHALL reject stale or unauthorized approval attempts.

#### Scenario: Unauthorized user taps approval action
- **WHEN** a Telegram user who is not authorized for the bound session taps an approval action
- **THEN** the system rejects the callback and does not approve or deny the operation

#### Scenario: Approval action is stale
- **WHEN** an authorized Telegram user taps an approval action for an expired, completed, or superseded operation
- **THEN** the system rejects the stale action and does not affect any current operation

#### Scenario: Approval times out
- **WHEN** a pending approval reaches its configured timeout without an authorized decision
- **THEN** the system resolves or reports the operation as not approved according to safe host semantics

### Requirement: Approval policy configuration
The system SHALL support explicit approval policies for sensitive operation categories and user-defined patterns.

#### Scenario: No approval policy is configured
- **WHEN** no approval policy is enabled for a paired session
- **THEN** the system preserves existing PiRelay behavior and does not introduce new approval prompts

#### Scenario: User-defined pattern matches operation
- **WHEN** an operation summary matches a configured approval pattern
- **THEN** the system requires approval before allowing the operation to proceed

### Requirement: Approval audit trail
The system SHALL record non-secret audit events for approval requests and decisions.

#### Scenario: Approval decision is made
- **WHEN** an approval request is approved, denied, expired, or cancelled
- **THEN** the system records a bounded audit event containing session identity, action category, decision, decision time, and authorized user identity without storing secrets

#### Scenario: User requests approval audit
- **WHEN** an authorized Telegram user requests recent approval history
- **THEN** the system returns a bounded list of non-secret approval events for the selected session
