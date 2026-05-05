# PiRelay relay extension layout

This directory is the canonical source structure for the multi-messenger PiRelay refactor tracked by OpenSpec change `harden-multi-messenger-support`.

The old Telegram-tunnel compatibility folder has been removed. Canonical runtime, broker, config, state, utility, and adapter implementation code belongs here under `extensions/relay/`.

Folder ownership:

- `core/`: pure messenger-neutral domain contracts and helpers.
- `broker/`: machine-local broker, process entrypoint, ownership, and federation.
- `runtime/`: Pi extension lifecycle and session route bridge.
- `config/`: canonical PiRelay config schema, environment fallback, legacy import, diagnostics.
- `state/`: neutral state schema, store, and migration.
- `commands/`: local and remote command parsing/help.
- `middleware/`: messenger-neutral interaction pipeline.
- `adapters/<messenger>/`: platform-specific I/O and renderers.
- `media/`: inbound/outbound media validation and loading.
- `notifications/`: progress, completion, summaries, and recent activity.
- `formatting/`: platform-neutral text formatting helpers.
- `ui/`: local pairing UI and QR rendering.
- `testing/`: shared fakes and fixtures for relay tests.

## Shared-room machine-bot topology

PiRelay also supports a no-federation multi-machine topology where each machine uses its own dedicated bot/app token and all machine bots join one messenger group/channel. The shared room is the coordination surface: `/use <machine> <session>` selects the active machine session for that messenger conversation/user, `/to <machine> <session> <prompt>` sends a one-shot prompt, and non-target brokers remain silent.

This mode is distinct from broker federation. Sharing one bot/account token across unaware brokers remains unsafe; configure one ingress owner with federation for shared-token deployments. Telegram shared rooms require a group/supergroup and ordinary unaddressed prompts only work when bot privacy mode or permissions allow the bot to see group messages; otherwise use mentions or replies. Discord and Slack shared rooms should prefer text-prefix commands, mentions, or replies over collision-prone top-level slash commands.

Shared folders must not import concrete adapter implementations, broker entrypoints, Pi runtime side effects, sockets, timers, or filesystem side-effect modules except through explicit edge contracts.
