## Why

PiRelay is currently installable only from a local checkout or git source, which makes discovery and installation harder for users. Preparing the package for npm publishing enables `pi install npm:<package>` distribution while reducing the risk of publishing development-only files or incomplete metadata.

Because the package has not been published yet, this is also the right time to align the npm package identity with the product and repository name: `pirelay`.

## What Changes

- Make the npm manifest publishable by removing the private-package guard.
- Rename the npm package identity to `pirelay` before first publication, while keeping existing internal Telegram tunnel commands and resource paths stable.
- Add complete npm metadata for repository, issue tracker, homepage, license, keywords, and author/publisher information where appropriate.
- Declare all Pi runtime packages imported by the extension as peer dependencies, including `@mariozechner/pi-tui`.
- Add a publish file whitelist so npm tarballs contain only runtime package assets and user documentation.
- Add a publish-time safety check that runs typechecking and tests before publishing.
- Document the manual npm publish workflow, npm authentication, post-publish Pi install verification, and the fact that GitHub `main` branch pushes do not publish automatically.
- Document semantic versioning policy, including pre-`1.0.0` release guidance, npm version bump commands, and prerelease/dist-tag usage.

## Capabilities

### New Capabilities
- `npm-distribution`: Defines requirements for safely packaging, publishing, versioning, and verifying PiRelay as an npm-distributed Pi package.

### Modified Capabilities

## Impact

- Affected files: `package.json`, `package-lock.json`, `README.md`, root license file, and/or documentation under `docs/`.
- Affected systems: npm registry publishing, Pi package installation via `npm:` source, local contributor release workflow.
- The public npm install source changes to `npm:pirelay` before first publication.
- Existing Telegram runtime behavior, `/telegram-tunnel` commands, extension paths, skill paths, and local config paths are not intended to change in this change.
