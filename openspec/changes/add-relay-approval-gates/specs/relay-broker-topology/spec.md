## ADDED Requirements

### Requirement: Broker approval request routing
The broker topology SHALL support approval requests from a session-owning client to the broker-owned messenger ingress without transferring operation execution authority to the broker.

#### Scenario: Client requests broker-rendered approval
- **WHEN** a session-owning client blocks a sensitive operation and creates a pending approval request
- **THEN** it sends the broker a normalized approval request containing safe summary, session, approval id, requester binding, expiry, and adapter rendering metadata
- **AND** the broker sends the approval request only if the persisted binding is active, authorized, non-paused, and matches the requester context

#### Scenario: Broker cannot deliver approval request
- **WHEN** the broker cannot deliver an approval request because the binding is revoked, paused, stale, unauthorized, offline, or the adapter send fails
- **THEN** the broker reports failure to the owning client
- **AND** the client does not approve the operation by default

### Requirement: Broker approval decision routing
The broker topology SHALL route approval decisions back to the owning client and require the client to validate pending operation state before unblocking execution.

#### Scenario: Broker receives valid approval callback
- **WHEN** the broker receives an approval callback/action from the authorized active binding before expiry
- **THEN** it forwards the normalized decision to the owning client for final pending-operation validation

#### Scenario: Owning client no longer has pending operation
- **WHEN** the broker forwards an approval decision but the owning client has no matching pending approval or operation id
- **THEN** the client rejects the decision as stale
- **AND** the broker reports a safe stale-action response to the messenger when possible

#### Scenario: Broker reconnects while approval is pending
- **WHEN** broker or client reconnect/resync occurs while an approval is pending
- **THEN** pending approval state remains single-use and expiry-bound for approve-once decisions
- **AND** reusable grant state remains bounded by scope, matcher fingerprint, expiry, and active binding validation
- **AND** stale route descriptors or resync messages cannot recreate an expired approval or approve without a current client-side pending operation or valid grant

### Requirement: Broker approval failure is fail-closed
The broker topology SHALL fail closed for approval gates.

#### Scenario: Broker disconnects during pending approval
- **WHEN** the broker, socket, or owning client disconnects before a pending approval is resolved
- **THEN** the operation is not approved automatically
- **AND** PiRelay resolves, expires, or cancels the approval according to safe timeout/cancellation semantics

#### Scenario: Approval target binding is revoked in broker state
- **WHEN** persisted broker state marks the approval binding revoked before send, decision, or grant use
- **THEN** the broker rejects the approval request, decision, or grant and does not resurrect the binding
