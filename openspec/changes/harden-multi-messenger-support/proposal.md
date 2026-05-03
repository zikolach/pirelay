## Why

Recent multi-channel refactoring left PiRelay with Telegram-shaped runtime, config, state, and command assumptions even though Discord and future messengers must be first-class peers. PiRelay needs a hardened messenger-neutral architecture that supports one local broker per machine, multiple Pi sessions per broker, and pairing any session to any configured bot without poller conflicts or namespace drift.

## What Changes

- Introduce a messenger-neutral runtime model with one authoritative local broker per machine that can host all configured messenger adapters.
- Allow each Pi session on a machine to pair with any configured messenger bot/account, including multiple bots across different messengers.
- Support the same bot token/account being configured on multiple machines without unsafe concurrent polling by using deterministic machine ownership/lease behavior and clear offline/failover reporting.
- Make Telegram, Discord, Slack, and future messengers peers behind common channel adapter, broker, pairing, routing, authorization, command, notification, media, and action contracts.
- Simplify configuration into a single PiRelay schema with namespaced `messengers.<kind>.<name>` entries and shared defaults; keep environment-variable fallback for secrets and existing deployments.
- **BREAKING**: Fully remove the old `telegram-tunnel` source/resource namespace, user-facing commands, skill resources, extension paths, package resources, and compatibility import shims; `/relay ...` and `extensions/relay/**` become the only supported public and canonical implementation surface.
- Add migration for existing Telegram tunnel config/state/bindings into the new PiRelay namespace without persisting secrets or active pairing material.
- Replace Telegram-specific implementation modules/types with messenger-neutral names where behavior is shared, leaving platform-specific code only in adapter modules.
- Restructure the TypeScript source tree into cohesive feature/domain folders instead of keeping all runtime, broker, adapter, config, state, and helper modules in one flat directory.
- Add regression tests covering multi-messenger pairing, canonical command/UX parity, multi-machine broker coordination, config migration, module boundaries, and closed-loop parity from messenger prompt through Pi completion/failure/abort notification across Telegram and Discord paths.
- Harden Discord and shared-bot ingress so a single inbound messenger event cannot be injected into multiple active Pi sessions, even when multiple same-machine runtimes or stale bindings observe the same Discord DM.
- Fix remaining Telegram-shaped UX regressions such as `/relay disconnect` saying "Telegram tunnel" for non-Telegram/messenger-neutral disconnect flows, and require adapter-safe plain-text rendering so Discord does not accidentally bold/code-format status/help text.

## Capabilities

### New Capabilities
- `relay-broker-topology`: defines machine-local broker ownership, multi-machine bot sharing, route registration, leases, and failure behavior.
- `relay-configuration`: defines the simplified namespaced PiRelay config schema, environment fallback rules, migration, and secret-safe diagnostics.
- `messenger-relay-sessions`: defines messenger-neutral pairing, routing, commands, controls, notifications, media, and action behavior across Telegram, Discord, Slack, and future adapters.
- `relay-code-architecture`: defines the maintainable TypeScript source layout, module boundaries, naming conventions, and dependency direction for PiRelay internals.

### Modified Capabilities
- `relay-channel-adapters`: make all messenger adapters first-class peers and remove Telegram compatibility requirements from the adapter contract.
- `relay-interaction-middleware`: require middleware parity across all enabled messengers instead of Telegram/broker-specific pipeline assumptions.
- `telegram-session-tunnel`: retire Telegram-specific tunnel compatibility in favor of messenger-neutral relay session requirements and migration-only behavior.
- `npm-distribution`: update packaged Pi resources, docs, and install verification to use PiRelay/relay naming rather than `telegram-tunnel` paths and commands.

## Impact

- Affected code: `extensions/telegram-tunnel/*` will be renamed/split into `extensions/relay/*` with structured subfolders such as `core/`, `broker/`, `runtime/`, `config/`, `state/`, `commands/`, `middleware/`, `adapters/<messenger>/`, `media/`, `notifications/`, `ui/`, and `testing/`; after migration, `extensions/telegram-tunnel/` is removed rather than kept as a compatibility shim folder.
- Affected user APIs: `/telegram-tunnel ...` is removed with no action side effects; `/relay setup|connect|disconnect|status|doctor ...` is canonical. Existing users must migrate imports, docs, skills, scripts, and package references to PiRelay/relay names.
- Affected config/state: default config/state directory migrates from `~/.pi/agent/telegram-tunnel` to a PiRelay namespace; legacy config and state are read for one-time migration and env fallback.
- Affected docs/skills/package metadata: README, docs, tests, skill names, Pi package resource paths, and troubleshooting instructions require updates.
- No new runtime dependencies are expected beyond messenger SDKs already justified by enabled adapters.
