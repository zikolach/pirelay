# relay-code-architecture Specification

## Purpose
Defines the canonical PiRelay source layout, module boundaries, migration constraints, and import-safety rules that keep shared relay logic separate from adapter and runtime side effects.
## Requirements
### Requirement: Layered TypeScript source layout
The system SHALL organize PiRelay TypeScript implementation into cohesive domain folders instead of a flat extension directory.

#### Scenario: Shared relay code is inspected
- **WHEN** a maintainer inspects `extensions/relay/`
- **THEN** broker, runtime, config, state, commands, middleware, adapters, media, notifications, formatting, UI, and testing code are grouped into clearly named folders

#### Scenario: Messenger-specific code is inspected
- **WHEN** a maintainer inspects messenger-specific implementation
- **THEN** Telegram, Discord, Slack, and future platform I/O live under `adapters/<messenger>/` or a similarly scoped platform folder and do not appear as shared relay modules

#### Scenario: Pure domain helper is added
- **WHEN** new parsing, selection, formatting, routing, migration, or validation logic is added
- **THEN** it is placed in a small testable module under the relevant shared folder instead of being embedded in broker scripts or adapter side-effect code

### Requirement: Explicit module boundaries and dependency direction
The system SHALL enforce clear dependency direction between shared domain code, adapters, broker/runtime side effects, and tests.

#### Scenario: Shared core imports are checked
- **WHEN** shared `core`, `config`, `state`, `commands`, `middleware`, `media`, `notifications`, or `formatting` modules are inspected or tested
- **THEN** they do not import concrete Telegram, Discord, Slack, broker process, Pi runtime, or filesystem side-effect modules unless explicitly defined as an edge contract

#### Scenario: Adapter imports shared contracts
- **WHEN** a messenger adapter handles platform-specific events or outbound delivery
- **THEN** it imports shared contracts and pure helpers but keeps platform SDK calls and network operations inside the adapter edge

#### Scenario: Runtime imports side effects
- **WHEN** the Pi extension lifecycle or broker entrypoint starts runtime behavior
- **THEN** side-effectful imports are isolated to runtime or broker entry modules so unit tests can import pure helpers without starting messenger clients, sockets, timers, or filesystem writes

### Requirement: TypeScript naming and exports
The system SHALL use clear TypeScript naming and export conventions that make public contracts distinguishable from implementation details.

#### Scenario: Public contracts are imported
- **WHEN** another module needs shared relay types or adapter interfaces
- **THEN** it imports them from stable contract modules or deliberate barrel exports, using `import type` for type-only imports

#### Scenario: Internal helper is not public API
- **WHEN** a helper is only used within one folder or adapter
- **THEN** it remains local to that folder and is not exported through broad catch-all barrels

#### Scenario: Legacy Telegram names are encountered in shared code
- **WHEN** shared modules are reviewed after the migration
- **THEN** names such as `TelegramTunnelConfig`, `telegram-tunnel-binding`, or `telegram-tunnel` status keys are absent from shared code except in explicit migration fixtures or Telegram adapter code

### Requirement: Legacy telegram-tunnel folder is removed
The system SHALL NOT keep canonical PiRelay runtime, broker, config, state, utility, command, formatting, media, adapter implementation code, or compatibility import shims under `extensions/telegram-tunnel/` after the relay migration.

#### Scenario: Legacy folder is inspected
- **WHEN** a maintainer inspects the source tree or npm package contents after this change is complete
- **THEN** `extensions/telegram-tunnel/` is absent
- **AND** no canonical runtime entrypoint, broker process, broker client runtime, config loader, state store, shared type contract, utility module, setup/doctor implementation, messenger adapter implementation, or re-export shim is shipped from that path

#### Scenario: Canonical imports are checked
- **WHEN** source files and tests are inspected
- **THEN** they import canonical PiRelay modules from `extensions/relay/**` rather than importing implementation or compatibility shims from `extensions/telegram-tunnel/**`
- **AND** only legacy migration fixtures outside the shipped extension tree may mention old `telegram-tunnel` paths as input data

#### Scenario: Legacy removal boundary test runs
- **WHEN** validation tests run
- **THEN** an automated check fails if `extensions/telegram-tunnel/` exists, if package resources reference that path, or if source/tests import from that path outside narrowly scoped migration fixture assertions

### Requirement: Test structure mirrors source structure
The system SHALL structure tests so module ownership and regression coverage are easy to find.

#### Scenario: Shared helper has tests
- **WHEN** a shared pure helper is created or moved
- **THEN** its unit tests are placed in a matching test location or named consistently with the source module

#### Scenario: Adapter parity is tested
- **WHEN** Telegram and Discord implement the same relay behavior through different platform renderers
- **THEN** tests cover the shared behavior once and adapter-specific rendering/transport separately

#### Scenario: Closed-loop parity tests exist
- **WHEN** a live messenger adapter supports pairing and prompt delivery
- **THEN** integration tests cover the complete `pair -> status -> prompt -> agent_end -> platform notification` loop plus failure and abort variants for that adapter

#### Scenario: UX parity tests exist
- **WHEN** a remote command such as `/status`, `/sessions`, `/use`, `/to`, `/full`, `/images`, `/progress`, `/recent`, `/alias`, or `/forget` is supported by one live messenger adapter
- **THEN** table-driven parity tests assert that every other live adapter exposes equivalent behavior and human-friendly output, allowing only platform-specific rendering differences

#### Scenario: Shared presentation helpers are used
- **WHEN** multiple messengers render the same relay concept such as status, sessions, output summaries, errors, or progress
- **THEN** shared formatter/presenter helpers provide the canonical content and adapters only apply platform-specific markup, buttons, or chunking

#### Scenario: Import boundary check runs
- **WHEN** the test suite or validation checks run
- **THEN** at least one automated check detects forbidden imports from shared folders into platform adapter or runtime side-effect folders

### Requirement: Route-action safety is shared core logic
The system SHALL place reusable route-action outcome types, availability probes, and operation safety helpers in shared relay modules instead of embedding the same route-lifetime transaction logic separately in Telegram, Discord, Slack, or broker edges.

#### Scenario: Shared route-action helper is added
- **WHEN** a helper models route availability, typed route action outcomes, prompt delivery safety, abort safety, compact safety, media workspace safety, or route status probing
- **THEN** it lives under a shared relay module such as `extensions/relay/core/` with focused unit tests

#### Scenario: Adapter imports route-action helper
- **WHEN** a messenger adapter needs to execute a fallible Pi route action
- **THEN** it imports the shared route-action safety contract and keeps only platform-specific command parsing, transport calls, and response rendering in the adapter module

#### Scenario: Broker imports route-action helper
- **WHEN** broker runtime code needs to forward or execute a fallible route action
- **THEN** it uses the shared route-action safety contract or a thin broker-compatible wrapper with parity tests instead of duplicating adapter-specific stale-route logic

### Requirement: Deprecated raw route context remains quarantined
Long-lived adapter and broker paths SHALL NOT add new direct dependencies on deprecated raw `SessionRouteActions.context` for route liveness, workspace, model, UI, prompt, abort, or compact behavior.

#### Scenario: New long-lived route code needs route liveness
- **WHEN** new remote, timer, broker, or adapter code needs to know whether a route is available, idle, busy, or has a workspace/model
- **THEN** it uses shared route-action safety helpers or narrow route actions rather than reading raw extension context directly

#### Scenario: Remaining raw context use is reviewed
- **WHEN** validation or review finds remaining `route.actions.context` usage
- **THEN** the usage is either removed, covered by a compatibility helper, or documented as synchronous and not long-lived

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
