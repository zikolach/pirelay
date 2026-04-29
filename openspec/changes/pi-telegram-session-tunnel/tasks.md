## 1. Package and Configuration

- [ ] 1.1 Create the Pi package structure with `package.json`, `extensions/telegram-tunnel/index.ts`, `skills/telegram-tunnel/SKILL.md`, and README/docs.
- [ ] 1.2 Add runtime dependencies for Telegram Bot API access and QR generation, with Pi core packages declared as peer dependencies.
- [ ] 1.3 Implement configuration loading from environment and package-local config, including bot token lookup, defaults, chmod/secret warnings, and validation errors.
- [ ] 1.4 Add `/telegram-tunnel setup` to validate the bot token with `getMe`, cache the bot username, and report setup status.

## 2. Pairing Workflow

- [ ] 2.1 Implement `/telegram-tunnel connect` to create an expiring single-use pairing nonce scoped to the current session id/file.
- [ ] 2.2 Render a Telegram deep-link QR code and fallback URL in the Pi TUI, with non-interactive fallback text.
- [ ] 2.3 Handle Telegram `/start <nonce>` updates, validate nonce/session/expiry, and collect Telegram chat/user identity.
- [ ] 2.4 Implement local confirmation and optional allow-list bypass before activating a new binding.
- [ ] 2.5 Implement `/telegram-tunnel disconnect` and Telegram `/disconnect` to revoke bindings and clear active routes.

## 3. Runtime Routing

- [ ] 3.1 Implement the in-process Telegram polling runtime with startup/shutdown lifecycle hooks and a lock that prevents duplicate polling for the same bot token.
- [ ] 3.2 Define a broker-compatible internal interface for registering routes, receiving inbound updates, and sending outbound messages.
- [ ] 3.3 Register the active session route on `session_start` and unregister it on `session_shutdown`.
- [ ] 3.4 Restore non-secret binding metadata from session custom entries and local state when a session is resumed.
- [ ] 3.5 Return clear Telegram responses for offline, revoked, or unknown session routes.

## 4. Remote Commands and Prompt Injection

- [ ] 4.1 Parse and authorize Telegram commands before any message can affect a Pi session.
- [ ] 4.2 Implement `/help`, `/status`, `/summary`, `/full`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, and `/disconnect` command handlers.
- [ ] 4.3 Route authorized non-command Telegram text through `pi.sendUserMessage()` as a normal prompt when idle.
- [ ] 4.4 Route authorized busy-session messages through configurable `followUp` or `steer` delivery, with explicit `/steer` and `/followup` overrides.
- [ ] 4.5 Add local Pi audit messages for remote Telegram actions without duplicating prompts unnecessarily.

## 5. Completion Notifications and Output Retrieval

- [ ] 5.1 Subscribe to Pi agent/message lifecycle events and track active task state, elapsed time, final assistant text, failures, and aborts.
- [ ] 5.2 Implement deterministic completion summaries/excerpts and optional LLM-generated summaries behind configuration.
- [ ] 5.3 Send Telegram completion, failure, and abort notifications with concise content and full-output affordances.
- [ ] 5.4 Implement `/full` pagination for the latest assistant output while respecting Telegram size limits.
- [ ] 5.5 Implement `/summary` for on-demand current-session or last-turn summaries.

## 6. Security, Privacy, and Resilience

- [ ] 6.1 Ensure bot tokens, raw pairing nonces, and active authentication secrets are never written to session history or logs.
- [ ] 6.2 Implement high-entropy nonce generation, expiry, single-use consumption, and safe redaction in UI/log output.
- [ ] 6.3 Add allow-list support for Telegram user IDs and reject all unauthorized chats with no Pi injection.
- [ ] 6.4 Add output redaction hooks for common secret patterns before sending Telegram notifications.
- [ ] 6.5 Add Telegram send chunking, Markdown escaping or plain-text fallback, retry/backoff, and rate-limit handling.

## 7. Tests and Documentation

- [ ] 7.1 Add unit tests for pairing token lifecycle, authorization, command parsing, delivery mode selection, and message chunking.
- [ ] 7.2 Add integration-style tests with a mocked Telegram Bot API client and mocked Pi extension context.
- [ ] 7.3 Document BotFather setup, package installation, environment/config options, QR pairing flow, commands, security limitations, and troubleshooting.
- [ ] 7.4 Validate the OpenSpec change with `openspec validate pi-telegram-session-tunnel --strict`.
- [ ] 7.5 Run package typecheck/tests and a manual smoke test with a real Telegram bot token before release.

## 8. Optional Multi-Process Broker Follow-up

- [ ] 8.1 Implement a singleton local broker under `~/.pi/agent/telegram-tunnel/` that owns Telegram polling per bot token.
- [ ] 8.2 Implement IPC between Pi extension instances and the broker for session route registration and inbound/outbound messages.
- [ ] 8.3 Add `/sessions` and `/use <session>` Telegram commands for multiple concurrently registered Pi sessions.
- [ ] 8.4 Add broker supervision, stale route cleanup, and migration from the in-process runtime.
