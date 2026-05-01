## 1. Progress model and configuration

- [x] 1.1 Add progress mode, progress interval, recent-activity limit, and session alias types/configuration using the existing relay/channel type boundaries.
- [x] 1.2 Persist non-secret progress preferences and aliases in binding metadata.
- [x] 1.3 Add redaction and safe progress formatting helpers shared by in-process and broker paths.

## 2. Runtime progress delivery

- [x] 2.1 Capture safe lifecycle/tool progress events in the in-process runtime as relay-safe events rather than raw logs.
- [x] 2.2 Implement per-route progress coalescing and rate limiting.
- [x] 2.3 Stop progress loops on completion, failure, abort, pause, disconnect, and shutdown.

## 3. Dashboard and commands

- [x] 3.1 Extend `/sessions` and `/status` with dashboard details and inline actions.
- [x] 3.2 Add notification preference commands and command help.
- [x] 3.3 Add session alias command support.
- [x] 3.4 Add recent-activity retrieval command/action.

## 4. Broker parity

- [x] 4.1 Mirror progress event transport, preferences, dashboard actions, aliases, and recent activity through `broker-runtime.ts` and `broker.js` IPC.
- [x] 4.2 Add stale/offline callback handling for new dashboard actions while preserving protocol version checks.

## 5. Tests and docs

- [x] 5.1 Add tests for rate limiting, coalescing, redaction, quiet/verbose modes, and lifecycle cleanup.
- [x] 5.2 Add tests for dashboard actions, aliases, recent activity, stale callbacks, broker parity, and broker process smoke behavior with polling disabled.
- [x] 5.3 Update README, config docs, testing docs, and Telegram tunnel skill docs.
- [x] 5.4 Run typecheck and the full test suite.
