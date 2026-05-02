## 1. Diagnostics and guidance helpers

- [ ] 1.1 Add pure relay setup diagnostics types/helpers for Telegram, Discord, Slack, state/config permissions, and secret-safe rendering.
- [ ] 1.2 Add platform-specific guidance helpers for Telegram token setup, Discord bot invite/setup, and Slack Socket Mode/webhook setup.
- [ ] 1.3 Add unit tests for diagnostics, redaction, missing credentials, unsafe channel modes, and invite/guidance output.

## 2. Local command UX

- [ ] 2.1 Extend `/relay` local command parsing for `setup <channel>`, `connect <channel> [name]`, and `doctor`.
- [ ] 2.2 Preserve `/telegram-tunnel setup/connect/disconnect/status` compatibility and map generic Telegram commands to existing behavior.
- [ ] 2.3 Add channel-specific pairing instruction rendering for Discord and Slack without persisting secrets.
- [ ] 2.4 Add tests for local command routing and unsupported channel errors.

## 3. Channel readiness and safety

- [ ] 3.1 Validate Discord guild-channel configuration requires explicit allowed guild ids when enabled.
- [ ] 3.2 Validate Slack setup distinguishes Socket Mode and webhook mode and requires signing-secret validation for webhook mode.
- [ ] 3.3 Ensure doctor output and exported session state do not include bot tokens, signing secrets, OAuth tokens, or active pairing secrets.

## 4. Documentation and validation

- [ ] 4.1 Update README, config docs, adapter docs, testing docs, and skills with simplified setup flows.
- [ ] 4.2 Add manual smoke-test checklist for `/relay doctor` and `/relay setup/connect <channel>`.
- [ ] 4.3 Run `npm run typecheck`, `npm test`, and `openspec validate add-relay-setup-wizard --strict`.
