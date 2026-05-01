## Context

PiRelay is a Pi package whose resources are loaded directly from TypeScript and JavaScript files via the `pi` manifest in `package.json`. The current implementation was originally named `pi-telegram-session-tunnel`, while the repository and user-facing product name are PiRelay / `pirelay`. Since the package has not been published to npm yet, the npm package can still be renamed without npm deprecation or migration overhead.

The package was initially private and lacked complete npm release metadata. A dry-run package also included development artifacts such as OpenSpec files and tests because there was no npm `files` whitelist or `.npmignore` policy.

The extension imports Pi runtime packages (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, and `@mariozechner/pi-tui`) that must remain peer dependencies so they are provided by the host Pi installation rather than bundled into this package. Runtime third-party packages (`grammy`, `proper-lockfile`, `qrcode-terminal`) remain normal dependencies.

There is currently no `.github/workflows` release automation. Merging to or pushing `main` must not be treated as an npm publish event unless a future explicit release workflow is added.

## Goals / Non-Goals

**Goals:**
- Make the package publishable to npm without changing Telegram runtime behavior.
- Use `pirelay` as the canonical npm package name before first publication.
- Ensure npm tarballs contain only runtime Pi resources and user-facing documentation.
- Ensure all imported Pi runtime packages are declared as peer dependencies.
- Add automated local safety checks so manual publishing fails when typechecking or tests fail.
- Document the release, semantic versioning, and verification workflow for maintainers.
- Clearly document that the current project does not publish automatically from GitHub `main`.

**Non-Goals:**
- Reworking the Telegram tunnel architecture, broker runtime, or command behavior.
- Renaming `/telegram-tunnel`, `extensions/telegram-tunnel/`, `skills/telegram-tunnel/`, or `~/.pi/agent/telegram-tunnel/` in this change.
- Adding a generated JavaScript build output; the package remains a JITI-loaded TypeScript Pi package.
- Implementing GitHub Actions or CI/CD release publishing in this change.
- Automating npm authentication, two-factor prompts, or npm ownership setup.

## Decisions

1. **Rename the npm package to `pirelay` before first publication.**
   - Rationale: The repository and product name are already PiRelay / `pirelay`, `pi install npm:pirelay` is easier for users, and doing this before first publish avoids npm deprecation/migration overhead.
   - Alternative considered: keep `pi-telegram-session-tunnel`. This is more descriptive of the implementation but is longer, less aligned with the product/repo, and harder to change after publication.
   - Implementation boundary: only the npm package identity and docs change. Existing Telegram commands, extension paths, skill paths, and local config paths remain unchanged for compatibility.

2. **Keep publishing manual for now; do not publish automatically from `main`.**
   - Rationale: First publication requires npm account ownership, authentication, and possibly two-factor interaction. Manual publish is explicit and safer until ownership and token/trusted-publishing policy are decided.
   - Alternative considered: GitHub Actions publishing on `main`. This risks accidental releases on ordinary merges and is not currently configured.
   - Future automation guidance: if automation is added later, prefer tag/release-triggered publishing with npm Trusted Publishing or a narrowly scoped `NPM_TOKEN`, not every push to `main`.

3. **Use semantic versioning with a documented pre-`1.0.0` policy.**
   - Rationale: npm versions are immutable and users need predictable upgrade meaning.
   - Policy: use `PATCH` for bug fixes, `MINOR` for compatible features while on `0.x`, and also `MINOR` for breaking changes before `1.0.0`. Use `MAJOR` for breaking changes after `1.0.0`.
   - First stable milestone: use `1.0.0` once install/configuration/API/commands are considered stable.
   - Prereleases: use prerelease identifiers and npm dist-tags, for example `npm version prerelease --preid beta` followed by `npm publish --tag beta`.

4. **Use `files` in `package.json` as the publish allow-list.**
   - Rationale: A positive allow-list is easier to audit than exclusions and prevents accidental publication of `openspec/`, `.pi/`, `tests/`, local state, or other future development files.
   - Alternative considered: add `.npmignore`. This is more flexible but easier to drift from the intended runtime package contents.

5. **Keep Pi packages in `peerDependencies` with `"*"` ranges.**
   - Rationale: Pi package documentation instructs extensions to peer-depend on Pi core packages instead of bundling them, avoiding duplicate host/runtime copies.
   - Alternative considered: moving Pi packages to `dependencies`. This could bundle incompatible duplicate Pi internals and is not recommended for Pi packages.

6. **Add `prepublishOnly` to run local quality gates.**
   - Rationale: npm automatically runs this before `npm publish`, providing a final guard for typecheck and tests while keeping local development commands unchanged.
   - Alternative considered: only document manual checks. This relies on maintainer discipline and is easier to skip.

## Risks / Trade-offs

- **Risk: The `pirelay` package name becomes unavailable before publication.** → Mitigation: check `npm view pirelay version` immediately before publishing; if unavailable, pause and choose a new package identity before publishing.
- **Risk: Rename documentation misses old install examples.** → Mitigation: search for `pi-telegram-session-tunnel` and update npm install/publish examples to `pirelay`, while preserving intentional internal implementation references.
- **Risk: The allow-list omits a required runtime asset.** → Mitigation: verify with `npm pack --dry-run` and install/run the packed package through Pi before publishing.
- **Risk: License metadata is added without an accompanying license file.** → Mitigation: add a root `LICENSE` file matching the `package.json` license.
- **Risk: `prepublishOnly` increases publish time or fails due to environment-specific tests.** → Mitigation: keep the script limited to existing deterministic `typecheck` and `test` commands.
- **Risk: npm version mistakes cannot be overwritten.** → Mitigation: use `npm version` commands, verify the target version before publishing, and deprecate bad versions rather than trying to overwrite them.

## Migration Plan

1. Update package metadata, including renaming the npm package to `pirelay` in `package.json` and `package-lock.json`.
2. Update README and release documentation to use `npm:pirelay` for installation and exact-version verification.
3. Document semantic versioning, prerelease, and manual publishing policy.
4. Check npm package availability or ownership with `npm view pirelay version` before first publish.
5. Run `npm run typecheck`, `npm test`, and `npm pack --dry-run`.
6. Inspect the tarball contents and optionally test a local tarball install with Pi.
7. Authenticate with npm and publish manually with `npm publish`.
8. Verify post-publish installation with `pi -e npm:pirelay@<version>`.

Rollback is limited because published npm versions cannot be overwritten. If a bad version is published, deprecate it with `npm deprecate` and publish a fixed patch version.

## Open Questions

- Should release automation be added in a future change after the first manual publication succeeds?
- If release automation is added, should it use npm Trusted Publishing or an `NPM_TOKEN` secret?
