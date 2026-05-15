# relay-binding-authority Specification

## Purpose
Defines shared binding-authority snapshots, structured authority outcomes, bounded volatile fallback, and stable destination keys for protected messenger delivery and deferred work.

## Requirements
### Requirement: Binding authority snapshots classify state availability
PiRelay SHALL resolve protected messenger binding authority from an operation snapshot that distinguishes successfully loaded state from unavailable state.

#### Scenario: Snapshot loads existing state once for an operation
- **WHEN** a protected operation needs to evaluate multiple routes or multiple bindings from the relay state file
- **THEN** PiRelay loads and parses the state once for that operation
- **AND** resolves every binding decision for that operation from the same snapshot unless the operation explicitly mutates state and reloads afterward

#### Scenario: Missing state is treated as empty for setup and fresh installs
- **WHEN** the relay state file does not exist during setup, pairing creation, or other fresh-install-safe operations
- **THEN** PiRelay treats the state as empty and continues without reporting a corruption or authorization failure

#### Scenario: Unreadable or corrupt state is unavailable for protected delivery
- **WHEN** PiRelay cannot read the state file because of permissions, partial writes, I/O failure, or invalid JSON while evaluating protected delivery or control authority
- **THEN** the binding authority snapshot reports `state-unavailable`
- **AND** protected delivery, callbacks, uploads, lifecycle notifications, and broker forwarding fail closed instead of falling back to volatile in-memory bindings

### Requirement: Binding authority resolution returns structured outcomes
PiRelay SHALL classify Telegram and channel binding authority with structured outcomes that preserve the reason a binding may or may not be used.

#### Scenario: Active binding matches expected destination
- **WHEN** the snapshot contains a non-revoked, non-paused binding whose session, messenger kind, instance, conversation, and user match the expected destination
- **THEN** the resolver returns `active` with that persisted binding

#### Scenario: Paused binding matches expected destination
- **WHEN** the snapshot contains a non-revoked paused binding whose identity fields match the expected destination
- **THEN** the resolver returns `paused` unless the caller explicitly asks to include paused bindings
- **AND** protected outbound delivery skips sending while preserving the binding for future resume or status behavior

#### Scenario: Revoked binding matches expected session
- **WHEN** the snapshot contains a binding for the expected session and messenger instance with `status: "revoked"` or an equivalent revoked tombstone
- **THEN** the resolver returns `revoked`
- **AND** callers MUST NOT use route bindings, recent caches, active selections, or volatile fallback to send to that destination

#### Scenario: Persisted binding moved to another destination
- **WHEN** the snapshot contains a non-revoked binding for the expected session and messenger instance but its conversation or user differs from the expected destination
- **THEN** the resolver returns `moved`
- **AND** callers MUST clear stale volatile state for the previous destination rather than sending to either destination by accident

#### Scenario: Persisted binding is absent
- **WHEN** the snapshot was loaded successfully and contains no persisted binding for the expected session and messenger instance
- **THEN** the resolver returns `missing`
- **AND** any use of a volatile candidate is governed by the bounded fallback rules

### Requirement: Volatile binding fallback is explicit and bounded
PiRelay SHALL treat route bindings and recent-binding caches as volatile hints that cannot override authoritative persisted state.

#### Scenario: Missing persisted record permits exact volatile fallback
- **WHEN** the snapshot was loaded successfully, no persisted binding exists for the expected session and messenger instance, the call site explicitly allows fallback, and a volatile candidate exactly matches the expected session, conversation, user, messenger kind, and instance
- **THEN** the resolver MAY return an active volatile result for that operation

#### Scenario: Persisted revoked record blocks volatile fallback
- **WHEN** the snapshot contains a revoked binding for the expected session and messenger instance
- **THEN** the resolver MUST return `revoked` even if a route binding or recent cache still contains the old destination

#### Scenario: Persisted moved record blocks stale volatile fallback
- **WHEN** the snapshot contains a binding for the expected session and messenger instance whose conversation or user differs from the volatile candidate
- **THEN** the resolver MUST return `moved` for the stale candidate
- **AND** callers MUST NOT send to the stale candidate or silently switch the deferred operation to the new destination

#### Scenario: State unavailable blocks volatile fallback
- **WHEN** the binding authority snapshot reports `state-unavailable`
- **THEN** the resolver MUST NOT return a route binding or recent-cache binding as active for protected delivery

### Requirement: Deferred delivery targets use stable authority keys
PiRelay SHALL identify deferred activity, typing, progress, and similar delivery state by stable destination keys captured when the work is scheduled.

#### Scenario: Timer clears by captured key after revocation
- **WHEN** progress, typing, or activity refresh is scheduled for a bound destination and the binding is revoked before the timer fires
- **THEN** the timer re-checks binding authority for the captured destination
- **AND** clears the scheduled state by the captured key without relying on the route still containing that binding

#### Scenario: Timer does not move to a new destination
- **WHEN** a session is re-paired or moved to a different conversation before an existing timer fires
- **THEN** the existing timer does not send to the new conversation
- **AND** PiRelay clears or expires the old timer state for the original destination

#### Scenario: Stable key includes messenger scope
- **WHEN** PiRelay creates a stable key for channel-based deferred work
- **THEN** the key includes session key, messenger kind, messenger instance, conversation id, and user id where the platform identifies a user
- **AND** keys for different messengers, instances, conversations, or users do not collide
