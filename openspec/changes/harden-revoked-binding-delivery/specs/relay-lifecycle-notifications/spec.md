## ADDED Requirements

### Requirement: Lifecycle delivery skips revoked bindings
PiRelay SHALL NOT deliver lifecycle notifications to messenger bindings that have been revoked, and SHALL NOT let lifecycle notification bookkeeping recreate or imply active pairing for revoked conversations.

#### Scenario: Offline notification after remote disconnect is skipped
- **WHEN** a messenger conversation disconnects from a Pi session and the session later shuts down or goes offline
- **THEN** PiRelay does not send an offline lifecycle notification to the revoked conversation
- **AND** it may still notify other active non-revoked bindings for the same session

#### Scenario: Restored-online notification after remote disconnect is skipped
- **WHEN** a Pi session restarts after a messenger conversation binding was revoked
- **THEN** PiRelay does not send a restored-online lifecycle notification to the revoked conversation
- **AND** it does not mark that conversation as online or paired in lifecycle notification state

#### Scenario: Local-disconnect notification targets active bindings only
- **WHEN** the local Pi user invokes `/relay disconnect` for a session with a mix of active and already-revoked messenger bindings
- **THEN** PiRelay attempts local-disconnect lifecycle notification only for active bindings that are about to be revoked
- **AND** it does not notify bindings that were already revoked by earlier remote disconnect commands

#### Scenario: Lifecycle metadata cannot resurrect binding
- **WHEN** lifecycle notification metadata exists for a conversation whose session binding has since been revoked
- **THEN** PiRelay treats the binding revocation as authoritative
- **AND** lifecycle metadata is ignored, cleared, or updated without recreating active pairing or enabling future delivery
