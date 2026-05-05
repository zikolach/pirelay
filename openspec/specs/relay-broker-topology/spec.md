# relay-broker-topology Specification

## Purpose
Defines the local and federated PiRelay broker topology for route registration, ingress ownership, peer communication, failover, and duplicate-bot safety across machines and sessions.
## Requirements
### Requirement: Machine-local broker supervisor
The system SHALL run at most one authoritative PiRelay broker per machine for a configured PiRelay state directory.

#### Scenario: First Pi session starts on a machine
- **WHEN** a Pi session starts with PiRelay enabled and no local broker is running for the configured state directory
- **THEN** the system starts one local broker and registers the session route with that broker

#### Scenario: Additional Pi sessions start on the same machine
- **WHEN** another Pi session starts on the same machine with the same PiRelay state directory
- **THEN** it connects to the existing local broker instead of starting another broker

#### Scenario: Stale broker socket exists
- **WHEN** the local broker socket or pid file exists but the broker is not alive
- **THEN** the system safely removes the stale local coordination file and starts a new broker without losing persisted bindings

### Requirement: Broker hosts all enabled messenger instances
The system SHALL let the machine-local broker own lifecycle and ingress for every enabled local messenger instance that it is allowed to operate.

#### Scenario: Multiple messenger instances are configured
- **WHEN** Telegram default, Discord personal, and Discord work messenger instances are enabled on the same machine
- **THEN** the local broker evaluates ownership and starts the eligible adapters from one broker process

#### Scenario: Session pairs to any configured messenger
- **WHEN** a local Pi session invokes `/relay connect <messenger-ref> [label]` for an enabled configured messenger instance
- **THEN** the local broker creates a pairing scoped to that messenger kind, instance id, machine id, and session route

#### Scenario: Messenger is disabled
- **WHEN** a user attempts to pair a session to a disabled messenger instance
- **THEN** the system refuses to create pairing state and reports the disabled instance through secret-safe guidance

### Requirement: Bot-scoped ingress ownership
The system SHALL ensure that each configured bot/account has no more than one active ingress owner in a broker group.

#### Scenario: Broker is the configured owner
- **WHEN** a broker starts a messenger instance whose ingress policy names that machine as owner
- **THEN** that broker starts platform polling, gateway, socket, or webhook ownership for the instance

#### Scenario: Broker is not the configured owner
- **WHEN** a broker starts with a messenger instance owned by another machine
- **THEN** it does not poll or connect to platform ingress for that bot/account and instead registers routes through the owner when federation is configured

#### Scenario: Ownership is ambiguous
- **WHEN** the same bot/account is configured on multiple machines and ownership cannot be determined safely
- **THEN** the system reports a blocking diagnostic and MUST NOT start duplicate ingress clients for that bot/account

### Requirement: Cross-machine route federation
The system SHALL support authenticated broker-to-broker route federation so one shared bot/account can route to Pi sessions on multiple machines.

#### Scenario: Non-owner broker registers local route
- **WHEN** a non-owner broker has an online paired session for a shared messenger instance
- **THEN** it registers a bounded route descriptor with the ingress owner without sending bot tokens, hidden prompts, tool internals, or full transcripts

#### Scenario: Ingress owner receives remote prompt
- **WHEN** the ingress owner receives an authorized prompt targeting a route hosted by another machine
- **THEN** it forwards a normalized delivery request to the owning broker and relays the resulting acknowledgement or failure back to the messenger

#### Scenario: Remote turn completion returns through ingress owner
- **WHEN** a remote owning broker reports completion, failure, abort, progress, full-output, image, or guided-action response for a session whose messenger ingress is owned by another broker
- **THEN** the ingress owner sends the normalized outbound response through the correct messenger adapter and preserves the originating messenger binding and platform limits

#### Scenario: Federation peer is unauthorized
- **WHEN** a broker receives a route registration, prompt delivery, notification, or action request from an unauthenticated peer
- **THEN** it rejects the request and does not expose session state or inject anything into Pi

### Requirement: Federated offline and failover behavior
The system SHALL report offline and failover states explicitly instead of silently dropping cross-machine interactions.

#### Scenario: Remote route owner is offline
- **WHEN** an authorized messenger user sends a prompt to a paired session whose owning machine is offline or disconnected from federation
- **THEN** the ingress owner reports that the target session or machine is offline and does not acknowledge successful delivery

#### Scenario: Ingress owner changes
- **WHEN** the configured ingress owner changes or an explicit failover lease is acquired
- **THEN** the new owner refreshes route registrations and ignores stale update offsets, callbacks, or action leases that belonged to the old owner

#### Scenario: Duplicate ingress is detected
- **WHEN** a messenger platform reports a conflict indicating another broker is already polling or connected as the same bot/account
- **THEN** the broker stops that adapter, records a diagnostic, and keeps local non-ingress session routing available when possible

### Requirement: Isolated shared-room broker topology
The system SHALL support an isolated multi-machine topology in which brokers do not communicate directly and each broker owns only its local sessions plus its locally configured dedicated messenger bot/app identities.

#### Scenario: Independent brokers share a messenger room through distinct bots
- **WHEN** multiple machines run PiRelay brokers with distinct bot/app tokens for the same messenger and those bots are members of one shared room
- **THEN** each broker starts only its own eligible adapter ingress, registers only local session routes, and relies on shared-room command visibility rather than broker federation for active-session coordination

#### Scenario: Shared-room mode does not imply route federation
- **WHEN** a broker is configured for shared-room machine-bot operation without broker peers or an ingress-owner policy for another machine
- **THEN** it does not attempt route registration, prompt forwarding, outbound forwarding, peer discovery, NAT traversal, or failover with other machines

#### Scenario: Shared token requires federation or refusal
- **WHEN** a broker is configured to use the same bot/account token as another unaware broker or detects platform conflict caused by another active consumer
- **THEN** the system reports that a shared bot/account requires explicit broker federation or one ingress owner and stops duplicate local ingress when safe

### Requirement: Shared-room safe silence
The system SHALL make safe silence the default behavior for non-target brokers that observe shared-room messages.

#### Scenario: Non-target broker observes prompt
- **WHEN** a broker observes an authorized shared-room message whose explicit target or active selection belongs to another machine
- **THEN** the broker does not inject the prompt, acknowledge delivery, execute controls, send typing/progress, or alter unrelated local session state

#### Scenario: Target cannot be determined
- **WHEN** a shared-room message is visible to a broker but the target machine/session cannot be determined and the message is not explicitly addressed to that broker
- **THEN** the broker remains silent rather than guessing a local route

