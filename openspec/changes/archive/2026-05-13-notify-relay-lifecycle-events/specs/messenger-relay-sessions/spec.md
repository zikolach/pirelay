## ADDED Requirements

### Requirement: Paired sessions expose lifecycle presence
The system SHALL expose local Pi session lifecycle presence to paired messenger conversations as part of the shared messenger-neutral session semantics.

#### Scenario: Offline lifecycle preserves authorization boundary
- **WHEN** a paired Pi session goes temporarily offline during normal local shutdown
- **THEN** the messenger binding remains authorized for future restored-session use
- **AND** inbound messenger events while the session is offline are not injected into Pi until a live route is registered again

#### Scenario: Restored lifecycle resumes existing binding
- **WHEN** a Pi session restarts and restores an active persisted messenger binding
- **THEN** the paired messenger conversation can control the session again without a new pairing code
- **AND** PiRelay may notify the conversation that the session is back online according to lifecycle notification rules

#### Scenario: Local disconnect lifecycle revokes future control
- **WHEN** the local Pi user disconnects relay for a paired session
- **THEN** the system revokes that messenger binding
- **AND** future messenger events for that binding are rejected until a new pairing is completed
- **AND** PiRelay may notify the conversation that it was disconnected locally before revocation according to lifecycle notification rules
