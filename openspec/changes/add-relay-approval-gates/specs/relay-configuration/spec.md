## ADDED Requirements

### Requirement: Approval policy configuration
PiRelay SHALL provide explicit opt-in configuration for approval gates with safe defaults.

#### Scenario: Approval gates are not configured
- **WHEN** approval gate configuration is absent or disabled
- **THEN** PiRelay does not classify or block operations for remote approval
- **AND** existing prompt, tool, file, media, and notification behavior remains unchanged

#### Scenario: Approval policy is configured
- **WHEN** a user configures approval gates
- **THEN** PiRelay accepts bounded rules for tool names, operation categories, path/command/text patterns, timeout, grant scopes, grant TTLs, and optional scope constraints
- **AND** validates invalid rules with actionable diagnostics before relying on them

#### Scenario: Timeout is configured unsafely
- **WHEN** approval timeout configuration is missing, too low, too high, or invalid
- **THEN** PiRelay applies a documented bounded default or rejects the invalid value with a safe config diagnostic

### Requirement: Approval grant configuration
PiRelay SHALL configure reusable approval grants with safe defaults.

#### Scenario: Session grants are enabled
- **WHEN** approval gates support session-scoped grants
- **THEN** PiRelay uses a documented bounded TTL and revokes grants on session shutdown, session switch, binding revocation, remote disconnect, local disconnect, or explicit grant revocation

#### Scenario: Remote persistent grants are not enabled
- **WHEN** configuration does not explicitly enable remote persistent grants
- **THEN** PiRelay rejects or hides remote persistent approval options while still allowing local config-defined allow rules

#### Scenario: Remote persistent grants are enabled
- **WHEN** configuration explicitly enables remote persistent grants
- **THEN** PiRelay requires narrow matcher fingerprints, bounded audit records, and a documented revocation path for those grants

### Requirement: Approval policy diagnostics
PiRelay SHALL report approval policy status without exposing secrets.

#### Scenario: Doctor inspects approval config
- **WHEN** the local user runs relay diagnostics with approval gates configured
- **THEN** PiRelay reports whether approval gates are enabled, how many rules and active grants exist, which grant scopes are enabled, and any invalid or risky configuration findings
- **AND** it does not print raw secrets, hidden prompts, full command patterns containing redacted values, or bot credentials

#### Scenario: Policy references unsupported capability
- **WHEN** approval policy requires a messenger or button capability that the configured adapter cannot provide
- **THEN** PiRelay reports a clear fallback/unsupported-capability diagnostic and does not silently auto-approve matching operations

### Requirement: Approval configuration examples
PiRelay documentation SHALL include safe approval policy examples.

#### Scenario: User reads approval gate documentation
- **WHEN** a user reads README or config documentation for approval gates
- **THEN** the documentation explains opt-in behavior, approve-once versus approve-for-session behavior, persistent grants being disabled by default, fail-closed timeout behavior, examples for `git push`, package publishing, destructive shell commands, and protected file writes, plus warnings that approval gates are not a sandbox
