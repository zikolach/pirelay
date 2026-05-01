## ADDED Requirements

### Requirement: Signal feasibility report
The spike SHALL produce a documented feasibility report for Signal relay support before any production adapter is implemented.

#### Scenario: Spike completes
- **WHEN** the Signal spike tasks are complete
- **THEN** the change includes a report summarizing tested integration options, setup steps, capability support, security risks, packaging risks, and a go/defer/no-go recommendation

#### Scenario: Signal dependency is not viable
- **WHEN** the investigation finds that available Signal automation is too fragile, insecure, or difficult to package
- **THEN** the report recommends deferring or rejecting production Signal support and explains the blocking reasons

### Requirement: Signal capability assessment
The spike SHALL map Signal integration behavior to PiRelay channel adapter capabilities.

#### Scenario: Capability matrix is created
- **WHEN** the spike evaluates a Signal integration option
- **THEN** it records support status for text input/output, attachments/images, document transfer, typing/activity, inline actions or text fallbacks, message limits, identity mapping, pairing, authorization, and broker operation

#### Scenario: Missing inline actions are identified
- **WHEN** the evaluated Signal integration lacks inline buttons or callbacks
- **THEN** the report defines the required text-command fallback behavior for guided answers, approvals, dashboards, and latest-output retrieval

### Requirement: Signal secret and storage assessment
The spike SHALL identify how Signal credentials, local message stores, attachments, and pairing metadata would be protected.

#### Scenario: Signal local storage is required
- **WHEN** an evaluated Signal integration stores credentials, keys, messages, or attachments locally
- **THEN** the report documents storage location, permissions expectations, backup/export risks, and cleanup guidance
