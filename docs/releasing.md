# Releasing to npm

This project publishes PiRelay as the npm package `pirelay`.

Publishing is currently **manual**. Pushing or merging to GitHub `main` does not publish to npm because this repository does not currently define a release workflow under `.github/workflows`.

## Semantic versioning

npm versions are immutable: the same version cannot be published twice. Before publishing, make sure `package.json` has a version that has not already been published.

PiRelay follows semantic versioning:

- `PATCH` (`0.1.0` → `0.1.1`): bug fixes only
- `MINOR` (`0.1.0` → `0.2.0`): backward-compatible features or meaningful compatible improvements
- `MAJOR` (`1.2.3` → `2.0.0`): breaking changes after `1.0.0`

While PiRelay is below `1.0.0`, use this pre-stable policy:

- bug fixes: patch bump, for example `0.1.0` → `0.1.1`
- compatible features: minor bump, for example `0.1.0` → `0.2.0`
- breaking changes before stable: minor bump, for example `0.1.0` → `0.2.0`

Use `1.0.0` once installation, configuration, public commands, and expected behavior are considered stable.

Use npm's version command so `package.json`, `package-lock.json`, the release commit, and the git tag stay aligned:

```bash
npm version patch   # or minor / major
```

Then push the release commit and tag:

```bash
git push
git push --tags
```

## Prereleases

For beta or other prerelease builds, use a prerelease identifier and publish with a non-`latest` dist-tag:

```bash
npm version prerelease --preid beta
npm publish --tag beta
```

Example resulting version:

```text
0.2.0-beta.0
```

Users can install the beta explicitly:

```bash
pi -e npm:pirelay@beta
```

## Before publishing

1. Confirm npm authentication:

   ```bash
   npm login
   npm whoami
   ```

2. Confirm the target package name is still available or points to this package:

   ```bash
   npm view pirelay version
   ```

   A first-time publish may return `E404`; that is expected if the package has not been published yet.

3. Run local quality checks:

   ```bash
   npm run typecheck
   npm test
   ```

4. Inspect the package contents:

   ```bash
   npm pack --dry-run
   ```

   The tarball should include only runtime package assets and user documentation, such as:

   - `package.json`
   - `README.md`
   - `LICENSE`
   - `docs/`
   - `extensions/`
   - `skills/`

   It should not include development-only files such as `.pi/`, `openspec/`, `tests/`, or `node_modules/`.

## Publish

For the current unscoped public package:

```bash
npm publish
```

`prepublishOnly` runs `npm run typecheck && npm test` automatically before npm uploads the package.

If npm asks for two-factor authentication, enter the one-time password or pass it explicitly:

```bash
npm publish --otp=<code>
```

## Verify after publishing

Install or run the exact published version through Pi:

```bash
pi -e npm:pirelay@0.1.0
```

For a later release, replace `0.1.0` with the version that was just published.

If a bad version is published, do not overwrite it. Deprecate the affected version and publish a fixed patch release:

```bash
npm deprecate pirelay@<bad-version> "Use a newer patch version."
```

## Future release automation

Automatic npm publishing can be added later with GitHub Actions, but it should be a separate explicit change. Prefer publishing from signed/approved git tags or GitHub releases, not every push to `main`.

Recommended authentication options:

- npm Trusted Publishing, if available for the repository
- a narrowly scoped `NPM_TOKEN` GitHub secret

Until such a workflow exists, `npm publish` from an authenticated maintainer machine is the release mechanism.
