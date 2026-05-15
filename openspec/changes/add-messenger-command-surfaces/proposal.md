## Why

PiRelay already supports a broad remote command set, but users must learn platform-specific text forms and some messenger command pickers/menus remain unconfigured or under-documented. Adding first-class messenger command surfaces improves discoverability while preserving the safe, reliable text fallbacks needed for Discord and Slack command routing.

## What Changes

- Add a messenger-neutral command-surface model derived from the canonical PiRelay remote command registry.
- Register a Telegram bot command menu on startup using Telegram-safe command names and descriptions.
- Add an optional, namespaced Discord native application command surface such as `/relay <subcommand>` that routes to existing command handling without replacing reliable `relay <command>` text commands.
- Add a Slack slash-command surface centered on `/pirelay`, including Socket Mode/webhook payload routing and setup guidance.
- Extend the generated Slack app manifest to include the `/pirelay` command and required interactivity/event settings without secrets.
- Keep authorization before route selection, media download, prompt injection, callback execution, or control actions for every native command path.
- Add parity and safety tests proving registered/menu commands match implemented canonical commands or documented fallbacks.

## Capabilities

### New Capabilities
- `messenger-command-surfaces`: Platform command menus, native slash commands, command-name sanitization, registration safety, and text fallback behavior for Telegram, Discord, and Slack.

### Modified Capabilities
- `relay-setup-tui`: Slack setup manifest and wizard guidance must include the `/pirelay` slash-command surface and explain native-command caveats.

## Impact

- Affected code: `extensions/relay/commands/remote.ts`, Telegram API/runtime, Discord live client/runtime, Slack adapter/runtime/live client, setup wizard/manifest generation, docs, and command parity tests.
- Affected platforms: Telegram Bot API command menu, Discord application commands, Slack slash commands/manifest and Socket Mode/webhook command payloads.
- No new runtime dependencies are expected; use existing Telegram, Discord, and Slack client primitives where available.
- Security impact: all native command paths must preserve existing authorization, revocation, requester scoping, and secret-redaction boundaries.
