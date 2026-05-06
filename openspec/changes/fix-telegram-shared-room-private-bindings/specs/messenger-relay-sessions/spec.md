## ADDED Requirements

### Requirement: Cross-conversation Telegram shared-room authorization
The system SHALL allow a Telegram shared-room group conversation to use existing private-chat pairings for the same Telegram user as authorization proof when the group event explicitly addresses the local bot.

#### Scenario: Group command uses same user's private pairing
- **WHEN** a Telegram user has one or more active private-chat pairings with the local bot and sends an explicitly addressed command such as `/sessions@<local-bot-username>` in a group containing that bot
- **THEN** the system authorizes the command using active non-revoked private-chat bindings for the same Telegram user id
- **AND** the system does not require a binding whose chat id equals the group chat id

#### Scenario: Group selection is scoped separately from private binding
- **WHEN** the authorized Telegram user sends `/use@<local-bot-username> <session>` in a group
- **THEN** the system persists the active selection under the Telegram group conversation id and Telegram user id
- **AND** the private-chat binding remains associated with the private chat conversation id

#### Scenario: Private chat selection remains independent
- **WHEN** the same Telegram user selects a session in a group with `/use@<local-bot-username> <session>` and later sends a message in the private bot chat
- **THEN** the private bot chat continues to resolve using its own private-chat active selection and bindings
- **AND** the group selection does not redirect unrelated private-chat prompts

#### Scenario: Group command does not authorize other users
- **WHEN** another Telegram user in the same group sends `/sessions@<local-bot-username>` but has no active private-chat pairing with that bot
- **THEN** the system refuses to list sessions for that other user and returns private-chat pairing guidance when a response is safe

#### Scenario: One-shot group prompt uses originating conversation
- **WHEN** the authorized Telegram user sends `/to@<local-bot-username> <session> <prompt>` in a group and the session accepts the prompt
- **THEN** immediate acknowledgements and terminal completion/failure output for that prompt are delivered to the originating group conversation according to platform limits
- **AND** the command does not change either the group active selection or the private-chat active selection
