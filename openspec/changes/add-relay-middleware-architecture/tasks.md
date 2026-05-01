## 1. Architecture and types

- [x] 1.1 Define normalized relay inbound event, outbound event, intent, action, prompt, media, identity, route, and adapter metadata types.
- [x] 1.2 Define middleware phases for inbound preprocessing, intent/action resolution, delivery hooks, and outbound post-processing.
- [x] 1.3 Define middleware capability declarations, ordering constraints, fatal/recoverable failure behavior, and safety classifications.
- [x] 1.4 Document how this middleware layer composes with the channel adapter architecture proposal.

## 2. Pipeline runner

- [x] 2.1 Implement deterministic middleware registration and ordering.
- [x] 2.2 Implement pipeline result handling for prompt delivery, channel-only responses, internal relay actions, and blocked/error outcomes.
- [x] 2.3 Enforce authorization-before-download/transcription/extraction invariants in the pipeline.
- [x] 2.4 Add debug/audit tracing for middleware decisions without storing secrets.

## 3. Telegram behavior preservation

- [ ] 3.1 Add characterization tests for existing Telegram command, prompt, guided answer, full output, image, pause/resume, and callback behavior.
- [ ] 3.2 Move Telegram command/action parsing behind middleware-compatible normalized events.
- [ ] 3.3 Move existing media validation/download and latest-output formatting into built-in middleware modules or adapters without changing user-visible behavior.
- [ ] 3.4 Preserve `/telegram-tunnel` compatibility, current config paths, and existing binding metadata.

## 4. Runtime and broker integration

- [ ] 4.1 Update in-process runtime to invoke the middleware pipeline for inbound and outbound interactions.
- [ ] 4.2 Update broker runtime and broker process to exchange normalized pipeline events/results over IPC.
- [ ] 4.3 Add IPC versioning or compatibility checks for middleware envelope evolution.
- [ ] 4.4 Ensure stale, offline, paused, unauthorized, and revoked states are handled consistently across runtimes.

## 5. Accessibility readiness

- [ ] 5.1 Add extension points required by future audio accessibility middleware: audio media events, transcript prompt results, spoken-output requests, repeat/read-last actions, and confirmation-needed actions.
- [x] 5.2 Add safety-classification tests for redaction-before-spoken-output and confirmation-before-sensitive-action flows.
- [x] 5.3 Document an example accessible audio middleware flow without implementing STT/TTS in this change.

## 6. Documentation and validation

- [x] 6.1 Update architecture documentation to describe adapters, middleware, relay core, and Pi session boundaries.
- [x] 6.2 Update README and developer docs with the high-level extension/middleware model.
- [x] 6.3 Add unit tests for middleware ordering, capability fallback, recoverable/fatal failures, safety classification, and channel capability fallback.
- [ ] 6.4 Run typecheck and the full test suite.
