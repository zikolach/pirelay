## 1. Wizard model and adapter setup metadata

- [x] 1.1 Add a pure setup wizard model for messenger setup readiness, checklist items, links, snippets, warnings, and next steps.
- [x] 1.2 Add Telegram wizard checklist content for bot token readiness, BotFather guidance, private-chat pairing, allow-list/trusted-user safety, and connect next step.
- [x] 1.3 Add Discord wizard checklist content for bot token, Application ID/clientId, Message Content Intent, shared-server/DM reachability, QR invite/open link, allow-list/trusted-user safety, and connect next step.
- [x] 1.4 Add Slack wizard checklist content for bot token, signing secret, workspace boundary, event mode, DM/channel safety, allow-list safety, and connect next step.
- [x] 1.5 Add adapter setup metadata hooks or helper structures so future messengers can contribute setup requirements without hard-coding everything in runtime.
- [x] 1.6 Add unit tests for setup wizard models across configured and missing-credential states, including secret redaction.

## 2. Interactive TUI component

- [x] 2.1 Implement a focused setup wizard TUI component under `extensions/relay/ui/` with checklist, actions/panels, detail text, and safe wrapping.
- [x] 2.2 Support keyboard navigation with arrow keys or `j`/`k`, Enter to select panels/actions, and Esc or `q` to close.
- [x] 2.3 Add panels/actions for config/env snippets, platform links, Discord invite/QR link when available, troubleshooting notes, and doctor summary.
- [x] 2.4 Ensure the component degrades cleanly on narrow terminals and never renders lines wider than the provided width.
- [x] 2.5 Add tests for TUI rendering and navigation behavior where practical without brittle transcript snapshots.

## 3. Runtime integration and fallback

- [x] 3.1 Wire `/relay setup <messenger>` to open the interactive setup wizard when `ctx.hasUI` is true.
- [x] 3.2 Preserve current plain-text setup guidance when UI is unavailable.
- [x] 3.3 Add safe fallback behavior when `ctx.ui.custom()` fails, notifying the user and returning plain-text guidance.
- [x] 3.4 Keep unsupported messenger setup behavior unchanged and ensure no setup wizard opens for unsupported channels.
- [x] 3.5 Add runtime/integration tests for UI setup, no-UI setup, setup UI failure fallback, and unsupported channel behavior.

## 4. Documentation and validation

- [x] 4.1 Update README and setup/config/adapters docs to describe the interactive setup wizard and headless fallback.
- [x] 4.2 Document that the wizard does not write secrets and uses copy-paste snippets/env variable names instead.
- [x] 4.3 Run `npm run typecheck` and fix strict TypeScript errors.
- [x] 4.4 Run `npm test` and fix regressions.
- [x] 4.5 Run `openspec validate add-interactive-setup-tui --strict`.
