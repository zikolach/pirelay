## ADDED Requirements

### Requirement: Binding authority rules live in shared pure modules
The system SHALL place binding-authority classification and destination-key derivation in shared testable relay modules rather than duplicating the rules inside messenger adapters or broker side-effect code.

#### Scenario: Pure authority helper is inspected
- **WHEN** maintainers inspect the binding-authority resolver module
- **THEN** it contains pure classification logic over provided state snapshots, expected destinations, and volatile candidates
- **AND** it does not import concrete Telegram, Discord, Slack, broker socket, Pi runtime, filesystem, timer, or network side-effect modules

#### Scenario: State loading edge is separate from pure resolution
- **WHEN** runtime, adapter, or broker code needs to evaluate binding authority
- **THEN** side-effectful state loading happens at the runtime or broker edge
- **AND** the loaded snapshot is passed into pure resolution helpers for classification

#### Scenario: Destination-key helper is shared
- **WHEN** adapters or broker code need keys for progress, typing, activity, lifecycle, or other deferred destination-scoped state
- **THEN** they use shared key derivation semantics that include session and messenger destination identity
- **AND** they do not derive cleanup keys solely from mutable route binding state

### Requirement: Runtime hot paths avoid synchronous state reads
The system SHALL avoid synchronous filesystem reads in asynchronous runtime, adapter, broker timer, progress, activity, and delivery hot paths.

#### Scenario: Async runtime timer checks authority
- **WHEN** a timer-driven path such as Telegram activity refresh, Discord typing refresh, Slack progress flush, or broker progress flush evaluates binding authority
- **THEN** it uses asynchronous state loading or an operation snapshot supplied by an asynchronous caller
- **AND** it does not call synchronous state-store helpers that block the event loop

#### Scenario: Synchronous helpers are explicitly scoped
- **WHEN** a synchronous state helper exists for tests, migration inspection, or a clearly synchronous diagnostic path
- **THEN** its name and usage make the blocking behavior explicit
- **AND** automated tests or import checks prevent it from being used in runtime delivery timers or hot paths

### Requirement: Broker and adapter authority implementations remain equivalent
The system SHALL keep broker-side and adapter-side binding-authority behavior equivalent even when packaging requires small wrappers around shared helpers.

#### Scenario: Broker wrapper delegates to shared semantics
- **WHEN** the broker process cannot directly use the same TypeScript class as adapter runtimes
- **THEN** any broker wrapper or JavaScript-compatible helper implements the same documented authority outcomes and fallback rules
- **AND** parity tests fail if broker and adapter authority decisions diverge for the same state snapshot and expected destination

#### Scenario: New adapter reuses authority contract
- **WHEN** a future messenger adapter such as Signal or Matrix adds protected delivery, progress, activity, or file upload support
- **THEN** it uses the shared binding-authority contract and destination-key semantics before platform I/O
- **AND** it does not introduce a messenger-specific revocation or recent-cache authority model
