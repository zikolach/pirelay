# Implementation Plan Notes

## Inventory: current `telegram-tunnel` namespace and flat source tree

Generated from `rg "telegram-tunnel|TelegramTunnel|telegram sync|telegram:|TELEGRAM|PI_TELEGRAM|relay" package.json README.md docs skills tests extensions/telegram-tunnel` during the first implementation pass. The current tree has 62 relevant source/doc/test files and 521 namespace matches.

### User-facing commands and docs

- README still presents `/telegram-tunnel setup|connect|disconnect|status` as supported commands and says `/relay` is an alias/compatibility layer.
- `docs/config.md`, `docs/testing.md`, and `docs/adapters.md` contain old setup paths, old command names, and Telegram-first wording.
- `skills/telegram-tunnel/SKILL.md` is a Telegram-named skill and should become a PiRelay/relay skill.
- Troubleshooting references `pkill -f 'extensions/telegram-tunnel/broker.js'` and old state paths.

### Package and Pi resources

- `package.json` Pi extension metadata points to `./extensions/telegram-tunnel/index.ts`.
- Package description and keywords are Telegram-heavy.
- Skill package path is still `skills/telegram-tunnel/`.

### Config and state paths

- Default state/config path is `~/.pi/agent/telegram-tunnel` in `extensions/telegram-tunnel/paths.ts`.
- Config env vars use `TELEGRAM_BOT_TOKEN` and `PI_TELEGRAM_TUNNEL_*` as the primary path.
- Broker process env vars use `TELEGRAM_TUNNEL_BROKER_*`.
- Persisted message custom types/status keys include `telegram-tunnel-binding`, `telegram-tunnel-audit`, `telegram-tunnel-connect`, and `telegram-tunnel-sync`.

### Source modules in the flat folder

Current flat modules under `extensions/telegram-tunnel/`:

- Runtime / Pi lifecycle: `index.ts`, `runtime.ts`, `broker-runtime.ts`, `discord-runtime.ts`
- Broker process and broker helpers: `broker.js`, `channel-broker.ts`, `channel-registry.ts`
- Config/state/paths: `config.ts`, `state-store.ts`, `paths.ts`
- Shared contracts/core: `types.ts`, `channel-adapter.ts`, `relay-core.ts`, `relay-middleware.ts`, `channel-pairing.ts`
- Messenger adapters and platform I/O: `telegram-adapter.ts`, `telegram-api.ts`, `telegram-actions.ts`, `telegram-format.ts`, `discord-adapter.ts`, `discord-live-client.ts`, `slack-adapter.ts`
- Shared behavior/helpers: `answer-workflow.ts`, `commands.ts`, `progress.ts`, `qr.ts`, `relay-setup.ts`, `relay-telegram-middleware.ts`, `session-multiplexing.ts`, `summary.ts`, `utils.ts`

### Tests

- Tests mirror many flat filenames in `tests/*.test.ts`.
- Broker tests reference `extensions/telegram-tunnel/broker.js` and `TELEGRAM_TUNNEL_BROKER_*`.
- Telegram command/config/runtime tests assume `/telegram-tunnel` compatibility.

## Classification

### Remove as public API

- `/telegram-tunnel setup|connect|disconnect|status` action behavior.
- User-facing `telegram-tunnel` extension, skill, status, and widget naming.
- Documentation stating Telegram is default/compatibility baseline or `/relay` is an alias.

### Migrate

- Legacy config from `~/.pi/agent/telegram-tunnel/config.json` to `~/.pi/agent/pirelay/config.json`.
- Legacy state from `~/.pi/agent/telegram-tunnel/state.json` to neutral PiRelay state.
- Legacy Telegram bindings to `messengers.telegram.default` / `telegram:default` binding refs.
- `PI_TELEGRAM_TUNNEL_*`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_TUNNEL_BROKER_*` env handling to compatibility fallback with warnings.

### Rename / move to shared relay code

- `channel-adapter.ts` -> `core/adapter-contracts.ts` or `core/messenger-contracts.ts`.
- `relay-core.ts` -> `core/relay-core.ts`.
- `relay-middleware.ts` -> `middleware/pipeline.ts`.
- `commands.ts` and neutral command parsing from `relay-setup.ts` -> `commands/`.
- `session-multiplexing.ts` -> `core/session-selection.ts`.
- `progress.ts`, `summary.ts`, latest output helpers -> `notifications/` and `core/`.
- media and image helpers currently in `utils.ts` -> `media/`.
- generic redaction/time/hash helpers -> `core/` or `formatting/`.

### Keep platform-specific

- Telegram Bot API, callback keyboard rendering, Telegram markdown/chat formatting, and Telegram polling details under `adapters/telegram/`.
- Discord normalization, live client, gateway/REST operations, and Discord runtime under `adapters/discord/`.
- Slack adapter foundations under `adapters/slack/`.

### Temporary internal shims

- Old import paths can temporarily re-export new modules while tests and call sites are moved.
- User-facing `/telegram-tunnel` commands should not remain functional; if registered for one release, they only return a migration hint.

## Target `extensions/relay/` module layout

```text
extensions/relay/
  index.ts                         # Pi extension entrypoint
  core/
    messenger-ref.ts               # kind + instance id parsing/formatting
    adapter-contracts.ts           # normalized inbound/outbound contracts
    relay-core.ts                  # prompt/control/output orchestration
    session-selection.ts           # /sessions, /use, /to resolution helpers
    actions.ts                     # shared action state and stale checks
    redaction.ts
    time.ts
  broker/
    entry.js                       # detached broker process entrypoint
    supervisor.ts                  # one broker per machine/state dir
    local-client.ts                # Pi session <-> local broker bridge
    protocol.ts                    # local/federated message contracts
    federation.ts                  # peer handshake/route federation
    ownership.ts                   # ingress owner decisions
  runtime/
    extension-runtime.ts           # Pi lifecycle glue
    session-route.ts               # route creation/registration from Pi context
  config/
    loader.ts
    schema.ts
    env.ts
    legacy.ts
    diagnostics.ts
  state/
    store.ts
    schema.ts
    migration.ts
    legacy-telegram.ts
  commands/
    local.ts
    remote.ts
    help.ts
    parser.ts
  middleware/
    pipeline.ts
    telegram-compat-parser.ts      # only if needed as adapter-scoped parser
  adapters/
    telegram/
      adapter.ts
      api.ts
      actions.ts
      formatting.ts
      polling.ts
    discord/
      adapter.ts
      live-client.ts
      runtime.ts
    slack/
      adapter.ts
  media/
    inbound-images.ts
    latest-images.ts
    workspace-files.ts
  notifications/
    progress.ts
    completion.ts
    summary.ts
    recent-activity.ts
  formatting/
    markdown.ts
    truncation.ts
  ui/
    pairing-screen.ts
    qr.ts
  testing/
    fixtures.ts
    fake-adapters.ts
```

## File movement map

| Current file | Target area |
| --- | --- |
| `index.ts` | `runtime/extension-runtime.ts` plus new `index.ts` entry |
| `broker.js` | `broker/entry.js` |
| `broker-runtime.ts` | `broker/local-client.ts` |
| `runtime.ts` | `adapters/telegram/runtime.ts` or shared broker-owned runtime pieces |
| `discord-runtime.ts` | `adapters/discord/runtime.ts` |
| `channel-adapter.ts` | `core/adapter-contracts.ts` |
| `channel-broker.ts` | `broker/adapter-host.ts` |
| `channel-pairing.ts` | `core/pairing.ts` |
| `channel-registry.ts` | `core/bindings.ts` or `state/binding-keys.ts` |
| `config.ts` | `config/loader.ts`, `config/schema.ts`, `config/env.ts`, `config/legacy.ts` |
| `state-store.ts` | `state/store.ts`, `state/schema.ts`, `state/migration.ts` |
| `paths.ts` | `config/paths.ts` or `state/paths.ts` with PiRelay defaults |
| `telegram-*` | `adapters/telegram/*` |
| `discord-*` | `adapters/discord/*` |
| `slack-adapter.ts` | `adapters/slack/adapter.ts` |
| `relay-core.ts` | `core/relay-core.ts` |
| `relay-middleware.ts` | `middleware/pipeline.ts` |
| `relay-telegram-middleware.ts` | adapter-specific Telegram middleware parser or deleted after neutral commands |
| `relay-setup.ts` | `commands/help.ts`, `config/diagnostics.ts`, `commands/local.ts` |
| `commands.ts` | `commands/parser.ts` or `commands/remote.ts` |
| `session-multiplexing.ts` | `core/session-selection.ts` |
| `answer-workflow.ts` | `core/actions.ts` or `commands/guided-answers.ts` |
| `progress.ts` | `notifications/progress.ts` |
| `summary.ts` | `notifications/summary.ts` |
| `telegram-format.ts` | `adapters/telegram/formatting.ts` |
| `qr.ts` | `ui/qr.ts` |
| `utils.ts` | Split into `core/`, `media/`, `formatting/` helpers |
