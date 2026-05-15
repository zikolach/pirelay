## MODIFIED Requirements

### Requirement: Setup wizard tab layout
The setup wizard SHALL present setup content in a tab-like layout that keeps each content category isolated and keeps actions in the footer line.

#### Scenario: Setup wizard shows tab-like navigation
- **WHEN** the setup wizard is rendered for any supported messenger
- **THEN** it shows tab labels for Diagnostics, Env snippet, Config snippet, Links, and Troubleshooting, plus messenger-specific tabs such as Slack App manifest when applicable
- **AND** it renders only the selected tab's content in the body
- **AND** it does not also render a duplicate vertical panel list, duplicate next-step section, or duplicate action section in the body

#### Scenario: Setup actions are shown in footer
- **WHEN** the setup wizard is rendered for any supported messenger
- **THEN** copy and write actions are shown in the bottom help/action line
- **AND** the body content remains dedicated to the selected tab

#### Scenario: Slack setup shows App Home QR guidance
- **WHEN** the setup wizard is rendered for Slack with a configured Slack App ID
- **THEN** the Links tab renders a Slack App Home open link and QR code
- **AND** the troubleshooting guidance explains that Slack App Home Messages Tab, `message.im`, `im:history`, `im:read`, `reactions:write`, and app reinstall are required when Slack says sending messages to the app is turned off

#### Scenario: Slack setup exposes a copyable app manifest
- **WHEN** the setup wizard is rendered for Slack
- **THEN** it includes an App manifest tab containing a secret-free Slack app manifest with App Home messages enabled, Socket Mode enabled, `chat:write`, `im:history`, `im:read`, `reactions:write`, channel/group history scopes, `message.im` events, interactivity enabled, and a `/relay` slash command entry for PiRelay remote commands
- **AND** it exposes a footer action to copy the manifest to the clipboard without closing the wizard
- **AND** the copied manifest does not include bot tokens, signing secrets, app-level tokens, pairing codes, hidden prompts, tool internals, or transcripts
- **AND** the setup guidance explains that Slack must deliver `/relay` through the installed app manifest before native slash invocations work, while plain `relay <command>` text remains the reliable fallback when slash setup is unavailable

#### Scenario: Slack setup explains missing App ID
- **WHEN** the setup wizard is rendered for Slack without a configured Slack App ID
- **THEN** the Links tab explains that `slack.appId` or `PI_RELAY_SLACK_APP_ID` is required for an App Home QR link
