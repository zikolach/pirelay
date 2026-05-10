# Shared-room messenger parity

PiRelay shared rooms use one dedicated machine bot/app per Pi machine in the same messenger room. Defaults remain conservative: private chats are always the safest pairing surface, and shared-room control must be explicitly enabled per platform.

## Telegram

- Private chats: supported.
- Shared rooms: supported for group/supergroup addressed commands such as `/sessions@machine_bot`, `/use@machine_bot <session>`, and `/to@machine_bot <session> <prompt>`.
- Bot-to-Bot Communication Mode: supported as an opt-in platform setting when **both** Telegram bots enable it in BotFather. This allows bot-authored group updates to be observed where Telegram delivers them, but PiRelay still requires explicit targeting and authorization.
- Privacy-mode fallback: `/command@bot` remains the reliable user-facing fallback when ordinary group text is hidden by privacy mode.
- Loop prevention: PiRelay preserves bot-authored sender metadata and must ignore its own local bot messages.
- Live E2E: optional only; use disposable bots and a disposable test group, never production tokens or hidden prompts.

## Discord

- Private chats: supported.
- Shared rooms: supported for gated guild channels when `allowGuildChannels`, allowed guild IDs, shared-room enablement, and Message Content Intent/channel permissions are configured.
- Reliable command surfaces: `relay <command>` prefix and bot mentions. Slash-command collisions with other apps are platform-dependent, so diagnostics and docs should prefer text-prefix/mention fallbacks.
- Authorization: only configured Discord user IDs/guild IDs may control the local machine bot; non-target machine bots stay silent.

## Slack

- Private chats: supported.
- Shared rooms: partially declared at adapter level, but Discord-like channel pre-routing is not yet runtime-parity.
- App mentions: detected and classified as local, remote, or ambiguous by user ID.
- Deferred/diagnostic-only shared-room surfaces: ordinary channel text, channel command fallback, and media attachments in shared rooms. Diagnostics should say this explicitly instead of implying full Telegram/Discord parity.
- Safe default: keep channel control disabled unless an implementation adds explicit pre-routing, authorization, active selection, non-target silence, and safe response handling.

## Capability summary

- Telegram: mentions/replies/platform addressed commands/media supported; ordinary text depends on group privacy and permissions.
- Discord: ordinary text/mentions/platform text prefix/media supported when guild channel mode is enabled and authorized.
- Slack: mentions can be parsed; ordinary text/platform commands/media shared-room routing is intentionally marked unsupported until Slack runtime pre-routing is implemented.
