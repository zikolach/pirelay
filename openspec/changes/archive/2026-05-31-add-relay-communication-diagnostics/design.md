## Context

The generic failure message “The agent finished without a final assistant response” is produced in the local extension runtime when `agent_end` is received but PiRelay cannot extract a non-empty final assistant text from the event message list. The root cause can be an upstream agent/LLM turn ending without assistant content, a Pi event shape that PiRelay does not parse, an earlier failure that did not set `lastFailure`, or a route/notification state mismatch.

Today PiRelay has normal user-facing status, progress, state files, and broker behavior, but no end-to-end diagnostic log that correlates runtime lifecycle events, broker route updates, messenger ingress, adapter delivery, and final-output extraction decisions. Troubleshooting often requires ad-hoc code changes or live observation.

This change introduces an opt-in, secret-safe structured diagnostic log. It is intended for local operators and maintainers, not for remote messenger delivery by default.

## Goals / Non-Goals

**Goals:**

- Provide enough metadata to answer whether a missing final response came from the LLM/agent, Pi event shape, PiRelay extraction, route state, broker socket path, or messenger delivery.
- Capture structured JSONL events across the extension runtime, broker process, and adapter runtimes using shared redaction and bounded serialization helpers.
- Keep diagnostics off by default and safe to enable temporarily in production-like sessions.
- Preserve strict secret handling: no bot tokens, signing secrets, OAuth credentials, pairing secrets, hidden prompts, full transcripts, or raw tool inputs by default.
- Make log paths and retention discoverable through local diagnostics without sending logs to remote users automatically.
- Add tests around final-output extraction diagnostics, redaction, retention, file permissions, and broker/runtime event emission.

**Non-Goals:**

- No remote upload of diagnostic logs by default.
- No full transcript logging unless a future explicit, separately reviewed mode is added.
- No change to prompt routing, authorization, approval-gate decisions, or task execution semantics.
- No replacement for application metrics or hosted observability.
- No new runtime dependency unless implementation proves one is necessary and is explicitly approved.

## Decisions

### Use JSONL files under the PiRelay state directory

Diagnostic events should be appended as newline-delimited JSON to a file such as `<stateDir>/logs/communication.jsonl`. JSONL is easy to inspect with shell tools, stream during reproduction, and parse in tests. The log file and directory should use restrictive permissions.

Alternative considered: stdout/stderr broker logs. Broker processes are detached with ignored stdio, so stdout/stderr is unreliable for postmortem troubleshooting and can leak into host logs with unclear retention.

### Add a shared diagnostic logger module

Create a small shared helper under `extensions/relay/diagnostics/` or another focused module that normalizes event records, redacts strings, bounds previews, appends JSONL, and handles rotation. Runtime, broker, and adapter edges should use this helper rather than each writing ad-hoc files.

Alternative considered: logging directly at every call site. That would duplicate redaction and retention logic and increase the chance of secret leakage.

### Default to metadata-only logging

Default diagnostic events should record event kinds, timestamps, component, severity, session/route correlation IDs, message counts, roles, content shapes, text lengths, delivery status, and safe error categories. They should not record raw prompts, full assistant text, media content, file contents, or raw tool arguments.

An optional `includeContentPreview` mode may include short redacted snippets for troubleshooting extraction mismatches, but it must remain bounded, disabled by default, and clearly documented.

Alternative considered: always log content previews. This would be easier to debug but conflicts with PiRelay’s safety and state rules.

### Correlate events with stable non-secret identifiers

Each diagnostic event should include available correlation fields such as `sessionKey`, `sessionId`, `sessionLabel`, `turnId`, `routeKey`, messenger kind/instance, conversation id hash or redacted id, update/event id, and command/action kind. Use raw IDs only when they are already non-secret operational identifiers and avoid pairing secrets or tokens.

Alternative considered: only timestamped text logs. That makes multi-session, broker, and messenger fan-out problems hard to reconstruct.

### Log final assistant extraction as a first-class diagnostic event

The missing-final-response path should emit a structured event with the message count, role histogram, assistant message count, content shapes, text block counts, text length totals, extraction outcome, status decision, and any upstream error/abort indicator available on `agent_end`.

Alternative considered: only improve the user-facing error text. Better wording helps the user, but does not answer what happened.

### Surface diagnostics locally

Local `/relay doctor` should mention when communication diagnostics are enabled and where logs are written. A local-only command such as `/relay diagnostics` can show the current state, recent file path, byte size, and enablement guidance. Remote messenger commands should not send diagnostic logs automatically.

Alternative considered: remote `/diagnostics` upload. That is convenient but risky; safe file sending can be considered separately with explicit user action.

## Risks / Trade-offs

- **Risk: diagnostic logs leak sensitive data.** → Mitigation: disabled by default, metadata-only default, shared redaction, bounded previews, restrictive permissions, docs warning, and tests with token/pairing/prompt-shaped fixtures.
- **Risk: logging adds latency or breaks relay behavior.** → Mitigation: best-effort append, failures swallowed into local diagnostic status, bounded event sizes, and no blocking network calls.
- **Risk: high-volume events grow indefinitely.** → Mitigation: max file bytes, rotation or truncation, retention count, and config defaults.
- **Risk: correlation IDs reveal chat/user metadata.** → Mitigation: prefer scoped hashes or redacted forms for conversation/user IDs where feasible, and document local-only handling.
- **Risk: users expect logs to include full missing content.** → Mitigation: explain that default logs prove shape/extraction decisions without storing full transcripts; content previews are optional and bounded.

## Migration Plan

The feature is opt-in and disabled by default, so existing users do not need state or config migration. New config keys should have conservative defaults. Existing state directories can add a `logs/` subdirectory on first enabled use.

Rollback is disabling diagnostics or removing the new config; log files can be deleted manually from the state directory.

## Open Questions

- Should conversation/user IDs be logged as raw IDs, hashed IDs, or redacted labels by default?
- Should local `/relay diagnostics` be part of the first implementation, or is `/relay doctor` plus docs sufficient?
- Should content previews be controlled by a separate boolean only, or by a level such as `metadata`, `preview`, and `verbose`?
