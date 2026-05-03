# npm-distribution Specification

## Purpose
Defines npm packaging and distribution requirements for PiRelay, including package metadata, shipped resources, command namespace, and exclusion of removed legacy extension paths.
## Requirements
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

### Requirement: Publishable npm manifest
The package manifest SHALL be configured so PiRelay can be published as a public npm package while preserving Pi package discovery metadata.

#### Scenario: Package is not marked private
- **WHEN** a maintainer prepares the package for `npm publish`
- **THEN** the manifest does not contain a private-package setting that blocks publication

#### Scenario: Pi package metadata is preserved
- **WHEN** the package is installed by Pi from npm
- **THEN** the manifest exposes the Pi extension and skill resources through the `pi` package metadata
- **AND** the package keywords include `pi-package` for Pi package discovery

#### Scenario: Runtime Pi imports are peer dependencies
- **WHEN** a source file imports a Pi runtime package such as `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, or `@mariozechner/pi-tui`
- **THEN** that package is declared in `peerDependencies` with a host-provided compatible range

#### Scenario: npm registry metadata is complete
- **WHEN** the package metadata is inspected on npm
- **THEN** it includes repository, issue tracker, homepage, license, and descriptive keyword metadata suitable for users evaluating the package

### Requirement: Minimal publish artifact
The npm package SHALL publish only runtime Pi resources and user-facing documentation required to install and use PiRelay.

#### Scenario: Publish dry-run is inspected
- **WHEN** a maintainer runs `npm pack --dry-run`
- **THEN** the reported tarball contents include the package manifest, README, documentation, extension files, skill files, and license
- **AND** the tarball contents exclude local agent state, OpenSpec change/spec files, tests, `node_modules`, and other development-only artifacts

#### Scenario: Required runtime files are included
- **WHEN** Pi installs the npm package
- **THEN** every file referenced by the manifest's Pi extension and skill paths is present in the installed package

### Requirement: Publish safety checks
The release workflow SHALL prevent publishing when the package fails existing quality gates.

#### Scenario: npm publish is attempted
- **WHEN** a maintainer runs `npm publish`
- **THEN** npm runs the package's publish-time safety script before publishing
- **AND** the safety script runs TypeScript typechecking and the test suite

#### Scenario: A safety check fails
- **WHEN** typechecking or tests fail during the publish-time safety script
- **THEN** publication is stopped before a package version is uploaded to npm

### Requirement: Manual release workflow
The project SHALL document manual npm publishing as the current release workflow and SHALL NOT imply that GitHub `main` branch updates publish automatically.

#### Scenario: Maintainer prepares a release
- **WHEN** a maintainer reads the release documentation
- **THEN** it explains how to verify npm authentication, run local quality checks, inspect the packed tarball, publish the package, and verify Pi installation from npm

#### Scenario: Main branch changes are merged
- **WHEN** changes are pushed or merged to the GitHub `main` branch
- **THEN** the project does not publish to npm automatically unless an explicit release automation workflow has been added and configured

#### Scenario: Future automation guidance is documented
- **WHEN** release automation is discussed in maintainer documentation
- **THEN** the documentation recommends explicit tag or GitHub release triggers rather than publishing every push to `main`

#### Scenario: Published package is verified
- **WHEN** a version has been published to npm
- **THEN** the documented workflow includes installing or running that exact version through Pi using `pi -e npm:pirelay@<version>` or an equivalent exact-version npm source

### Requirement: Semantic versioning policy
The project SHALL document and follow a semantic versioning policy for npm releases.

#### Scenario: Stable version is bumped for release
- **WHEN** a maintainer prepares a normal release
- **THEN** the maintainer chooses `patch`, `minor`, or `major` according to the documented semantic versioning policy
- **AND** the package version is changed before publishing if that version has already been published to npm

#### Scenario: Pre-1.0 version policy is applied
- **WHEN** the package version is below `1.0.0`
- **THEN** bug fixes use patch bumps
- **AND** compatible feature changes use minor bumps
- **AND** breaking changes also use minor bumps until the project declares `1.0.0` stability

#### Scenario: Stable 1.0 milestone is documented
- **WHEN** maintainers evaluate publishing `1.0.0`
- **THEN** the release policy identifies `1.0.0` as the point where installation, configuration, API, and command behavior are considered stable

#### Scenario: Prerelease is published
- **WHEN** a maintainer publishes a beta or other prerelease
- **THEN** the documented workflow uses a prerelease identifier such as `beta`
- **AND** the npm publish command uses a non-latest dist-tag such as `--tag beta`

