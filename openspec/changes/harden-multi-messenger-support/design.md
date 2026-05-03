## Context

PiRelay has grown from a Telegram tunnel into a multi-messenger relay, but much of the runtime still carries Telegram-shaped assumptions: directory names, command names, config keys, state records, broker code, middleware naming, callback handling, and tests. Discord is now expected to behave as a first-class live messenger, and Slack/future adapters should plug into the same architecture without duplicating Telegram-specific control flow.

The hardest topology requirement is that users may run Pi on several machines while reusing the same bot/account. Some platforms cannot safely have multiple independent pollers for one bot token, so PiRelay needs one broker per machine plus bot-scoped ingress ownership and cross-machine route federation instead of every broker independently polling every configured token.

## Goals / Non-Goals

**Goals:**
- Make `/relay` and PiRelay naming canonical across local commands, docs, skill names, package resources, config, state, and diagnostics.
- Remove old `/telegram-tunnel` user-facing compatibility rather than preserve it indefinitely.
- Model Telegram, Discord, Slack, and future messengers as peer `MessengerAdapter` implementations with shared route, pairing, command, notification, media, and action semantics.
- Run exactly one PiRelay broker per machine, hosting all enabled local messenger adapters and all local Pi session routes.
- Allow the same bot/account configuration to exist on multiple machines by electing one ingress owner per bot/account and federating remote routes between brokers.
- Support any local Pi session pairing to any configured messenger instance, including multiple bot instances of the same messenger kind.
- Simplify config into one namespaced PiRelay schema with shared defaults and messenger instance entries, while keeping env-variable fallback and legacy migration.
- Improve code clarity by replacing the current flat extension folder with a layered TypeScript source tree, explicit module boundaries, barrel exports where useful, and dependency direction checks.
- Preserve secret-safety and authorization-before-download/injection across all messengers.

**Non-Goals:**
- Build a hosted SaaS relay hub or require an always-on public service.
- Guarantee automatic cross-NAT peer discovery without user-provided broker peer/hub configuration.
- Implement every Slack feature if the Slack live runtime is still incomplete; the architecture must nevertheless treat Slack as a peer adapter contract.
- Preserve `/telegram-tunnel` commands, skill names, import paths, compatibility shims, or extension resource paths as supported public APIs after this breaking migration.

## Decisions

1. **Rename the package internals around `relay`, not `telegram-tunnel`, and remove the legacy folder.**
   - Decision: introduce `extensions/relay/` and messenger-neutral module names (`config`, `broker`, `runtime`, `state-store`, `session-routing`, `actions`, `formatting`, `middleware`). Keep Telegram-specific code only under a Telegram adapter/runtime module. Remove `extensions/telegram-tunnel/` entirely once canonical imports are updated; do not keep compatibility re-export shims in the shipped package.
   - Rationale: names strongly shape future changes; leaving shared code or shims under `telegram-tunnel` keeps producing accidental Telegram-only behavior and made it harder to notice duplicate Discord ingress paths.
   - Alternative: keep existing paths and only add aliases. Rejected because the user-facing namespace is being removed and compatibility aliases keep downstream code pinned to the deprecated namespace.

2. **Use a two-level messenger identity: `kind` + `instanceId`.**
   - Decision: every bot/account is addressed as `messengerRef = { kind: "telegram" | "discord" | "slack" | future, instanceId }`, with `default` as the migration target for legacy single-bot config.
   - Rationale: one messenger kind may have multiple bots, and one Pi session may pair to any of them.
   - Alternative: one config block per messenger kind. Rejected because it cannot represent multiple Telegram or Discord bots cleanly.

3. **One broker per machine, many messenger adapters per broker.**
   - Decision: a machine-local broker owns local session sockets, local state, all enabled adapter lifecycles, and broker federation connections. Pi sessions never start standalone messenger polling clients.
   - Rationale: this avoids same-machine token conflicts and gives one place for route selection, diagnostics, and migration.
   - Alternative: one broker per bot token. Rejected because it complicates local session registration and still does not solve cross-machine reuse.

4. **Bot-scoped ingress ownership with broker federation for shared bots.**
   - Decision: each messenger instance has at most one active ingress owner across the configured broker group. Non-owner brokers can still register their local session routes with the owner over an authenticated broker link so the shared bot can route prompts to sessions on other machines.
   - Rationale: Telegram long polling/webhook and Slack socket/webhook modes cannot be treated as safely multi-poller. Federation lets one bot serve sessions from multiple machines without duplicate update handling.
   - Alternatives: allow concurrent polling and deduplicate updates. Rejected because some platforms fail hard and others produce duplicate side effects. Require one global broker only. Rejected because the requirement is one broker per machine.

5. **Make shared-bot federation explicit and diagnosable.**
   - Decision: configuration supports `machine.id`, per-messenger `ingressPolicy` (`auto`, `owner`, `disabled`), optional `brokerGroup`, and authenticated `brokerPeers` or a user-provided hub endpoint. If a bot appears shared but no safe owner/federation is configured, `/relay doctor` reports a blocking error instead of silently polling.
   - Rationale: safe defaults are more important than magic discovery.
   - Alternative: infer ownership from startup order only. Rejected because it is unstable and hard to reason about after restarts.

6. **Canonical config uses namespaced messenger instances and shared defaults.**
   - Decision: config moves to `~/.pi/agent/pirelay/config.json` with `relay`, `defaults`, and `messengers.<kind>.<instanceId>` sections. Environment variables may supply secrets and overrides, including legacy variables during migration, but JSON no longer duplicates env-style top-level keys.
   - Rationale: config should scale to multiple bots and messengers without repeated top-level special cases.
   - Alternative: extend the current `TelegramTunnelConfig`. Rejected because it forces every shared option through Telegram terminology.

7. **State schema is channel-neutral and migration-only for old state.**
   - Decision: new state stores routes, bindings, pending pairings, active selection, action state, and notification preferences using messenger refs and opaque platform identities. Legacy `telegram-tunnel` binding entries are imported into the new schema, then marked migrated without copying secrets or nonces.
   - Rationale: old exported sessions must keep working where possible, but new persisted state must not encode Telegram as the root domain.

8. **Shared relay commands are semantic, adapters render them.**
   - Decision: slash/text commands such as `/status`, `/sessions`, `/use`, `/to`, `/full`, `/images`, `/abort`, `/compact`, `/disconnect`, and guided answer actions are parsed into channel-neutral intents. Each adapter decides whether to expose text commands, buttons, or platform-native interactions.
   - Rationale: equal messenger support means behavior parity, not identical platform UI.

9. **Use a layered TypeScript source layout with one-way dependencies.**
   - Decision: structure `extensions/relay/` into cohesive folders: `core/` for pure domain logic, `broker/` for machine broker and federation, `runtime/` for Pi extension lifecycle bridges, `config/`, `state/`, `commands/`, `middleware/`, `adapters/<messenger>/`, `media/`, `notifications/`, `formatting/`, `ui/`, and `testing/`. Shared modules must not import from adapter implementations; adapters may import shared contracts and helpers.
   - Rationale: the current flat folder makes ownership unclear, encourages cross-imports, and hides Telegram-specific assumptions in shared code. A layered layout makes TS boundaries and tests easier to reason about.
   - Alternatives: keep a flat folder with better filenames. Rejected because the number of modules and adapters already exceeds what a flat layout can keep clear.

10. **Make Discord's reliable baseline command surface non-slash and namespaced.**
   - Decision: Discord SHALL support text commands such as `relay status`, `relay sessions`, `relay full`, and `relay abort` as the reliable baseline in DMs. Bare slash-style messages such as `/status` remain best-effort aliases only when Discord delivers them as message text. If native Discord application commands are added, they should use one namespaced command with subcommands, such as `/relay status`, rather than many collision-prone top-level commands like `/status` or `/full`.
   - Rationale: Discord owns the `/...` UI and may route top-level slash commands to another application, reject unregistered commands, or consume the input before PiRelay receives it. Text-prefix commands avoid application-command routing and work as ordinary DM messages. A future native `/relay <subcommand>` command keeps PiRelay discoverable without colliding with other apps.
   - Alternatives: register every canonical command as a top-level Discord slash command. Rejected because it increases setup complexity, propagation/debug burden, and command-name collisions. Remove slash aliases entirely. Rejected because `/status` and similar aliases are convenient when Discord does deliver them as text.

11. **Treat messenger ingress ownership and active selection as a safety boundary.**
   - Decision: each inbound messenger event SHALL resolve to one authoritative target session before prompt injection or control execution. If duplicate live runtimes observe the same Discord DM because of legacy runtime startup, stale bindings, or same-machine multi-session polling, non-selected/non-owner runtimes must stay silent and must not inject prompts, acknowledge commands as delivered, or mutate unrelated session state.
   - Rationale: prompt delivery is a side effect. Delivering one Discord prompt to two Pi sessions can leak user intent and workspace actions across sessions, so de-duplication and persisted active selection are safety requirements, not cosmetic UX improvements.
   - Alternatives: rely on latest binding timestamps only. Rejected because a duplicated ingress event can be processed by multiple live runtimes and each runtime may choose a different online binding. Broadcast to all paired sessions. Rejected because explicit `/to` and `/sessions` selection semantics already define single-target control unless a separate fan-out policy is intentionally configured.

12. **Keep user-visible relay wording messenger-neutral unless intentionally adapter-specific.**
   - Decision: shared local and remote control responses SHALL say PiRelay/relay or the actual messenger name, not legacy "Telegram tunnel" wording. Discord text output that is meant as plain status/help text SHALL be escaped or sent in a platform-safe mode so Discord does not reinterpret underscores, backticks, headings, mentions, or bold markers.
   - Rationale: Telegram-shaped output makes users question whether the right adapter/session was disconnected and Discord Markdown can change the meaning/readability of status output.
   - Alternatives: accept legacy wording while internals are migrating. Rejected because this change explicitly removes the public `telegram-tunnel` namespace and makes all messengers first-class peers.

## Risks / Trade-offs

- **Cross-machine federation can be misconfigured** → `/relay doctor` validates machine ids, ingress ownership, duplicate tokens, peer auth, and unreachable owners; adapters refuse unsafe duplicate polling.
- **Breaking `/telegram-tunnel` may surprise existing users** → provide explicit migration docs, one-time state/config import, actionable error messages for old commands, and release notes marking the breaking change.
- **Messenger platforms differ in capabilities** → adapters declare limits and capabilities; shared behavior uses fallbacks for buttons, documents, typing, message size, and media.
- **Broker links introduce a new authorization surface** → require per-peer tokens or keys, reject unauthenticated route registration, avoid forwarding secrets, and include tests for unauthorized broker messages.
- **State migration bugs could orphan bindings** → implement idempotent migration, backups before writes, schema-version tests, and rollback by restoring the old state directory.
- **Renaming many files increases regression risk** → migrate in layers with compatibility shims only internally during the branch, then remove user-facing legacy APIs before completion.
- **Over-abstracting the new folder structure could slow feature work** → keep folders domain-oriented, avoid framework-style indirection, and require each extracted module to have a clear owner and test surface.

## Migration Plan

1. Create the new `extensions/relay/` folder structure with clear public contracts. Temporary internal shims from old paths may be used only during implementation, but must be deleted before the change is complete.
2. Add new neutral types/config/state modules while old modules still compile.
3. Implement config loader for the new schema plus legacy read-only fallback from `~/.pi/agent/telegram-tunnel/config.json` and legacy env variables.
4. Implement state migration from old Telegram binding/pairing records into neutral `messengerBindings`, excluding consumed/active pairing secrets.
5. Introduce the machine broker supervisor and route registry; wire Telegram and Discord through it as peer adapters.
6. Add broker federation protocol for route registration, prompt delivery, notifications, action requests, and offline/failover messages.
7. Move local commands to `/relay`; do not register `/telegram-tunnel` as an action surface. If Pi command discovery exposes stale local metadata, it may show only removal guidance outside the extension package, not executable compatibility behavior.
8. Rename package resources/docs/skills to PiRelay/relay names and update tests.
9. Move remaining real implementation modules out of `extensions/telegram-tunnel/`, update all imports to `extensions/relay/**`, then delete `extensions/telegram-tunnel/` from the source tree and npm package.
10. Add module-boundary tests or lint-style checks that prevent shared code from importing adapter/runtime side-effect modules and fail if `extensions/telegram-tunnel/` exists in the source tree or packaged resources.
11. Add a closed-loop messenger parity suite that exercises pairing, canonical remote commands, status, session selection, prompt injection, Pi completion/failure/abort, output retrieval, media, guided actions, restart restoration, and broker forwarding for each live adapter.
12. Add a command coverage matrix so Telegram, Discord, Slack where live, and future adapters cannot silently omit supported PiRelay commands such as `/sessions`, `/full`, or `/images`.
13. Run typecheck, test suite, and `openspec validate harden-multi-messenger-support --strict`.

Rollback: restore the previous package version and the backup of the old state directory. The migration must not delete old state until explicitly confirmed by a later cleanup release.

## Open Questions

- Should the first federation implementation support direct broker peers only, or include a minimal optional hub process in the same change?
- Which broker peer authentication format should be used initially: shared secret tokens, generated key pairs, or Pi-managed local credentials?
- Should old `/telegram-tunnel` commands be unregistered entirely, or return a one-line migration hint for one release while still not performing actions?
