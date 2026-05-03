## 1. Inventory and rename plan

- [x] 1.1 Inventory `telegram-tunnel` user-facing commands, docs, skill metadata, package resources, config paths, state paths, status keys, tests, and shared module names.
- [x] 1.2 Classify each item as remove, migrate, rename, adapter-specific Telegram code, or temporary internal shim.
- [x] 1.3 Define the new `extensions/relay/` module layout and file movement map.
- [x] 1.4 Add regression fixtures for representative legacy config and state before changing migration code.

## 2. Source structure and module boundaries

- [x] 2.1 Create `extensions/relay/` with domain folders for `core/`, `broker/`, `runtime/`, `config/`, `state/`, `commands/`, `middleware/`, `adapters/`, `media/`, `notifications/`, `formatting/`, `ui/`, and `testing/`.
- [x] 2.2 Move platform-specific Telegram, Discord, and Slack code under `adapters/<messenger>/` with platform SDK/network operations isolated at adapter edges.
- [x] 2.3 Move pure parsing, routing, selection, formatting, redaction, migration, media, and action helpers into small shared modules with focused exports.
- [x] 2.4 Define stable contract modules or deliberate barrel exports for shared types and adapter interfaces, using `import type` for type-only imports.
- [x] 2.5 Add an automated import-boundary check or unit test that prevents shared folders from importing concrete adapters, broker entrypoints, Pi runtime side effects, sockets, timers, or filesystem side-effect modules.
- [x] 2.6 Mirror the source structure in tests or use consistent test naming so module ownership is easy to find.

## 3. Neutral domain model and config

- [x] 3.1 Add messenger-neutral types for messenger refs, instance ids, platform identities, bindings, pending pairings, routes, actions, and broker peers.
- [x] 3.2 Implement the canonical PiRelay config loader for `~/.pi/agent/pirelay/config.json` with `relay`, `defaults`, and `messengers.<kind>.<instanceId>` sections.
- [x] 3.3 Implement environment fallback for secrets and overrides, including legacy env variables mapped to `default` instances with deprecation warnings.
- [x] 3.4 Remove top-level env-style JSON duplication from canonical config output.
- [x] 3.5 Add config validation for duplicate instance refs, unsafe permissions, missing credentials, invalid owner/federation settings, and unsupported adapters.
- [x] 3.6 Add unit tests for canonical config, env fallback, legacy config import, multi-instance resolution, and secret redaction.

## 4. State migration

- [x] 4.1 Implement neutral PiRelay state schema for bindings, pending pairings, active selections, action state, notification preferences, and route metadata.
- [x] 4.2 Implement idempotent migration from `~/.pi/agent/telegram-tunnel` state to `~/.pi/agent/pirelay` state.
- [x] 4.3 Preserve active non-secret legacy Telegram bindings as `telegram:default` bindings.
- [x] 4.4 Reject or expire legacy pending pairings without copying active nonces or pairing secrets.
- [x] 4.5 Create backups before writing migrated state and avoid deleting old state in this change.
- [x] 4.6 Add migration tests for active bindings, revoked bindings, labels, preferences, pending pairings, malformed state, and repeated migration runs.

## 5. Broker topology

- [x] 5.1 Implement a machine-local broker supervisor that starts one broker per configured state directory.
- [x] 5.2 Implement robust local broker socket/pid ownership and stale socket cleanup.
- [x] 5.3 Move local Pi session route registration to the machine-local broker for all messengers.
- [x] 5.4 Implement broker lifecycle ownership for all enabled local messenger instances.
- [x] 5.5 Add diagnostics and tests proving multiple same-machine Pi sessions share one broker.

## 6. Shared-bot ownership and federation

- [x] 6.1 Add machine id, broker group, ingress policy, owner machine, and broker peer config support.
- [x] 6.2 Implement bot/account fingerprinting that detects duplicate configured bot instances without printing token values.
- [x] 6.3 Enforce one active ingress owner per messenger instance and block unsafe ambiguous ownership.
- [x] 6.4 Implement authenticated broker peer handshake and route registration without forwarding secrets or transcripts.
- [x] 6.5 Implement federated prompt delivery, action delivery, notification forwarding, and offline/failure responses.
- [x] 6.6 Add tests for owner/non-owner startup, unauthorized peers, remote route delivery, remote offline handling, duplicate ingress conflicts, and failover refresh.

## 7. Adapter parity and shared relay behavior

- [x] 7.1 Rename/split shared relay core modules so Telegram-specific code remains only in the Telegram adapter/runtime.
- [x] 7.2 Update Telegram and Discord adapters to register through the same lifecycle and normalized event/outbound contracts.
- [x] 7.3 Ensure Slack adapter foundations use the same contracts even if live Slack runtime remains limited.
- [x] 7.4 Move command intent parsing, session selection, output retrieval, media validation, guided actions, and progress behavior into messenger-neutral shared code.
- [x] 7.5 Ensure adapter capability declarations include per-instance message, file, button, activity, and media limits.
- [x] 7.6 Add parity tests covering Telegram and Discord pairing, prompt routing, status, abort, full output, images, guided actions, stale actions, and adapter fallback behavior.

## 8. Remove `telegram-tunnel` public namespace

- [x] 8.1 Replace local command registration with canonical `/relay` commands only.
- [x] 8.2 Decide and implement old `/telegram-tunnel` behavior as either unregistered or a one-line migration hint with no action side effects.
- [x] 8.3 Rename extension resource paths, skill metadata, status keys, docs references, config paths, and testing instructions to PiRelay/relay naming.
- [x] 8.4 Update package manifest Pi metadata to point at the new relay extension and skill resources.
- [x] 8.5 Remove or update tests that expect `/telegram-tunnel` compatibility.

## 9. Diagnostics and documentation

- [x] 9.1 Update `/relay doctor` to report configured messenger instances, readiness, ingress ownership, broker federation, unsafe duplicate polling, missing credentials, and permission warnings.
- [x] 9.2 Update `/relay setup <messenger-ref>` and `/relay connect <messenger-ref> [label]` help for multi-instance messenger refs.
- [x] 9.3 Update README, `docs/config.md`, `docs/adapters.md`, `docs/testing.md`, and troubleshooting docs for the new config/state paths, source layout, and multi-machine topology.
- [x] 9.4 Document migration from legacy Telegram tunnel config/state and the breaking removal of `/telegram-tunnel`.
- [x] 9.5 Ensure all diagnostics and docs avoid printing tokens, signing secrets, OAuth secrets, peer secrets, hidden prompts, tool internals, or full transcripts.

## 10. Closed-loop messenger parity

- [x] 10.1 Add table-driven integration coverage for each live messenger adapter: pair/start, status, prompt injection, Pi `agent_end`, and platform completion notification.
- [x] 10.2 Add failure and no-final-assistant-response closed-loop tests for every live messenger adapter.
- [x] 10.3 Add abort closed-loop tests covering messenger abort acknowledgement plus terminal aborted notification.
- [x] 10.4 Add multi-messenger same-session tests proving Telegram and Discord notification fan-out or an explicitly configured source-only policy.
- [x] 10.5 Add restart/restore tests proving persisted Telegram and Discord bindings can run status, prompt, and completion without re-pairing or selecting stale bindings.
- [x] 10.6 Add broker parity tests for remote prompt delivery and remote completion/failure/abort notification forwarding through the ingress owner.
- [x] 10.7 Add a canonical command coverage matrix for every live adapter (Telegram, Discord, Slack where live, and future adapters) covering `/help`, `/status`, `/sessions`, `/use`, `/to`, `/alias`, `/forget`, `/progress`, `/recent`, `/summary`, `/full`, `/images`, `/send-image`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, and `/disconnect`.
- [x] 10.8 Add table-driven UX parity tests asserting every canonical command either succeeds with shared semantics or returns an explicit capability/configuration limitation; no implemented command may fall through to generic unsupported-command help.
- [x] 10.9 Extract shared status/session-list/recent-activity/full-output/image/guided-action presenters so Discord and Telegram expose the same core fields and safe human-friendly wording.
- [x] 10.10 Ensure Discord status and session-list output does not expose raw session file paths or internal storage keys by default.
- [x] 10.11 Add parity tests for `/full`, long-output fallback, `/images`, `/send-image`, guided choice/custom answers, `/steer`, `/followup`, and adapter fallback behavior where platform capabilities differ.
- [x] 10.12 Add Discord text-prefix command parsing for `relay <command>` and equivalent canonical subcommands so Discord does not depend on bare slash-message delivery.
- [x] 10.13 Update Discord help, pairing guidance, README, and testing docs to advertise `relay status`, `relay sessions`, `relay full`, and other `relay <command>` forms as the reliable Discord UX, with bare slash aliases documented as best-effort.
- [x] 10.14 Add tests proving Discord `relay <command>` forms cover the canonical command matrix and never fall through to unknown-command help for implemented commands.
- [x] 10.15 Document native Discord application commands as optional future UX using `/relay <subcommand>` rather than top-level `/status`/`/full` registrations, and add a task/spec hook before implementing registration.

## 11. Legacy folder cleanup

- [x] 11.1 Move remaining real implementation modules out of `extensions/telegram-tunnel/` into canonical `extensions/relay/` folders, including broker process/runtime, config loader, paths, state store, shared types/contracts, utilities, and setup/doctor logic.
- [x] 11.2 Replace old `extensions/telegram-tunnel/*` files with one-line or minimal re-export shims/removal guidance only where backwards-compatible imports are still needed during this change.
- [x] 11.3 Update source and tests to import canonical modules from `extensions/relay/**` instead of shared implementation from `extensions/telegram-tunnel/**`, except migration fixtures/tests and shim-boundary tests.
- [x] 11.4 Add an automated legacy-shim boundary test that fails if `extensions/telegram-tunnel/` files contain non-shim implementation logic or exceed a small documented shim allowance.
- [x] 11.5 Update docs/comments to state that `extensions/telegram-tunnel/` is not a canonical source location and exists only for migration/backwards-compatible import shims.

## 12. Discord activity indicators

- [x] 12.1 Add Discord typing activity refresh state that starts when a Discord prompt is accepted and refreshes typing at a safe cadence while the Pi turn remains non-terminal.
- [x] 12.2 Stop Discord typing refresh on completion, failure, abort, disconnect, pause, route unregister, or runtime stop, letting Discord's indicator expire naturally.
- [x] 12.3 Keep Discord typing refresh best-effort: record safe diagnostics on refresh failures without blocking prompt delivery or terminal notifications.
- [x] 12.4 Add tests for initial typing, periodic refresh during a long turn, stopping on terminal notification, and typing refresh failure handling.

## 13. Discord ingress isolation and messenger-neutral UX regressions

- [x] 13.1 Add a red regression test proving duplicated Discord ingress observed by multiple same-machine runtimes injects into exactly one active/selected Pi session and stays silent everywhere else.
- [x] 13.2 Persist active channel selection for Discord/messenger conversations in shared relay state and make all observing runtimes honor it before prompt injection, command execution, acknowledgements, or state mutation.
- [x] 13.3 Ensure Discord pairing, `/use`, `/to`, stale binding recovery, disconnect, pause/resume, unregister, restart/restore, and broker forwarding do not reintroduce latest-binding or local-runtime-only selection drift.
- [x] 13.4 Fix `/relay disconnect` and related local/remote lifecycle responses so they use PiRelay/relay or the actual messenger name and never legacy `Telegram tunnel` wording outside migration-only guidance.
- [x] 13.5 Preserve plain-text rendering on Discord by escaping or otherwise disabling Markdown/mention interpretation for status/help/diagnostics/acknowledgements while keeping intended file/button behavior.
- [x] 13.6 Add tests for the disconnect wording and Discord plain-text rendering regressions.

## 14. Complete legacy telegram-tunnel removal

- [x] 14.1 Delete `extensions/telegram-tunnel/` compatibility shims and update all source, test, package, docs, and skill references to canonical `extensions/relay/**` or PiRelay/relay names.
- [x] 14.2 Remove `skills/telegram-tunnel/` and any package metadata that could advertise `telegram-tunnel` as an installable skill, extension, command, or import path.
- [x] 14.3 Add/adjust automated boundary tests so validation fails if `extensions/telegram-tunnel/` exists, package resources reference it, or non-fixture code imports from it.
- [x] 14.4 Keep legacy config/state migration tests and fixtures only as historical input data outside shipped extension/resource paths.

## 15. Validation

- [x] 15.1 Run `npm run typecheck` and fix all strict TypeScript errors.
- [x] 15.2 Run `npm test` and fix regressions.
- [ ] 15.3 Run targeted manual smoke tests for same-machine multi-session pairing to Telegram and Discord.
- [x] 15.4 Run targeted manual or mocked smoke tests for shared-bot owner/non-owner federation.
- [x] 15.5 Run `openspec validate harden-multi-messenger-support --strict`.
- [ ] 15.6 Mark tasks complete only after code, docs, tests, and validation are done.
