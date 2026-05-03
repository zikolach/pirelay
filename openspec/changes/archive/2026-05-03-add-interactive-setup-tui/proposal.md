## Why

PiRelay setup currently returns dense text guidance even when Pi is running with an interactive TUI. As Telegram, Discord, Slack, and future messengers gain different setup requirements, users need a guided, inspectable setup surface that shows readiness, next steps, QR/invite helpers, and safe copy-paste snippets without losing the plain-text fallback.

## What Changes

- Add an interactive TUI setup wizard for `/relay setup <messenger>` when the current Pi context has UI support.
- Support Telegram, Discord, Slack, and future messenger setup through a shared wizard model with adapter-specific checklist sections.
- Preserve existing non-interactive setup output for headless/no-UI contexts and error fallback paths.
- Make Discord onboarding especially clear by surfacing bot token, Application ID/clientId, Message Content Intent, shared-server/DM reachability, QR invite/open link availability, and allow-list/trusted-user safety.
- Make Telegram onboarding show bot token readiness, BotFather guidance, allow-list/trusted-user safety, and pairing next steps.
- Make Slack onboarding show bot token, signing secret, workspace boundary, event mode, allow-list safety, and DM/channel-mode warnings.
- Keep setup diagnostics secret-safe: never print bot tokens, signing secrets, OAuth secrets, peer secrets, pairing codes, hidden prompts, tool internals, or transcripts.

## Capabilities

### New Capabilities
- `relay-setup-tui`: interactive and fallback setup wizard behavior for messenger onboarding.

### Modified Capabilities
- `relay-channel-adapters`: adapter setup metadata and readiness hints become part of the first-class adapter contract.

## Impact

- Affected code: `extensions/relay/config/setup.ts`, new focused setup wizard model/UI modules under `extensions/relay/config/` and/or `extensions/relay/ui/`, local command handling in `extensions/relay/runtime/extension-runtime.ts`, adapter setup metadata where needed, and tests.
- Affected user APIs: `/relay setup <messenger>` gains an interactive TUI when available but keeps plain-text fallback behavior.
- Affected docs: README and setup/config/adapters documentation should describe the interactive wizard and headless fallback.
- Dependencies: no new runtime dependencies expected; use Pi TUI primitives and existing QR rendering helpers.
