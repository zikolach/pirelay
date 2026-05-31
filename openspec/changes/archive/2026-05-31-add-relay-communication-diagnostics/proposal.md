## Why

PiRelay can currently report generic failures such as “The agent finished without a final assistant response” without enough local evidence to distinguish an upstream agent/LLM issue from a PiRelay extraction, routing, or broker delivery issue. Operators need an opt-in, secret-safe communication diagnostic log that traces runtime, broker, adapter, and final-output extraction decisions with correlation IDs for troubleshooting.

## What Changes

- Add an opt-in communication diagnostics capability that records structured JSONL diagnostic events across local runtime lifecycle handling, broker socket communication, route state updates, messenger ingress classification, notification delivery, and final assistant response extraction.
- Add targeted trace data for the “missing final assistant response” path, including message counts, roles, content shapes, redacted/bounded text lengths, extraction outcome, status decision, and any upstream error/abort metadata available from Pi events.
- Add safe logging controls with disabled-by-default behavior, bounded retention/rotation, restrictive file permissions, and default metadata-only logging with optional redacted content previews.
- Add local troubleshooting surfaces, such as `/relay doctor` guidance or a local-only `/relay diagnostics` command, to identify the active log path and recent diagnostic status without sending logs to remote messengers by default.
- Document how to enable diagnostics temporarily, reproduce an issue, inspect the log, and redact/share excerpts safely.

## Capabilities

### New Capabilities
- `relay-communication-diagnostics`: Covers opt-in structured diagnostic logging for PiRelay runtime, broker, adapter ingress/delivery, route state transitions, final assistant extraction, retention, redaction, and troubleshooting guidance.

### Modified Capabilities
- `relay-configuration`: Add configuration and diagnostics requirements for enabling, locating, bounding, and safely reporting communication diagnostic logs.

## Impact

- Runtime: local extension lifecycle handlers record diagnostic events around agent start/end, tool execution, final extraction, route status decisions, and notification fan-out.
- Broker: broker process records safe socket, route, Telegram ingress, command/action, and notification-delivery diagnostic events.
- Adapters: Discord/Slack/Telegram runtimes may record ingress classification, delivery, and notification result metadata through shared diagnostic helpers.
- Configuration/state: new optional diagnostics configuration and/or environment overrides; logs stored under the PiRelay state directory with restrictive permissions and retention limits.
- Docs/tests: troubleshooting documentation and unit/integration tests for redaction, retention, disabled-by-default behavior, final-extraction traces, and broker/runtime event coverage.
- Dependencies: no new runtime dependency expected.
