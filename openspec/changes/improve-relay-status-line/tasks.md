## 1. Status model

- [ ] 1.1 Define a small shared helper/type for messenger status-line labels covering off, error, ready/unpaired, paired, paired conversation kind, and paused states.
- [ ] 1.2 Add read-only current-session binding lookup helpers for Telegram, Discord, and Slack using the existing state store and current route session key.
- [ ] 1.3 Ensure status labels redact or omit raw chat ids, channel ids, workspace ids, user ids, tokens, and secrets.

## 2. Runtime integration

- [ ] 2.1 Update extension runtime status updates to use the shared status-label helper instead of only `telegram: ready`, `discord: ready`, or `slack: ready`.
- [ ] 2.2 Refresh status labels after runtime startup, runtime failure, route registration, pairing completion notification, disconnect/revoke, pause/resume, and session lifecycle updates.
- [ ] 2.3 Preserve existing adapter startup/error behavior and avoid changing authorization, pairing, or message routing semantics.

## 3. Tests and validation

- [ ] 3.1 Add unit tests for status-label formatting across ready, paired, paired DM/channel, paused, off, and error states.
- [ ] 3.2 Add integration tests proving Slack/Discord/Telegram status lines distinguish ready from paired for the current session and refresh after pairing/disconnect where practical.
- [ ] 3.3 Run `npm run typecheck`.
- [ ] 3.4 Run `npm test`.
- [ ] 3.5 Run `openspec validate improve-relay-status-line --strict`.
