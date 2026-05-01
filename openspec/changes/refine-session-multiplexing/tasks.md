## 1. Label derivation and connect command

- [ ] 1.1 Add a session-label derivation helper with precedence: explicit connect label, Pi session name, project folder basename, session file basename, short session id.
- [ ] 1.2 Add label normalization for length, whitespace, and display-safe characters.
- [ ] 1.3 Parse optional label text from `/telegram-tunnel connect [name]`.
- [ ] 1.4 Ensure pending pairing, route registration, binding persistence, QR screen, local confirmation, and Telegram connected messages use the selected label.
- [ ] 1.5 Preserve existing saved labels on session resume unless reconnect or future rename behavior changes them.

## 2. Session list and selection UX

- [ ] 2.1 Refine `/sessions` output to be compact and include number, label, active marker, online/offline state, idle/busy state, and duplicate disambiguators.
- [ ] 2.2 Improve `/use <number|label>` matching to detect ambiguous label matches and request numeric selection instead of guessing.
- [ ] 2.3 Ensure `/use` only selects live sessions and reports offline selections clearly.
- [ ] 2.4 Keep ordinary prompt routing explicit when multiple sessions exist and no active session can be resolved.

## 3. One-shot targeting

- [ ] 3.1 Add `/to <session> <prompt>` command in broker mode.
- [ ] 3.2 Route `/to` prompts using existing text/image delivery, idle/busy behavior, activity indicators, and audit messages without changing the active session.
- [ ] 3.3 Handle missing prompt, missing selector, ambiguous selector, unauthorized users, paused sessions, and offline targets.

## 4. Notification source labels

- [ ] 4.1 Detect when a chat/user has multiple paired sessions.
- [ ] 4.2 Include source session labels in completion, failure, abort, image-availability, and future progress notifications only when useful.
- [ ] 4.3 Ensure single-session notification formatting remains concise.

## 5. Documentation and tests

- [ ] 5.1 Update README and Telegram tunnel skill docs with `/telegram-tunnel connect [name]`, default project-folder labels, `/sessions`, `/use`, and `/to`.
- [ ] 5.2 Document the one-authoritative-broker-per-bot-token invariant and defer cross-machine hub mode.
- [ ] 5.3 Add tests for label derivation, explicit labels, duplicate labels, `/sessions`, `/use`, `/to`, notification labeling, and broker parity.
- [ ] 5.4 Run typecheck and the full test suite.
