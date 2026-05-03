## MODIFIED Requirements

### Requirement: PiRelay npm package identity
The npm-distributed package SHALL use `pirelay` as the public npm package name and SHALL expose PiRelay/relay resources as the canonical runtime namespace.

#### Scenario: Canonical package name is configured
- **WHEN** the package manifest is prepared for npm publication
- **THEN** the manifest package name is `pirelay`

#### Scenario: npm install documentation uses canonical name
- **WHEN** user-facing installation or verification documentation references the npm package source
- **THEN** it uses `npm:pirelay` or an exact-version form such as `npm:pirelay@<version>`

#### Scenario: Canonical relay resources are packaged
- **WHEN** the npm package is installed by Pi
- **THEN** package metadata points to PiRelay/relay extension and skill resources rather than `telegram-tunnel` resources

#### Scenario: Legacy Telegram tunnel namespace is absent
- **WHEN** a user inspects packaged docs, extension paths, skill paths, local config paths, local commands, package file lists, and exported/importable extension modules for the new release
- **THEN** they use `/relay` and PiRelay naming as canonical
- **AND** the package does not ship `extensions/telegram-tunnel/`, `skills/telegram-tunnel/`, `/telegram-tunnel` command behavior, or compatibility re-export shims
