## 1. Skill Metadata and Policy

- [ ] 1.1 Add remote skill invocation configuration with enabled/disabled state, allowlist/denylist, source filters, max list size, pending-input expiry, and confirmation policy placeholders.
- [ ] 1.2 Add pure helpers for filtering live Pi command metadata to remote-safe skill summaries.
- [ ] 1.3 Add pure helpers for validating skill names, matching ambiguous/unknown skills, and formatting safe list/empty/disabled responses.
- [ ] 1.4 Add unit tests for policy filtering, source labels, bounded descriptions, disabled state, ambiguity, and no-skill cases.

## 2. Route Actions and Invocation

- [ ] 2.1 Add a narrow route action for retrieving live skill command metadata from the selected session.
- [ ] 2.2 Add a route-action-safe skill invocation helper with typed outcomes for success, unavailable, disabled, filtered, confirmation-required, ambiguous, and failure states.
- [ ] 2.3 Confirm and implement the safest Pi handoff mechanism for invoking local `/skill:<name>` behavior without exposing arbitrary command execution to adapters.
- [ ] 2.4 Add tests for stale/unavailable route handling, paused route handling, busy delivery semantics, and command/prompt injection boundaries.

## 3. Pending Input and Actions

- [ ] 3.1 Add requester-scoped pending skill-input state keyed by channel, instance, conversation/thread, user, route, and skill name.
- [ ] 3.2 Add expiry, cancellation, replacement, and stale-action handling for pending skill input.
- [ ] 3.3 Add button/action callback payloads for skill selection that carry only bounded safe references.
- [ ] 3.4 Add tests proving pending input is completed only by the same authorized requester and is not routed as an ordinary prompt.

## 4. Messenger Runtime Integration

- [ ] 4.1 Add `/skills` and `/skill` parsing to Telegram and route through shared skill action helpers.
- [ ] 4.2 Add `relay skills` and `relay skill` parsing to Discord and route through shared skill action helpers.
- [ ] 4.3 Add `relay skills` and `relay skill` parsing to Slack and route through shared skill action helpers.
- [ ] 4.4 Render skill lists as buttons/menus where supported and safe text fallbacks everywhere.
- [ ] 4.5 Update help text and command usage responses for disabled, enabled, and unsupported skill states.

## 5. Broker and Middleware Parity

- [ ] 5.1 Normalize skill list, selection, pending input, cancellation, and invocation through relay middleware action types.
- [ ] 5.2 Update broker request/response paths so broker-owned routes and in-process routes produce equivalent skill behavior.
- [ ] 5.3 Add broker parity tests for authorized invocation, disabled policy, filtered skill, pending input, stale action, and offline route cases.

## 6. Command Surfaces and Documentation

- [ ] 6.1 Add `skills` and `skill` to canonical remote command metadata and platform command-surface generation.
- [ ] 6.2 Update Telegram command menu, Discord `/relay` metadata, and Slack setup metadata/tests to include skill commands or documented fallbacks.
- [ ] 6.3 Document remote skill invocation configuration, safety model, examples, and pending-input UX.
- [ ] 6.4 Update smoke-test guidance for Telegram, Discord, and Slack skill discovery/invocation.

## 7. Validation

- [ ] 7.1 Run `npm run typecheck`.
- [ ] 7.2 Run `npm test`.
- [ ] 7.3 Run `openspec validate add-remote-skill-invocation --strict`.
