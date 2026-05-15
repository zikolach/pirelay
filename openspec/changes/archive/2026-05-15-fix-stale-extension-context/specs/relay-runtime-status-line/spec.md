## ADDED Requirements

### Requirement: Status-line updates require live context
PiRelay SHALL update relay status-line entries only through a live extension context and SHALL contain stale-context failures from status rendering paths.

#### Scenario: Deferred route publish reports sync error after context replacement
- **WHEN** a deferred route publish or sync callback wants to set a status-line error after the previous context became stale
- **THEN** PiRelay does not call `ctx.ui.setStatus` on the stale context
- **AND** it does not crash the extension, worker subprocess, or messenger runtime because the local status label could not be updated

#### Scenario: Status refresh after route state change has no live context
- **WHEN** a route state change requests status refresh but no live context is available
- **THEN** PiRelay skips the local status refresh
- **AND** it preserves the underlying messenger route and binding state

#### Scenario: Status refresh uses latest live context
- **WHEN** a newer live session context is available after session replacement
- **THEN** PiRelay uses that latest live context for status-line updates instead of any older context captured by the callback

#### Scenario: Latest live context is for a different session
- **WHEN** a deferred status refresh for one route sees a latest live context whose session identity belongs to another route
- **THEN** PiRelay does not update that other session's relay status-line entries with stale-route information
- **AND** it skips or safely scopes the refresh to the matching live route only

#### Scenario: Runtime error reporting avoids stale route context
- **WHEN** a messenger runtime or broker callback catches an error and wants to report local status through a route context
- **THEN** PiRelay reports the error only through a live context/status helper
- **AND** it does not call `route.actions.context.ui.setStatus` from delayed adapter or broker code
