## Why

PiRelay can now guide Discord setup and normalize Discord adapter events, but a Discord bot cannot yet connect to Discord, receive DMs, complete pairing, or deliver Pi session responses. A live Discord runtime is needed so users can actually pair and control Pi from Discord after following `/relay setup discord`.

## What Changes

- Add a live Discord runtime/client that connects a configured bot to Discord and receives direct-message events.
- Add Discord REST delivery for text responses, typing/activity indicators, buttons/interactions where feasible, and safe file/image sends within configured limits.
- Complete Discord pairing when an authorized user sends the channel-specific `/start <code>` command in a bot DM.
- Route authorized Discord DM text and supported media into the existing relay/session flow using the Discord adapter foundation and shared state store.
- Keep Discord DM-first by default; guild-channel control remains opt-in and requires explicit `allowGuildIds`.
- Extend `/relay doctor` and docs with live Discord runtime readiness checks and Discord Developer Portal requirements.
- Do not change Telegram command compatibility or Telegram default runtime behavior.

## Capabilities

### New Capabilities
- `discord-runtime-client`: Live Discord bot runtime, pairing, authorization, inbound DM handling, outbound delivery, and lifecycle behavior.

### Modified Capabilities
- `relay-channel-adapters`: Discord adapter foundation becomes usable by a live runtime while preserving channel-neutral adapter contracts.

## Impact

- Affected code: Discord adapter/runtime modules, broker/runtime lifecycle, channel broker wiring, state-store pairing consumption, local setup/doctor diagnostics, docs, and tests.
- APIs/config: Discord config may gain runtime-specific fields such as gateway intents or client mode if needed, while preserving existing `discord.*` and `PI_RELAY_DISCORD_*` keys.
- Dependencies: likely adds a Discord client dependency such as `discord.js` unless a minimal Gateway/REST client is chosen during design.
- Safety: no Discord bot tokens, OAuth tokens, pairing secrets, message internals, or transcripts are persisted or printed; authorization happens before prompt injection or media download.
