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

Shared folders must not import concrete adapter implementations, broker entrypoints, Pi runtime side effects, sockets, timers, or filesystem side-effect modules except through explicit edge contracts.
