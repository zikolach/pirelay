## ADDED Requirements

### Requirement: Rate-limited progress updates
The system SHALL send optional, safe, rate-limited progress updates to the authorized Telegram chat while a paired Pi session is processing.

#### Scenario: Long-running turn emits progress
- **WHEN** a paired unpaused Pi session emits safe progress events during a long-running turn
- **THEN** the system sends concise Telegram progress updates no more frequently than the configured progress interval

#### Scenario: Progress events are too frequent
- **WHEN** multiple progress events occur before the next allowed progress interval
- **THEN** the system coalesces them into a bounded update instead of sending one Telegram message per event

#### Scenario: Progress content contains sensitive data
- **WHEN** a progress event contains content that is hidden, redacted, oversized, or not safe for Telegram delivery
- **THEN** the system omits or sanitizes that content before sending the progress update

### Requirement: Telegram session dashboard
The system SHALL expose a mobile-friendly session dashboard for paired sessions with inline quick actions and command fallbacks.

#### Scenario: User requests sessions dashboard
- **WHEN** an authorized Telegram user invokes `/sessions`
- **THEN** the system lists paired sessions with aliases when configured, online state, idle or busy state, current model when available, last activity, and safe quick actions

#### Scenario: User taps dashboard action
- **WHEN** an authorized Telegram user taps a dashboard action for a current paired session
- **THEN** the system performs the corresponding existing command behavior after validating session, chat, user, and stale state

#### Scenario: Dashboard action targets offline session
- **WHEN** an authorized Telegram user taps an action requiring an online session but the target session is offline
- **THEN** the system reports that the session is offline and does not silently drop the action

### Requirement: Notification preferences
The system SHALL let the authorized Telegram user configure per-binding notification preferences without exposing secrets.

#### Scenario: User enables quiet mode
- **WHEN** an authorized Telegram user enables quiet progress mode
- **THEN** the system suppresses non-terminal progress updates while continuing to deliver completion, failure, abort, and explicitly requested responses

#### Scenario: User enables verbose mode
- **WHEN** an authorized Telegram user enables verbose progress mode
- **THEN** the system sends safe progress updates using the verbose rate limit and still enforces coalescing and redaction

#### Scenario: Binding is restored
- **WHEN** a paired session resumes with saved non-secret binding metadata
- **THEN** the system restores notification preferences and aliases for that binding

### Requirement: Recent activity retrieval
The system SHALL provide explicit retrieval of recent safe progress and lifecycle activity for the current paired session.

#### Scenario: User requests recent activity
- **WHEN** an authorized Telegram user invokes a recent-activity command or dashboard action
- **THEN** the system returns a bounded list of recent safe progress, lifecycle, and notification events for the selected session

#### Scenario: No recent activity exists
- **WHEN** an authorized Telegram user requests recent activity before any retrievable events exist
- **THEN** the system replies that no recent activity is available and does not send empty output
