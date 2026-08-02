## ADDED Requirements

### Requirement: Relay status distinguishes local binding from broker route health
PiRelay SHALL report local binding authority, broker transport health, and current-route registration health as separate states without exposing raw routing or destination identifiers.

#### Scenario: Active binding and synchronized broker route
- **WHEN** the current session has an active binding, its broker transport is connected, and the broker acknowledged its route for the current broker epoch
- **THEN** local status may report the messenger as paired and broker-synchronized
- **AND** concise status-line rendering remains consistent with an online remotely reachable route

#### Scenario: Active binding but broker route is missing
- **WHEN** the current session has an active local binding but its route is missing, rejected, or not yet acknowledged by the broker
- **THEN** `/relay status` and `/relay doctor` distinguish the active binding from the unsynchronized broker route
- **AND** the status line shows a warning, syncing, or unavailable state instead of implying fully connected remote control

#### Scenario: Broker socket is reconnecting
- **WHEN** the broker client socket closes or the broker epoch changes
- **THEN** PiRelay clears prior synchronized-route status immediately
- **AND** local status reports reconnecting or unavailable until current-epoch reconciliation succeeds

#### Scenario: Automatic reconciliation repairs status
- **WHEN** route reconciliation restores and acknowledges a previously missing route
- **THEN** PiRelay refreshes local status through a live extension context
- **AND** the warning or syncing state returns to paired/synchronized without requiring an unrelated user command

#### Scenario: Doctor repairs a missing registration
- **WHEN** `/relay doctor` finds a live local route with active binding authority but no acknowledged broker registration
- **THEN** it may invoke the same idempotent reconciliation operation used by automatic recovery
- **AND** it reports whether repair succeeded, remains pending, or failed with actionable local guidance
- **AND** it does not synthesize a route when no live local route exists

#### Scenario: Status output remains secret-safe
- **WHEN** local status or doctor reports broker transport, route synchronization, epoch change, restart convergence, or repair outcome
- **THEN** normal output excludes raw session keys, transcript paths, socket paths, bot tokens, token hashes, chat ids, user ids, and serialized route payloads
- **AND** it uses safe labels, categorical states, and bounded counts instead
