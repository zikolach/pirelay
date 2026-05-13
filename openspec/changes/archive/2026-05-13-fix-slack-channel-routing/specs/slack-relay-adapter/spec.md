## ADDED Requirements

### Requirement: Slack channel active selection routes prompts
The Slack adapter SHALL route unmentioned plain channel prompts only when channel control is enabled and the Slack conversation/user has an active selection pointing to an online local session.

#### Scenario: Channel pairing creates usable active selection
- **WHEN** an authorized Slack user completes pairing in a Slack channel while `slack.allowChannelMessages` is enabled
- **THEN** PiRelay persists an active channel selection for that Slack channel id, Slack user id, and paired session
- **AND** a following unmentioned non-command prompt from that same Slack user in that channel is injected into the paired Pi session

#### Scenario: Use command creates usable active selection
- **WHEN** an authorized Slack channel user sends `pirelay use <session>` and `<session>` resolves to an online local paired session for that channel/user
- **THEN** PiRelay persists the active channel selection for that Slack channel id and Slack user id
- **AND** a following unmentioned non-command prompt from that same Slack user in that channel is injected into the selected Pi session

#### Scenario: Plain channel text without local active selection is ignored
- **WHEN** an authorized Slack channel user sends unmentioned non-command text and no active selection points to a local online session for that channel/user
- **THEN** PiRelay does not inject the text into Pi
- **AND** PiRelay does not acknowledge successful delivery

### Requirement: Slack channel one-shot machine target routes prompts
The Slack adapter SHALL support documented one-shot channel prompt commands that explicitly target the local machine and session without requiring an active selection.

#### Scenario: Machine-qualified to command targets local session
- **WHEN** an authorized Slack channel user sends `pirelay to <machine> <session> <prompt>` and `<machine>` resolves to the local Slack machine identity
- **THEN** PiRelay resolves `<session>` among local paired sessions for that Slack channel/user
- **AND** PiRelay injects `<prompt>` into the resolved online Pi session
- **AND** the active selection is not changed by the one-shot command

#### Scenario: Session-only to command is handled in single-machine context
- **WHEN** an authorized Slack channel user sends `pirelay to <session> <prompt>` in a channel where the local Slack runtime can resolve `<session>` unambiguously for that channel/user
- **THEN** PiRelay injects `<prompt>` into the resolved online Pi session
- **AND** PiRelay does not require a bot mention solely because the command used the session-only form

#### Scenario: Malformed to command gives guidance
- **WHEN** an authorized Slack channel user sends a `pirelay to` command that PiRelay receives but cannot parse into a local machine/session/prompt target
- **THEN** PiRelay responds with Slack-safe usage guidance
- **AND** PiRelay does not silently claim delivery or inject a partial prompt

### Requirement: Slack mention fallback remains explicit local targeting
The Slack adapter SHALL continue to treat messages that mention the local Slack bot as explicit local targets while preserving shared-room safety for unrelated channel chatter.

#### Scenario: Mentioned prompt routes without active selection
- **WHEN** an authorized Slack channel user mentions the local Slack bot and includes prompt text while channel control is enabled
- **THEN** PiRelay strips the leading bot mention and injects the remaining prompt into the resolved local session according to normal selection rules

#### Scenario: Other channel chatter remains silent
- **WHEN** a Slack channel message does not mention the local bot, is not a recognized PiRelay command, and has no active local selection
- **THEN** PiRelay remains silent and does not inject the message into Pi
