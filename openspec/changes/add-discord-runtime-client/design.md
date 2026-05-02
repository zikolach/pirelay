## Context

PiRelay currently has a Discord adapter foundation that can normalize injected gateway-like events and send through injected operations, plus `/relay setup discord` diagnostics and pairing instruction rendering. There is no concrete Discord bot process: no Gateway connection, no REST delivery implementation, no runtime lifecycle wiring, and no path that consumes Discord `/start <code>` messages to persist a Discord binding.

Telegram remains the only production live runtime and must keep existing `/telegram-tunnel` compatibility. Discord must be opt-in, secret-safe, and DM-first; guild/channel control requires explicit configuration and authorization boundaries.

## Goals / Non-Goals

**Goals:**
- Start a configured Discord bot alongside the existing relay/broker runtime when `discord.enabled` and `discord.botToken` are configured.
- Receive Discord DMs, ignore bot/webhook/self messages, and normalize events through the existing Discord adapter contract.
- Complete Discord pairing from `/start <code>` in a DM using channel-scoped pending pairings and existing authorization helpers.
- Deliver channel responses back to Discord using REST/Gateway client operations, including chunked text, typing, files/images within limits, and button/interaction acknowledgements when supported.
- Route authorized Discord DM text through the same session state, busy delivery, progress/completion, summary, image, abort/compact, and disconnect semantics available through channel-neutral relay behavior where implemented.
- Keep credentials and active pairing secrets out of persisted session history, logs, doctor output, and exported state.
- Add unit tests for pure mapping/auth/pairing behavior and integration-style tests with mocked Discord clients.

**Non-Goals:**
- Implement Slack live runtime at the same time.
- Implement a full Discord OAuth installation flow or hosted web dashboard.
- Enable public guild-channel Pi control by default.
- Support Discord voice/audio, slash-command registration automation, or cross-machine hub mode.
- Replace Telegram as the default live runtime.

## Decisions

1. **Use a real Discord client library rather than a custom Gateway client.**
   - Decision: add `discord.js` (or a similarly maintained Discord client package if package size/API review suggests a better fit during implementation).
   - Rationale: Discord Gateway heartbeat/reconnect/session-resume, partial channels, interaction acknowledgement timing, attachments, REST rate limits, and file uploads are easy to get wrong in a custom client.
   - Alternative considered: minimal WebSocket + REST implementation. This avoids a larger dependency but increases protocol risk and test burden.

2. **Keep the existing adapter contract and add concrete operations behind it.**
   - Decision: implement a `DiscordLiveClient`/operations module that satisfies `DiscordApiOperations`, then instantiate `DiscordChannelAdapter` with those operations.
   - Rationale: existing adapter unit tests remain valuable, platform I/O stays at the edge, and mocked operations can test runtime behavior without connecting to Discord.
   - Alternative considered: embed `discord.js` directly in the adapter. This would blur adapter normalization with platform lifecycle and make tests more brittle.

3. **DM-first event policy.**
   - Decision: only direct messages can complete pairing or control Pi by default. Guild messages are rejected unless `allowGuildChannels` is true and the guild id is in `allowGuildIds`.
   - Rationale: Discord servers are multi-user spaces; Pi control must not be exposed accidentally through a public channel.
   - Alternative considered: accept guild mentions by default. Rejected because it weakens the existing authorization boundary.

4. **Channel-scoped pairing and bindings.**
   - Decision: Discord pairing consumes pending pairings with `channel: "discord"` and persists only non-secret `ChannelBinding` metadata keyed with the Discord channel prefix.
   - Rationale: prevents a Discord code from being consumed by Telegram or another channel and preserves compatibility with current Telegram binding state.

5. **Start live Discord from existing runtime lifecycle.**
   - Decision: wire Discord into the broker/runtime path only when configured, with failure surfaced through `/relay doctor` and local status warnings. Telegram startup should not fail because optional Discord is disabled.
   - Rationale: Telegram users should not pay operational cost or failure modes for unused channels.

6. **Doctor checks platform prerequisites, not live OAuth state.**
   - Decision: `/relay doctor` validates token presence, client id, DM-first/guild safety, and likely Developer Portal requirements such as bot token and message content/DM guidance. It does not make live Discord API calls unless a lightweight safe identity check is already needed for runtime startup.
   - Rationale: doctor must be fast, secret-safe, and usable offline.

## Risks / Trade-offs

- **Dependency size and API churn** → Mitigate by isolating Discord library usage in one operations module and keeping adapter/core tests independent of the library.
- **Discord privileged intent confusion** → Mitigate with explicit setup docs and doctor guidance for DM text/message content requirements; tests should verify graceful handling of empty message content.
- **Reconnect/rate-limit edge cases** → Mitigate by relying on the Discord client library and adding retry-safe outbound delivery tests with mocked failures.
- **Authorization mistakes in guild channels** → Mitigate by rejecting guild events before pairing/prompt routing unless both `allowGuildChannels` and explicit `allowGuildIds` are configured.
- **Secret leakage through diagnostics or errors** → Mitigate by redacting token-shaped strings and testing doctor/setup/runtime error output.
- **Feature parity gaps versus Telegram** → Mitigate by documenting Discord-specific limitations and implementing the most important DM text/control flow first.

## Migration Plan

1. Add the Discord runtime client dependency and a small operations wrapper.
2. Wire the operations wrapper into the channel broker/runtime only when Discord is enabled.
3. Implement Discord pairing, authorization, and normalized inbound routing with mocked-client tests.
4. Implement outbound text/activity/file/button delivery with platform-limit tests.
5. Update `/relay doctor`, README/config/adapter/testing docs, and skill guidance.
6. Rollback strategy: disable `discord.enabled` or remove the Discord bot token; Telegram runtime and `/telegram-tunnel` commands continue to work.

## Open Questions

- Should the first implementation use `discord.js` directly, or a smaller maintained Discord gateway/rest package if one is already acceptable for Pi package size?
- Should Discord slash commands be registered in a later change, or should DM text commands remain the only supported control path initially?
- Should live Discord runtime run in the detached broker process only, or also support in-process mode for tests/dev parity from day one?
