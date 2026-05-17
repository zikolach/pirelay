# Messenger adapter architecture

PiRelay treats Telegram, Discord, Slack, and future messengers as peers behind a messenger-neutral relay core. Canonical implementation lives under `extensions/relay/`; the old Telegram-tunnel compatibility path has been removed.

## Layers

- **Messenger adapter**: owns protocol-specific I/O, update parsing, callback encoding, activity indicators, message/document delivery, buttons, and platform limits.
- **Relay core**: owns Pi session routing, authorization, pause/offline/busy behavior, prompt delivery, latest output/image retrieval, and guided answer workflows.
- **Broker**: runs once per machine, hosts enabled messenger adapters, registers local session routes, and federates routes to an ingress owner when a bot/account is shared across machines.
- **Pi session actions**: remain at the edge and perform actual Pi runtime actions such as sending a prompt, aborting, compacting, or loading a workspace image.

## Source layout

Runtime code is being organized under `extensions/relay/`:

- `core/` shared contracts and pure helpers
- `broker/` local broker, ownership, route registry, and federation
- `config/` canonical namespaced config and diagnostics
- `state/` neutral state schema and migration
- `commands/`, `middleware/`, `media/`, `notifications/`, `formatting/`, `ui/`
- `adapters/telegram/`, `adapters/discord/`, `adapters/slack/`

Shared folders must not import concrete adapter or runtime side-effect modules; adapters import shared contracts and keep platform SDK/network calls at the edge.

## Route-action safety versus binding authority

After an inbound event has passed messenger authorization and binding selection, adapters and broker code must execute fallible Pi route operations through shared route-action safety helpers in `extensions/relay/core/route-actions.ts`. These helpers provide typed outcomes for available, unavailable, already-idle, and failed operations; probe route liveness/model/workspace coherently; and roll back requester context, activity/typing/reaction hooks, shared-room output destinations, and abort flags when a route becomes unavailable.

Route-action safety does **not** decide whether a chat/channel is authorized, paused, revoked, moved, or paired. Those binding-authority decisions use the shared pure helpers in `extensions/relay/core/binding-authority.ts`. Runtime and broker edges load a state snapshot once per protected operation, then resolve Telegram or channel destinations into structured outcomes: `active`, `paused`, `revoked`, `moved`, `missing`, or `state-unavailable`. Recent route-local bindings are only bounded volatile hints: they may be used when state loaded successfully and no persisted record exists, but they must never override persisted revoked/paused/moved state or unreadable/corrupt state. Timers and deferred work should use stable destination keys captured when scheduled so cleanup does not depend on mutable route binding fields. In short: binding authority chooses whether a messenger event may target a route; route-action safety controls what happens when that selected route is stale, busy, idle, or fails during prompt/control/media execution.

## Adapter contract

Adapters declare capabilities so the relay core can choose safe fallbacks:

- inline buttons and callbacks
- text, document, and image support
- activity indicators
- private/group chat support
- text and file size limits
- accepted image MIME types

Inbound messenger events are normalized as messages or actions before relay handling. Outbound responses are normalized as text, document, image, activity, or action-answer payloads before the adapter renders them for the concrete platform.

## Canonical commands

`/relay` is canonical for local Pi commands. The old `/telegram-tunnel` local namespace has been removed.

Remote messenger adapters expose the same PiRelay command semantics wherever the platform allows text commands, slash commands, buttons, or fallbacks: `/help`, `/status`, `/sessions`, `/use`, `/to`, `/alias`, `/forget`, `/progress`, `/recent`, `/summary`, `/full`, `/images`, `/send-image`, `/send-file`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, and `/disconnect`. Local fan-out file delivery remains local-only via `/relay send-file <messenger|messenger:instance|all> <relative-path> [caption]`; remote `send-file`/`sendfile` requests are requester-scoped, validated against the workspace, and delivered only back to the same authorized conversation/thread. If an adapter cannot perform a command because of a declared capability limit, it should return an explicit limitation instead of falling through to generic unsupported-command help.

Discord is special because Discord owns the `/...` application-command UI. The reliable Discord baseline is ordinary DM text with a prefix, for example `relay status`, `relay sessions`, `relay full`, `relay abort`, and `relay pair 123-456` during pairing. PiRelay best-effort syncs one namespaced native `/relay` command with subcommands when Discord application commands are available, but setup should still advertise `relay <command>` first; bare `/status`-style Discord aliases remain best-effort conveniences only when Discord delivers them as message text, and `/start <pin>` is accepted for pairing compatibility.

Discord setup uses `discord.applicationId` / `PI_RELAY_DISCORD_APPLICATION_ID` (`clientId` aliases are accepted) from Developer Portal → General Information → Application ID to render the Discord OAuth2 bot invite URL. Discord connect uses the same ID to render a QR code to the bot profile/DM link (`https://discord.com/users/<applicationId>`). The user and bot generally need to share a server first, and Discord privacy settings must allow DMs. Short PIN pairing requires local Pi approval unless the user is configured in `allowUserIds` or has been trusted locally; the local approval can allow once, trust the user, or deny.

Examples:

```text
/relay doctor
/relay setup telegram
/relay setup discord:personal
/relay connect telegram docs
/relay connect discord:personal api
```

When Pi has an interactive TUI, `/relay setup <messenger>` opens a secret-safe setup wizard for Telegram, Discord, Slack, or future adapters. The wizard uses tab-like navigation so diagnostics, env snippets, config snippets, links/QR, and troubleshooting stay on their own tabs. Press `c` to copy placeholder env exports to the system clipboard, or `w` to write/update canonical config from currently defined env vars without persisting resolved secret values. If clipboard access is unavailable, PiRelay falls back to placing the snippet in the Pi editor. For Slack, the wizard also has an App manifest tab and `m` copy action for a ready-to-paste secret-free manifest with App Home, Socket Mode, interactivity, `/relay`, events, and scopes; reinstall/update the app after changing scopes or slash commands. In headless/no-UI contexts it falls back to the same secret-safe plain text guidance and never writes config implicitly.

## Middleware layer

Between adapters and relay core, PiRelay uses an interaction middleware pipeline for reusable messenger-neutral behavior. Middleware receives normalized relay events, runs in deterministic phases, and can produce prompts, channel-only responses, internal relay actions, blocked outcomes, or safe errors.

Authorization is an explicit pipeline boundary: middleware that downloads media, transcribes audio, extracts documents, invokes callbacks, or injects prompts must not run before the identity and route are authorized.

## Multi-machine shared bots

Run one PiRelay broker per machine. If the same bot/account is configured on multiple machines, configure one ingress owner and broker federation. Non-owner brokers register session routes with the owner instead of polling or connecting to platform ingress for the same bot/account.

## Discord and Slack foundations

Discord has an opt-in live DM-first runtime backed by the Discord adapter and live client operations. Slack remains a DM-first foundation with mockable platform operations. Adapters normalize direct-message text, action callbacks, files/images, identity metadata, and platform limits into shared relay contracts. Discord guild messages and Slack channel events remain rejected by default unless explicitly enabled.

Shared-room parity is tracked in `docs/shared-room-parity.md`. Telegram supports addressed group commands and optional Bot-to-Bot Communication Mode when both BotFather bots enable it. Discord supports gated guild-channel shared rooms with text fallbacks, mentions, buttons, and delegation task cards. Slack supports explicitly enabled and paired channel/thread control with app mentions, ordinary text, `relay <command>` fallbacks, and delegation text cards; media parity remains narrower than private-chat flows.

Agent delegation is handled above adapter-specific ingress as a structured task-card/control surface. Adapters may expose buttons or text fallbacks, but they must preserve sender bot metadata, reject untrusted peers before prompt injection, ignore local-bot/self-authored events, and keep arbitrary bot-authored output inert.

## Future adapters

A new adapter should implement the messenger adapter interface, declare capabilities honestly, and avoid duplicating relay semantics. Authorization must happen before media download, transcription, prompt injection, callbacks, or control actions.
