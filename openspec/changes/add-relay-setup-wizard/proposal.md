## Why

Discord and Slack adapter foundations add useful multi-channel potential, but setup can become too manual: users must know which token, signing secret, allow-list, channel mode, webhook/socket mode, and pairing command belongs to each platform. PiRelay should keep the Telegram setup compatibility while giving users one guided `/relay` setup flow that validates configuration, explains missing platform-specific steps, and keeps risky channels disabled by default.

## What Changes

- Add a generic local `/relay setup <channel>` and `/relay connect <channel> [name]` flow for Telegram, Discord, and Slack while preserving `/telegram-tunnel ...` compatibility.
- Add `/relay doctor` to validate configured channels, credentials, state directory permissions, allow-lists, adapter capability limits, and common broker/webhook/socket-mode mistakes.
- Add platform-specific setup guidance output:
  - Telegram: existing token/setup guidance.
  - Discord: bot token, optional application/client id invite URL, DM-first scope, allow-list guidance.
  - Slack: bot token, signing secret, workspace id, Socket Mode/webhook expectations, DM-first scope.
- Prefer local-friendly Slack Socket Mode guidance where configured, while still validating webhook signing when webhook mode is used.
- Keep all channel credentials secret-safe: no tokens, signing secrets, OAuth tokens, or active pairing codes in persisted session history or exported docs.
- Keep channels opt-in and disabled unless configured.

## Capabilities

### New Capabilities
- `relay-setup-wizard`: defines generic setup, doctor, and platform guidance behavior for relay channels.

### Modified Capabilities
- `telegram-session-tunnel`: preserve Telegram-specific commands and add generic `/relay` channel setup/connect aliases.
- `discord-relay-adapter`: consume setup wizard/doctor diagnostics for Discord readiness.
- `slack-relay-adapter`: consume setup wizard/doctor diagnostics for Slack readiness.

## Impact

- Affected code: local command parsing, config validation helpers, setup guidance rendering, doctor diagnostics, docs, skills, tests.
- No new runtime dependencies expected.
- Existing `/telegram-tunnel setup/connect/disconnect/status` behavior must remain compatible.
- Implementation should avoid requiring live Discord/Slack network calls in unit tests; use pure diagnostics and mocked platform clients.
