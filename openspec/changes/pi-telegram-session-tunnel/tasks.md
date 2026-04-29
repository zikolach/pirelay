## 1. Package and Configuration

- [x] 1.1 Create the Pi package structure with `package.json`, `extensions/telegram-tunnel/index.ts`, `skills/telegram-tunnel/SKILL.md`, and README/docs.
- [x] 1.2 Add runtime dependencies for Telegram Bot API access and QR generation, with Pi core packages declared as peer dependencies.
- [x] 1.3 Implement configuration loading from environment and package-local config, including bot token lookup, defaults, chmod/secret warnings, and validation errors.
- [x] 1.4 Add `/telegram-tunnel setup` to validate the bot token with `getMe`, cache the bot username, and report setup status.

## 2. Pairing Workflow

- [x] 2.1 Implement `/telegram-tunnel connect` to create an expiring single-use pairing nonce scoped to the current session id/file.
- [x] 2.2 Render a Telegram deep-link QR code and fallback URL in the Pi TUI, with non-interactive fallback text.
- [x] 2.3 Handle Telegram `/start <nonce>` updates, validate nonce/session/expiry, and collect Telegram chat/user identity.
- [x] 2.4 Implement local confirmation and optional allow-list bypass before activating a new binding.
- [x] 2.5 Implement `/telegram-tunnel disconnect` and Telegram `/disconnect` to revoke bindings and clear active routes.

## 3. Runtime Routing

- [x] 3.1 Implement the in-process Telegram polling runtime with startup/shutdown lifecycle hooks and a lock that prevents duplicate polling for the same bot token.
- [x] 3.2 Define a broker-compatible internal interface for registering routes, receiving inbound updates, and sending outbound messages.
- [x] 3.3 Register the active session route on `session_start` and unregister it on `session_shutdown`.
- [x] 3.4 Restore non-secret binding metadata from session custom entries and local state when a session is resumed.
- [x] 3.5 Return clear Telegram responses for offline, revoked, or unknown session routes.

## 4. Remote Commands and Prompt Injection

- [x] 4.1 Parse and authorize Telegram commands before any message can affect a Pi session.
- [x] 4.2 Implement `/help`, `/status`, `/summary`, `/full`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, and `/disconnect` command handlers.
- [x] 4.3 Route authorized non-command Telegram text through `pi.sendUserMessage()` as a normal prompt when idle.
- [x] 4.4 Route authorized busy-session messages through configurable `followUp` or `steer` delivery, with explicit `/steer` and `/followup` overrides.
- [x] 4.5 Add local Pi audit messages for remote Telegram actions without duplicating prompts unnecessarily.

## 5. Completion Notifications and Output Retrieval

- [x] 5.1 Subscribe to Pi agent/message lifecycle events and track active task state, elapsed time, final assistant text, failures, and aborts.
- [x] 5.2 Implement deterministic completion summaries/excerpts and optional LLM-generated summaries behind configuration.
- [x] 5.3 Send Telegram completion, failure, and abort notifications with concise content and full-output affordances.
- [x] 5.4 Implement `/full` pagination for the latest assistant output while respecting Telegram size limits.
- [x] 5.5 Implement `/summary` for on-demand current-session or last-turn summaries.

## 6. Security, Privacy, and Resilience

- [x] 6.1 Ensure bot tokens, raw pairing nonces, and active authentication secrets are never written to session history or logs.
- [x] 6.2 Implement high-entropy nonce generation, expiry, single-use consumption, and safe redaction in UI/log output.
- [x] 6.3 Add allow-list support for Telegram user IDs and reject all unauthorized chats with no Pi injection.
- [x] 6.4 Add output redaction hooks for common secret patterns before sending Telegram notifications.
- [x] 6.5 Add Telegram send chunking, Markdown escaping or plain-text fallback, retry/backoff, and rate-limit handling.

## 7. Tests and Documentation

- [x] 7.1 Add unit tests for pairing token lifecycle, authorization, command parsing, delivery mode selection, and message chunking.
- [x] 7.2 Add integration-style tests with a mocked Telegram Bot API client and mocked Pi extension context.
- [x] 7.3 Document BotFather setup, package installation, environment/config options, QR pairing flow, commands, security limitations, and troubleshooting.
- [x] 7.4 Validate the OpenSpec change with `openspec validate pi-telegram-session-tunnel --strict`.
- [x] 7.5 Run package typecheck/tests and a manual smoke test with a real Telegram bot token before release.

## 8. Optional Multi-Process Broker Follow-up

- [x] 8.1 Implement a singleton local broker under `~/.pi/agent/telegram-tunnel/` that owns Telegram polling per bot token.
- [x] 8.2 Implement IPC between Pi extension instances and the broker for session route registration and inbound/outbound messages.
- [x] 8.3 Add `/sessions` and `/use <session>` Telegram commands for multiple concurrently registered Pi sessions.
- [x] 8.4 Add broker supervision, stale route cleanup, and migration from the in-process runtime.

## 9. Telegram Decision UX Follow-up

- [x] 9.1 Detect and persist structured choice metadata from the latest assistant output, including numbered options and explicit answer prompts.
- [x] 9.2 Improve completion notification delivery so important trailing content is not hidden by head-only truncation; use chunking, continuation messages, or explicit full-output affordances as needed.
- [x] 9.3 Add a Telegram guided answer workflow for the latest question/choice set, reusing Pi-side structured-answer semantics with inline buttons and/or question-by-question prompts.
- [x] 9.4 Add tests and documentation for long-output cropping, decision-block preservation, and Telegram answer flows.

## 10. Regression Stabilization and Test Coverage

- [x] 10.1 Reproduce and fix the local-session interactivity regression: after `/telegram-tunnel connect` and after Telegram-driven prompt/answer flows, the original Pi session must still accept normal prompts, skills, and non-built-in commands.
- [x] 10.2 Reproduce and fix Telegram activity-indicator reliability so accepted remote prompts surface recipient `typing...` status when the Telegram client supports it, with explicit fallback behavior when not observable.
- [x] 10.3 Expand parser and workflow tests for structured answers using real-world transcripts: numbered options, bullet options, mixed prose plus options, multi-question tails, malformed choices, repeated answer cycles, cancel/restart, and direct numeric replies.
- [ ] 10.4 Add integration-style tests that exercise local + remote coexistence, broker route synchronization, post-pairing local prompt submission, skill invocation after pairing, and recovery after disconnect/reconnect.
- [x] 10.5 Add manual smoke-test documentation for Telegram client behavior, including expected `typing...` visibility, local Pi session responsiveness after pairing, and guided-answer fallback behavior.
