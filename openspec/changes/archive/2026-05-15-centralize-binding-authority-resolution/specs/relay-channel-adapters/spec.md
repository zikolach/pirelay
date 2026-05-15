## ADDED Requirements

### Requirement: Adapter runtimes use shared binding authority semantics
Messenger adapter runtimes SHALL use the shared binding-authority contract for active, paused, revoked, moved, missing, and state-unavailable decisions instead of implementing divergent ad-hoc active-binding logic.

#### Scenario: Adapter resolves active binding through shared authority
- **WHEN** Telegram, Discord, Slack, or a future adapter is about to deliver protected output or execute a protected action
- **THEN** it resolves the expected destination through the shared binding-authority semantics
- **AND** platform-specific code only performs transport I/O after the authority outcome permits the side effect

#### Scenario: Adapter does not perform duplicate persisted lookups for one decision
- **WHEN** an adapter needs both raw binding information and active-delivery authorization for the same session and destination
- **THEN** it derives both from one loaded snapshot or raw persisted record
- **AND** does not call separate state-loading helpers back-to-back for the same authority decision

#### Scenario: Adapter uses volatile fallback only when allowed
- **WHEN** an adapter has a recent binding or route-local binding for a session but persisted state is revoked, paused, moved, or unavailable
- **THEN** it does not use that volatile binding for protected delivery
- **AND** it clears or ignores the stale cache according to the authority outcome

### Requirement: Adapter deferred work preserves original platform address
Messenger adapter runtimes SHALL keep typing, activity, reaction, progress, and thread-scoped deferred work bound to the original platform address for which it was scheduled.

#### Scenario: Discord typing refresh validates original address
- **WHEN** Discord typing refresh was started for one conversation and user
- **THEN** each refresh validates that the current authority result still matches that original conversation and user
- **AND** stops typing instead of refreshing a different conversation after re-pair or overwrite

#### Scenario: Slack progress flush validates original address and thread
- **WHEN** Slack progress delivery was scheduled for a channel/user/thread destination
- **THEN** the flush validates that the active binding still matches the original Slack destination and thread metadata before sending
- **AND** clears pending progress by its captured key if the binding is revoked, paused, moved, missing, or unavailable

#### Scenario: Telegram activity refresh validates original chat
- **WHEN** Telegram activity refresh was scheduled for a chat
- **THEN** the refresh validates binding authority for the original chat before sending chat action
- **AND** does not switch to another chat after re-pair or shared-room destination changes

### Requirement: Adapter authority behavior is parity-tested
PiRelay SHALL test binding-authority behavior across first-class adapters with the same core scenario matrix and adapter-specific transport assertions.

#### Scenario: Shared matrix covers all adapters
- **WHEN** adapter authority tests run for Telegram, Discord, Slack, and future first-class adapters
- **THEN** they cover active, paused, revoked, moved, missing, state-unavailable, exact volatile fallback, and stale volatile fallback cases

#### Scenario: Platform I/O is not called when authority fails
- **WHEN** an adapter authority outcome is paused, revoked, moved, missing without allowed fallback, or state-unavailable
- **THEN** tests assert that the adapter does not call platform send, upload, typing, reaction, or action-answer operations that would expose protected session data
