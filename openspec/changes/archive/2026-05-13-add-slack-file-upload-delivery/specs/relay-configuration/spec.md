## ADDED Requirements

### Requirement: Slack setup documents file upload permissions
The system SHALL guide users to configure Slack file upload permissions whenever Slack outbound image or document delivery is available.

#### Scenario: Slack setup manifest includes file upload scope
- **WHEN** PiRelay generates or documents a Slack app manifest for live Slack control
- **THEN** the manifest includes the bot scope required to upload files to Slack conversations
- **AND** the setup guidance tells users to reinstall the Slack app after changing scopes

#### Scenario: Slack setup checklist mentions file delivery
- **WHEN** the local user runs `/relay setup slack`
- **THEN** setup guidance lists Slack file upload permission as required for `pirelay images` and `pirelay send-image`
- **AND** distinguishes that text-only remote control can work without file upload permission

#### Scenario: Slack upload failure reports setup action
- **WHEN** Slack file delivery fails because of missing permission or app installation state
- **THEN** diagnostics or chat guidance tells the user to add the Slack file upload scope and reinstall the app without printing tokens, signing secrets, upload URLs, or file contents
