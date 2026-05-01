## 1. Progress model and configuration

- [ ] 1.1 Add progress mode, progress interval, recent-activity limit, and session alias types/configuration.
- [ ] 1.2 Persist non-secret progress preferences and aliases in binding metadata.
- [ ] 1.3 Add redaction and safe progress formatting helpers.

## 2. Runtime progress delivery

- [ ] 2.1 Capture safe lifecycle/tool progress events in the in-process runtime.
- [ ] 2.2 Implement per-route progress coalescing and rate limiting.
- [ ] 2.3 Stop progress loops on completion, failure, abort, pause, disconnect, and shutdown.

## 3. Dashboard and commands

- [ ] 3.1 Extend `/sessions` and `/status` with dashboard details and inline actions.
- [ ] 3.2 Add notification preference commands and command help.
- [ ] 3.3 Add session alias command support.
- [ ] 3.4 Add recent-activity retrieval command/action.

## 4. Broker parity

- [ ] 4.1 Mirror progress event transport, preferences, dashboard actions, aliases, and recent activity in broker runtime.
- [ ] 4.2 Add stale/offline callback handling for new dashboard actions.

## 5. Tests and docs

- [ ] 5.1 Add tests for rate limiting, coalescing, redaction, quiet/verbose modes, and lifecycle cleanup.
- [ ] 5.2 Add tests for dashboard actions, aliases, recent activity, stale callbacks, and broker parity.
- [ ] 5.3 Update README, config docs, testing docs, and Telegram tunnel skill docs.
- [ ] 5.4 Run typecheck and the full test suite.
