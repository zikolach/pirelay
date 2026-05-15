# relay-context-lifetime-safety Specification

## Purpose
Defines how PiRelay safely resolves live Pi extension contexts and session-bound APIs for long-lived relay callbacks, route actions, remote controls, media/file access, and best-effort local UI/status updates after session replacement or reload.

## Requirements
### Requirement: Live extension context resolution
PiRelay SHALL resolve extension contexts at callback execution time for any relay operation that can outlive the command or session event that created it.

#### Scenario: Long-lived route action resolves current context
- **WHEN** a messenger route action runs after its route was created
- **THEN** PiRelay uses the current live extension context for context-dependent Pi operations
- **AND** it does not call UI, session, abort, compact, model, media, or prompt APIs on a stale captured context

#### Scenario: No live context is available
- **WHEN** a long-lived route action requires Pi context access but no live context is available
- **THEN** PiRelay fails that action gracefully with a safe non-secret error or skips a best-effort local UI operation
- **AND** it does not throw a stale-context error out of the relay runtime

#### Scenario: Latest live context belongs to another session
- **WHEN** a long-lived route action resolves a latest live context whose session identity does not match the route being acted on
- **THEN** PiRelay treats the route as unavailable for context-dependent controls
- **AND** it does not use the other session's context to inject prompts, abort, compact, read workspace files, or write route-local state

### Requirement: Session-bound extension API access is guarded
PiRelay SHALL treat captured session-bound extension API operations as unsafe after session replacement or reload and SHALL route them through live guarded helpers.

#### Scenario: Long-lived action sends prompt after replacement
- **WHEN** a remote messenger prompt is accepted by a route action after the original extension API object has become stale
- **THEN** PiRelay resolves a live API/context for the same route before calling `sendUserMessage`
- **AND** returns a safe unavailable/offline response if no matching live API/context exists

#### Scenario: Audit append sees stale extension API
- **WHEN** a delayed route action attempts to append or render a local relay audit event through a stale extension API object
- **THEN** PiRelay suppresses or safely records the audit failure
- **AND** the surrounding messenger route, broker callback, or worker process continues without crashing because of that local audit update

#### Scenario: Binding persistence sees stale extension API
- **WHEN** a delayed pairing, pause, resume, or disconnect action attempts to append route-local binding metadata through a stale extension API object
- **THEN** PiRelay does not call the stale API object
- **AND** it either uses a matching live route-local API or relies on shared persisted relay state while returning a safe response

### Requirement: Stale context failures are contained
PiRelay SHALL contain stale extension context failures from best-effort local UI and status updates.

#### Scenario: Local notification sees stale context
- **WHEN** a local relay notification callback attempts to notify through a context that Pi reports as stale
- **THEN** PiRelay suppresses or safely records the local notification failure
- **AND** the surrounding messenger route, lifecycle notification, or worker process continues without crashing because of that local UI update

#### Scenario: Deferred status refresh sees stale context
- **WHEN** a deferred status refresh runs after the captured context has become stale
- **THEN** PiRelay does not call `setStatus` or other UI APIs on that stale context
- **AND** it does not mark messenger runtime health as failed solely because the local status refresh could not be displayed

#### Scenario: Stale context detection is secret-safe
- **WHEN** PiRelay logs or reports a stale-context incident
- **THEN** the diagnostic omits bot tokens, pairing codes, hidden prompts, raw chat ids, raw channel ids, workspace ids, and transcript content

### Requirement: Live controls fail explicitly without live Pi access
PiRelay SHALL distinguish best-effort local UI updates from controls that require live Pi access.

#### Scenario: Abort requested without live context
- **WHEN** an authorized remote user requests abort but the target route has no live Pi context
- **THEN** PiRelay returns a safe unavailable/offline response instead of throwing a stale-context error

#### Scenario: Compact requested without live context
- **WHEN** an authorized remote user requests compaction but the target route has no live Pi context
- **THEN** PiRelay returns a safe unavailable/offline response instead of throwing a stale-context error

#### Scenario: Prompt injection requested without live context
- **WHEN** an authorized messenger prompt resolves to a route whose Pi context is no longer live
- **THEN** PiRelay rejects or defers the prompt according to existing offline/busy semantics
- **AND** it does not inject the prompt through a stale context

#### Scenario: Workspace file access requested without live context
- **WHEN** a local or remote file/image delivery path requires the route workspace root or media helpers but no matching live Pi context exists
- **THEN** PiRelay refuses the file/image operation with safe unavailable guidance
- **AND** it does not read paths using a stale route context

### Requirement: Route actions expose narrow lifetime-safe helpers
PiRelay SHALL avoid exposing raw extension contexts to adapter and broker code that can outlive the immediate Pi event.

#### Scenario: Adapter checks idle state
- **WHEN** Telegram, Discord, Slack, or a future adapter needs to know whether a route is idle for status, prompt routing, abort, or busy-delivery behavior
- **THEN** it uses a narrow route action helper that handles missing or stale live context safely
- **AND** it does not call `route.actions.context.isIdle()` from long-lived or remote-triggered code

#### Scenario: Adapter needs workspace root
- **WHEN** a remote file, image, or media delivery path needs the route workspace root
- **THEN** it obtains the workspace root through a lifetime-safe route action or plain immutable route metadata
- **AND** it does not depend on a stale captured `ctx.cwd`

#### Scenario: Adapter needs model capabilities
- **WHEN** a remote media prompt or status renderer needs model information
- **THEN** it obtains model information through a lifetime-safe route action that returns unavailable when no matching live context exists
- **AND** it does not call model or model registry APIs on a stale captured context

#### Scenario: Broker callback uses route actions
- **WHEN** the broker client receives a remote request to confirm pairing, deliver a prompt, send a requester file, abort, compact, or retrieve latest images
- **THEN** it uses lifetime-safe route action helpers for all context/API-dependent work
- **AND** it returns a safe error to the broker instead of throwing a stale-context error
