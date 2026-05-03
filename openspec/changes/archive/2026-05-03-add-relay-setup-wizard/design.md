## Context

PiRelay now has Telegram as a mature live runtime plus Discord/Slack adapter foundations. Without a setup wizard, each channel requires users to discover different config keys and operational constraints. A generic setup/doctor layer can make multi-channel adoption safer without changing Telegram compatibility.

## Goals / Non-Goals

**Goals:**
- Keep `/telegram-tunnel ...` fully compatible.
- Add `/relay setup <channel>`, `/relay connect <channel> [name]`, and `/relay doctor` as generic local commands.
- Provide secret-safe, actionable diagnostics for Telegram, Discord, and Slack.
- Keep Discord/Slack disabled by default and DM-first.
- Make Slack local setup guidance prefer Socket Mode when available.
- Make diagnostics pure/testable where possible.

**Non-Goals:**
- Completing production Discord/Slack platform SDK clients.
- Running Slack OAuth installation flows.
- Enabling public Discord/Slack channel control by default.
- Persisting new secret state.

## Decisions

1. **Generic command, compatible aliases.**
   `/relay` becomes the generic command surface. `/telegram-tunnel` remains a Telegram compatibility command and can internally route to the Telegram channel path.

2. **Pure diagnostics first.**
   Implement a pure setup diagnostics module that accepts loaded config and optional filesystem facts, then returns structured findings. Runtime commands only render these findings.

3. **Secret-safe findings.**
   Findings must name missing credential categories but never include token/signing-secret values. Tests should assert common token-shaped strings are not rendered.

4. **Channel-specific guidance helpers.**
   Each channel should have a small helper that returns setup status, required config keys, optional invite/manifest guidance, and pairing instruction shape.

5. **State permissions remain shared.**
   `/relay doctor` should reuse existing state/config permission checks where possible and should not add dependencies.

6. **Slack mode separation.**
   Slack guidance should distinguish Socket Mode and webhook mode. Socket Mode is simpler for local Pi, but webhook signature validation remains mandatory when webhook mode is configured.

## Risks / Trade-offs

- Adding generic commands may confuse users if help text is too broad; keep output concise and platform scoped.
- Discord invite URLs require a client/application id that is distinct from bot token; diagnostics must not infer it from secrets.
- Slack setup has many valid app configurations; the doctor should report clear minimum requirements rather than trying to validate every Slack app setting.
- Over-eager validation could block advanced users; diagnostics should warn unless a missing value is truly required for the requested action.

## Migration Plan

1. Add setup diagnostics and guidance helpers with tests.
2. Extend local `/relay` command parsing for `setup <channel>`, `connect <channel> [name]`, and `doctor`.
3. Map Telegram generic commands to existing Telegram setup/connect behavior.
4. Add Discord/Slack pairing instruction rendering using existing channel pairing helpers.
5. Update docs, config reference, testing checklist, and skill guidance.
