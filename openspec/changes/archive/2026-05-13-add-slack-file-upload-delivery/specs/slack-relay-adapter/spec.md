## ADDED Requirements

### Requirement: Slack live outbound file delivery
The Slack adapter SHALL deliver authorized outbound documents and images through live Slack Web API file upload operations when the Slack app has the required scopes and the target conversation is bound to the Pi session.

#### Scenario: Slack image command uploads latest image
- **WHEN** an authorized Slack user invokes `pirelay images` for an online paired session with latest valid image outputs
- **THEN** PiRelay uploads each bounded supported image to the bound Slack conversation using the configured Slack app identity
- **AND** the upload appears in the same Slack thread when the command originated in a thread

#### Scenario: Slack explicit image path uploads file
- **WHEN** an authorized Slack user invokes `pirelay send-image <relative-path>` for a safe supported workspace image
- **THEN** PiRelay validates the path, size, and MIME type before upload
- **AND** uploads the image to Slack with a human-readable caption

#### Scenario: Slack upload scope is missing
- **WHEN** Slack rejects an outbound file upload because the app lacks file upload permission or has not been reinstalled after scope changes
- **THEN** PiRelay returns a safe actionable error that identifies Slack file upload setup as the problem
- **AND** it does not mark the Pi prompt or unrelated Slack runtime health as failed

#### Scenario: Slack upload target is revoked
- **WHEN** a Slack binding has been revoked or is no longer active
- **THEN** PiRelay does not upload documents or images to the stale conversation

#### Scenario: Slack upload rejects unsafe file
- **WHEN** the requested outbound image is missing, outside the workspace, unsupported, oversized, symlinked unsafely, or otherwise invalid
- **THEN** PiRelay rejects that file before calling Slack upload APIs
- **AND** reports a safe actionable message to the authorized Slack conversation
