# Shared-room messenger parity

PiRelay shared rooms use one dedicated machine bot/app per Pi machine in the same messenger room. Defaults remain conservative: private chats are always the safest pairing surface, and shared-room control must be explicitly enabled per platform.

Agent delegation is an additional opt-in layer for shared rooms. When enabled, authorized humans or trusted peer bots can create visible task cards with `/delegate <machine|#capability> <goal>` and control them with `/task <claim|decline|cancel|status|history> [task-id]`. Bot-authored ordinary output remains inert; only validated delegation commands/actions are machine-actionable.

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
- Shared rooms: supported for explicitly enabled channel/thread control when `allowChannelMessages`, shared-room enablement, app membership, and user authorization are configured.
- App mentions: detected and classified as local, remote, or ambiguous by user ID.
- Ordinary channel text and `relay <command>` fallback: supported after channel pairing and active-selection checks; non-target machine bots stay silent.
- Safe default: keep channel control disabled unless the app is installed in the intended room with explicit user allow-lists and a tested pairing path.

## Capability summary

- Telegram: mentions/replies/platform addressed commands/media supported; ordinary text depends on group privacy and permissions.
- Discord: ordinary text/mentions/platform text prefix/media supported when guild channel mode is enabled and authorized.
- Slack: app mentions, ordinary text, and platform command fallbacks are supported for explicitly enabled and paired channel/thread control; media parity remains narrower than private-chat flows.
