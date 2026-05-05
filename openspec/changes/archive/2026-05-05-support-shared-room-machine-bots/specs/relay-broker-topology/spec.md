## ADDED Requirements

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
