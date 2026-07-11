## ADDED Requirements

### Requirement: Session-list action surfaces prioritize actionable controls
Messenger command surfaces SHALL keep session-list buttons, menus, and equivalent action affordances aligned with the session state and the canonical command behavior they invoke.

#### Scenario: Offline session action is rendered
- **WHEN** a messenger renders buttons or menu actions for an offline session row
- **THEN** the primary action is a safe cleanup or inspection action such as forget or status
- **AND** the action does not advertise prompt delivery, recent live progress, or switching as if the offline session were reachable

#### Scenario: Recent command remains available outside default row buttons
- **WHEN** the default session-list action surface omits per-row `Recent` actions
- **THEN** the messenger still supports `/recent` or `/activity` through the canonical command parser when that command is available for the platform
- **AND** command-surface parity tests treat the command as supported even if it is not present as a default row button

#### Scenario: Platform cannot fit all actions
- **WHEN** a messenger platform has limited button or menu space for session-list actions
- **THEN** PiRelay prioritizes session selection for online non-current sessions and cleanup for offline/superseded sessions before optional recent-activity shortcuts
- **AND** omitted optional shortcuts remain documented through text commands or detailed status views
