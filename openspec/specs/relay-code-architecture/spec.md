# relay-code-architecture Specification

## Purpose
TBD - created by archiving change harden-multi-messenger-support. Update Purpose after archive.
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

