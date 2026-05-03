## Context

`/relay setup <messenger>` currently emits plain text guidance. That is useful in logs/headless contexts, but PiRelay is normally used inside Pi's interactive TUI where users can benefit from a checklist, selectable actions, QR/invite links, and copy-paste snippets. Discord setup in particular now has several moving parts: bot token, Application ID/clientId, Message Content Intent, shared-server/DM reachability, allow-list/trusted-user safety, and QR-based pairing.

Pi already exposes `ctx.ui.custom()` and TUI components. `/relay connect telegram` and Discord QR pairing already use custom QR screens, so setup can follow the same UI edge pattern while keeping setup facts and readiness computation pure/testable.

## Goals / Non-Goals

**Goals:**
- Provide an interactive `/relay setup <messenger>` TUI for Telegram, Discord, Slack, and future messengers when `ctx.hasUI` is true.
- Preserve current plain-text setup guidance for headless/no-UI contexts and as a fallback if custom UI fails.
- Model setup as a shared checklist/action data structure so adapter-specific setup requirements do not sprawl through runtime code.
- Keep all setup output secret-safe and avoid writing tokens or secrets from the first TUI version.
- Let users inspect relevant links/snippets: BotFather, Discord Developer Portal, Discord invite/QR when clientId exists, Slack app setup, config/env snippets, and doctor output.

**Non-Goals:**
- Build a full credential editor that stores bot tokens, signing secrets, OAuth secrets, or peer secrets.
- Launch browsers or mutate external messenger developer settings automatically.
- Replace `/relay doctor`; the wizard can summarize or invoke doctor-like diagnostics, but doctor remains the detailed diagnostic command.
- Implement native Discord or Slack app-command registration.

## Decisions

1. **Split setup into a pure wizard model and a TUI renderer.**
   - Decision: add a pure setup wizard model that returns title, status, checklist items, actions, links, snippets, warnings, and next-step text for a messenger. The runtime renders that model with a custom TUI component when UI is available; headless mode renders the existing plain text guidance.
   - Rationale: tests can assert readiness and action content without terminal rendering, and future messenger adapters can contribute setup metadata without adding runtime branches.
   - Alternative: hard-code all UI in `extension-runtime.ts`. Rejected because setup is already shared config/diagnostic logic and runtime should remain an edge.

2. **Use read-only/copy-paste setup actions first.**
   - Decision: first version offers selectable panels such as checklist, config snippet, invite/QR, troubleshooting, and doctor summary, but does not write secrets to config.
   - Rationale: setup config may be env-managed, symlinked, read-only, or secret-managed; secret mutation increases risk. Copy-paste snippets are safer and sufficient for onboarding.
   - Alternative: prompt for tokens and write config. Deferred until secret storage semantics are explicit.

3. **Make adapter setup metadata part of adapter capabilities.**
   - Decision: adapters may expose setup metadata/readiness hints, such as required credential categories, optional links, platform intents, DM/channel safety notes, and QR-link requirements. The shared wizard consumes this metadata alongside resolved config and diagnostics.
   - Rationale: future messengers should plug in without duplicating a giant `switch` in the runtime.
   - Alternative: keep setup guidance only in `config/setup.ts`. Acceptable temporarily but does not scale cleanly as more adapters add onboarding requirements.

4. **Render a compact keyboard-driven TUI.**
   - Decision: the wizard supports arrow/j/k navigation, Enter to switch action/panel, and Esc/q to close. It should render within terminal width, avoid overflowing lines, and fall back to text on narrow/non-interactive terminals.
   - Rationale: setup is an inspection task, not a complex form. A simple selector plus detail panel is enough.
   - Alternative: multi-step modal wizard with forms. Rejected for first iteration because most steps happen in external developer portals.

5. **Keep setup secret-safe by construction.**
   - Decision: checklist/snippet generation redacts resolved secret values and prefers env variable names (`tokenEnv`, `PI_RELAY_DISCORD_BOT_TOKEN`, etc.). Any doctor summary included in the UI uses existing redaction helpers.
   - Rationale: setup screens may be shared in screenshots or logs; no token-shaped values should appear.

## Risks / Trade-offs

- **TUI complexity could make setup brittle** → keep model pure, renderer small, and preserve plain-text fallback.
- **Users may expect the wizard to configure everything automatically** → label actions as copy-paste/open/link guidance and document that secrets are not written by the wizard.
- **Adapter metadata may duplicate existing diagnostics** → derive wizard checklist from diagnostics where possible and add adapter metadata only for setup-specific links/snippets.
- **Narrow terminals may render poorly** → wrap lines and allow fallback text output if rendering fails.
- **Discord QR/invite link may not open DMs directly** → wording must explain shared-server and DM privacy requirements rather than promising direct DM deep linking.

## Migration Plan

1. Add pure setup wizard model helpers with tests for Telegram, Discord, Slack, missing credentials, configured credentials, and secret redaction.
2. Add the TUI component under `extensions/relay/ui/` and snapshot/behavior tests for keyboard navigation where feasible.
3. Wire `/relay setup <messenger>` to use the TUI when `ctx.hasUI`, falling back to existing text guidance otherwise.
4. Update docs and tests.
5. Rollback by disabling the UI path and continuing to return existing text guidance.

## Open Questions

- Should a later change allow writing non-secret config fields such as Discord clientId from the TUI?
- Should setup actions integrate with Pi's native link-opening behavior if/when available, or only display/copy links?
