## 1. Manifest Metadata

- [x] 1.1 Remove the package publication blocker by deleting `private: true` from `package.json`.
- [x] 1.2 Add npm registry metadata to `package.json`, including `license`, `repository`, `bugs`, `homepage`, and any useful additional keywords.
- [x] 1.3 Add a root `LICENSE` file matching the package manifest license.
- [x] 1.4 Add `@mariozechner/pi-tui` to `peerDependencies` with the same host-provided range style as the other Pi runtime peers.

## 2. Publish Artifact Controls

- [x] 2.1 Add a `files` allow-list to `package.json` that includes runtime Pi resources, README, docs, and license.
- [x] 2.2 Run `npm pack --dry-run` and verify the tarball includes required extension and skill files.
- [x] 2.3 Confirm the dry-run tarball excludes OpenSpec files, tests, `.pi`, `node_modules`, and other development-only artifacts.

## 3. Publish Safety and Documentation

- [x] 3.1 Add a `prepublishOnly` script that runs `npm run typecheck && npm test`.
- [x] 3.2 Document the npm release workflow, including `npm login`/`npm whoami`, quality checks, `npm pack --dry-run`, `npm publish`, and Pi install verification.
- [x] 3.3 Update README installation guidance to include npm installation once published.

## 4. Validation

- [x] 4.1 Run `npm run typecheck`.
- [x] 4.2 Run `npm test`.
- [x] 4.3 Run `npm pack --dry-run` and capture the final expected package contents.
- [x] 4.4 Verify the documented post-publish command uses an exact-version npm source; final package-name verification is covered by 7.4.

## 5. Package Rename to PiRelay

- [x] 5.1 Re-check npm availability or ownership for `pirelay` with `npm view pirelay version` immediately before publishing.
- [x] 5.2 Rename the npm package from `pi-telegram-session-tunnel` to `pirelay` in `package.json` and `package-lock.json`.
- [x] 5.3 Update README installation examples to use `pi install npm:pirelay` and `pi -e npm:pirelay`.
- [x] 5.4 Update release documentation to use `pirelay` for `npm view`, `npm publish` context, deprecation examples, and exact-version Pi verification.
- [x] 5.5 Search for remaining `pi-telegram-session-tunnel` references and keep only intentional legacy/internal references.
- [x] 5.6 Verify `/telegram-tunnel`, `extensions/telegram-tunnel/`, `skills/telegram-tunnel/`, and `~/.pi/agent/telegram-tunnel/` remain unchanged.

## 6. Semantic Versioning and Publishing Policy

- [x] 6.1 Document semantic versioning rules in release docs, including patch/minor/major meaning and npm's no-republish rule.
- [x] 6.2 Document the pre-`1.0.0` policy: patch for bug fixes, minor for compatible features, minor for breaking changes before stable `1.0.0`.
- [x] 6.3 Document prerelease workflow using `npm version prerelease --preid beta` and `npm publish --tag beta`.
- [x] 6.4 Document that GitHub `main` branch pushes or merges do not publish automatically in the current project.
- [x] 6.5 Document future automation guidance: prefer tag or GitHub release triggers with npm Trusted Publishing or a scoped `NPM_TOKEN`, not every push to `main`.

## 7. Final Validation After Rename and Policy Updates

- [x] 7.1 Run `npm run typecheck`.
- [x] 7.2 Run `npm test`.
- [x] 7.3 Run `npm pack --dry-run` and verify the tarball reports package name `pirelay` with the expected runtime-only contents.
- [x] 7.4 Verify release docs include exact-version post-publish validation with `pi -e npm:pirelay@<version>`.
