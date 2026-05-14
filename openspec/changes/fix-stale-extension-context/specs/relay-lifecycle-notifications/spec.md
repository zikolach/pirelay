## ADDED Requirements

### Requirement: Lifecycle notification diagnostics avoid stale contexts
PiRelay SHALL NOT use a stale extension context or stale session-bound extension API when reporting lifecycle notification diagnostics or warnings.

#### Scenario: Lifecycle warning context is stale
- **WHEN** a lifecycle notification delivery fails and the context that initiated the lifecycle operation has become stale
- **THEN** PiRelay skips the local status-line warning or records it through a safe live diagnostic path
- **AND** the stale context failure does not escape from lifecycle notification handling

#### Scenario: Startup lifecycle notification completes after context replacement
- **WHEN** startup lifecycle notification delivery completes after Pi has replaced or reloaded the session context
- **THEN** PiRelay does not call UI or status APIs on the replaced context
- **AND** the session startup path remains successful when messenger route registration and delivery state are otherwise valid

#### Scenario: Shutdown lifecycle notification completes after context replacement
- **WHEN** shutdown or offline lifecycle notification handling continues after the original context is no longer live
- **THEN** PiRelay continues route unregister or shutdown cleanup without throwing a stale-context error

#### Scenario: Local-disconnect notification cannot write local UI after reload
- **WHEN** local disconnect lifecycle handling sends or attempts a remote disconnected notification and the original local command context becomes stale before diagnostic reporting completes
- **THEN** PiRelay does not call local UI/status APIs on that stale context
- **AND** the binding revocation and route cleanup continue according to existing disconnect semantics

#### Scenario: Lifecycle diagnostic cannot append through stale API
- **WHEN** lifecycle diagnostic handling wants to append a local audit or status message but the extension API object captured by the route is stale
- **THEN** PiRelay skips or redirects that diagnostic through a matching live API path
- **AND** lifecycle notification delivery success or failure is not converted into a worker process crash by the stale local diagnostic
