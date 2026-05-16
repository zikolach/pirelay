## ADDED Requirements

### Requirement: Delegation broker ownership boundaries
Broker topology SHALL keep shared-room delegation execution state local to the machine that claims and runs the delegated task unless explicit broker federation support is configured.

#### Scenario: No-federation shared-room delegation
- **WHEN** multiple independent machine brokers observe the same shared-room delegation task through distinct bot/app identities
- **THEN** each broker evaluates only its own eligibility, peer trust, and local session state
- **AND** no broker assumes remote route ownership, forwards prompts directly to another broker, or invents remote task state outside visible room coordination

#### Scenario: Local broker claims task
- **WHEN** a local broker claims a delegation task for one of its local sessions
- **THEN** that broker owns the target execution state, route-action safety checks, local task audit, terminal update reporting, and task-scoped approval state for that claim

#### Scenario: Broker restarts with running delegation task
- **WHEN** a broker or messenger runtime starts while a delegation task is pending, claimed, running, blocked, or recently completed
- **THEN** it reloads bounded non-secret local task state when available and marks unsafe in-flight work stale, blocked, or unavailable before accepting new delegation actions instead of silently continuing with stale route references

#### Scenario: Federation is configured in future
- **WHEN** explicit broker federation is configured to carry delegation task events directly between brokers
- **THEN** federation messages must preserve the same task identity, peer trust, authorization, expiry, approval, and loop-prevention rules as messenger-visible coordination
- **AND** they must not send bot tokens, hidden prompts, full transcripts, raw tool inputs, or file bytes unless a separate safe file-transfer capability explicitly allows it
