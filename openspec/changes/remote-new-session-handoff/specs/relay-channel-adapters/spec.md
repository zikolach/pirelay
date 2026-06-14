## ADDED Requirements

### Requirement: Adapters delegate new-session commands safely
Telegram, Discord, Slack, and future live messenger adapters SHALL route remote new-session commands through shared authorization, route resolution, and route-action safety helpers instead of implementing independent session replacement logic.

#### Scenario: Adapter authorizes before new-session side effects
- **WHEN** a messenger user sends `/new`, `relay new`, `/relay new`, or an equivalent new-session command
- **THEN** the adapter authorizes the user and resolves the selected route before invoking any Pi session-control action
- **AND** unauthorized users cannot trigger session replacement, binding migration, media download, prompt injection, or protected output

#### Scenario: Adapter renders typed new-session outcomes
- **WHEN** the shared route-action helper returns success, unavailable, busy, unsupported, cancelled, or failure for a new-session command
- **THEN** the adapter renders the corresponding safe platform-appropriate response
- **AND** does not mark the messenger runtime unhealthy for route-unavailable or unsupported-capability outcomes

#### Scenario: Broker and direct Telegram remain equivalent
- **WHEN** an authorized Telegram user requests a new session through direct runtime or broker-owned runtime for equivalent route state
- **THEN** both paths produce equivalent route-action behavior, binding handoff behavior, and user-facing response class
- **AND** both preserve binding authority and active selection invariants

#### Scenario: Slack and Discord parity or fallback is explicit
- **WHEN** Slack or Discord receives a new-session command
- **THEN** PiRelay either executes the shared new-session route action with the same semantics as Telegram or returns an explicit capability limitation
- **AND** tests document the chosen behavior instead of allowing a generic unknown-command response

#### Scenario: Deferred handoff work preserves destination identity
- **WHEN** an adapter schedules delayed offline notification, moved notification, or other handoff-related work for a messenger destination
- **THEN** the work remains scoped to the destination and binding state for which it was scheduled
- **AND** current binding authority is rechecked before protected session feedback is sent
