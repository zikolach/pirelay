## ADDED Requirements

### Requirement: Telegram-native activity indication
The system SHALL show a Telegram-native activity indication for an authorized bound chat while accepted remote input is being processed by Pi.

#### Scenario: Idle prompt starts typing indication
- **WHEN** an authorized Telegram user sends non-command text to an idle bound Pi session and the prompt is accepted for delivery
- **THEN** the system sends a Telegram `typing` chat action to that chat instead of relying on a persistent "Prompt delivered to Pi" acknowledgement

#### Scenario: Activity indication is refreshed while Pi is busy
- **WHEN** a bound Pi session is processing accepted remote input for longer than a single Telegram chat-action visibility window
- **THEN** the system refreshes the Telegram `typing` chat action until the session reaches a terminal state or becomes unavailable

#### Scenario: Activity indication stops on terminal state
- **WHEN** the Pi turn completes, fails, is aborted, the tunnel is disconnected, or the route is unregistered
- **THEN** the system stops refreshing Telegram activity indications for that chat and relies on the normal completion, failure, abort, or disconnect response

#### Scenario: Busy-session delivery remains clear
- **WHEN** an authorized Telegram user sends a follow-up or steering message while the Pi session is already busy
- **THEN** the system may continue showing the Telegram activity indication for the active run and MUST still make the queued delivery mode clear to the user

#### Scenario: Chat action failure does not block prompt delivery
- **WHEN** Telegram rejects or fails a `typing` chat action for an otherwise authorized accepted prompt
- **THEN** the system still delivers the prompt to Pi and sends a safe textual acknowledgement or status response instead
