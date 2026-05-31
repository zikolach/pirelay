## 1. Diagnostic Core

- [x] 1.1 Add pure helpers for diagnostic configuration resolution, safe log paths, enablement, retention defaults, and content-preview mode.
- [x] 1.2 Add a shared JSONL diagnostic logger with restrictive directory/file permissions, bounded event serialization, best-effort append behavior, and retention/rotation.
- [x] 1.3 Add shared redaction and preview helpers covering configured redaction patterns, token-shaped values, pairing links/codes, approval secret material, and bounded snippets.
- [x] 1.4 Add unit tests for disabled-by-default behavior, config/env resolution, safe path handling, redaction, preview bounding, file permissions, and retention.

## 2. Runtime Diagnostics

- [x] 2.1 Instrument local extension runtime lifecycle events for agent start/end, tool start/end, active route/session correlation, turn id assignment, and terminal status decisions.
- [x] 2.2 Extract final assistant response diagnostics into a pure helper that reports message counts, role histogram, assistant content shapes, text block counts, text lengths, extraction outcome, and safe missing-output reason.
- [x] 2.3 Use the final-extraction diagnostics in the `agent_end` fallback path that emits “The agent finished without a final assistant response.”
- [x] 2.4 Add tests proving missing final assistant responses produce diagnostic metadata without logging full transcripts or raw tool content.

## 3. Broker and Adapter Diagnostics

- [x] 3.1 Pass resolved diagnostic configuration to the broker process through the supervised environment without exposing secrets.
- [x] 3.2 Instrument broker socket/client, route register/unregister/update, prompt/action forwarding, and broker notification outcomes with safe correlation metadata.
- [x] 3.3 Instrument Telegram broker ingress classification, command/action handling, authorization outcome, route-selection outcome, and delivery/suppression outcomes.
- [x] 3.4 Instrument Discord and Slack runtime ingress/delivery paths with the same diagnostic event schema where applicable.
- [x] 3.5 Add tests for broker/runtime diagnostic emission, unauthorized/ignored event categories, delivery failure categories, and no raw prompt/token leakage.

## 4. Local Troubleshooting Surfaces and Docs

- [x] 4.1 Update `/relay doctor` or add a local-only `/relay diagnostics` surface that reports enablement, safe log path, retention settings, latest write status, and content-preview status.
- [x] 4.2 Document how to enable diagnostics temporarily, reproduce a missing-final-response issue, inspect final-extraction events, inspect broker/adapter events, and share redacted excerpts safely.
- [x] 4.3 Document that remote messenger commands do not automatically upload communication diagnostic logs and that log sharing requires explicit safe local action or validated file delivery.

## 5. Validation

- [x] 5.1 Run focused unit/integration tests for diagnostic helpers, runtime final extraction, broker diagnostics, and adapter diagnostic paths.
- [x] 5.2 Run `npm run typecheck`.
- [x] 5.3 Run `npm test`.
- [x] 5.4 Run `openspec validate add-relay-communication-diagnostics --strict`.
