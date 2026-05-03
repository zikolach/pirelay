# Copilot Instructions

PiRelay is a strict TypeScript Pi package for relaying Telegram, Discord, Slack, and future messenger chats to active Pi sessions.

## What to prioritize

- Preserve authorization and privacy boundaries before prompt injection, media download, callbacks, or control actions.
- Keep persisted state backward-compatible.
- Keep messenger-specific runtime, broker, and pure helper logic separated.
- Extract shared behavior into helper modules instead of duplicating it between adapter runtimes and broker code.
- Add or update tests for behavior changes.

## TypeScript guidance

- Keep `npm run typecheck` clean under `strict` mode.
- Avoid `any` and broad type assertions.
- Use explicit domain types and `import type` where applicable.
- Put parsing/formatting/routing decisions in pure functions with tests.

## Project boundaries

- `extensions/relay/runtime/extension-runtime.ts`: Pi extension lifecycle and local `/relay` commands.
- `extensions/relay/adapters/<messenger>/`: platform-specific Telegram, Discord, Slack, and future adapter/runtime edges.
- `extensions/relay/broker/`: detached broker process, broker client bridge, route registry, ownership, and federation.
- `extensions/relay/core/`: shared contracts and pure helpers.
- `extensions/relay/config/`, `state/`, `commands/`, `middleware/`, `media/`, `notifications/`, `formatting/`, and `ui/`: focused shared relay modules.

The legacy Telegram-tunnel extension path has been removed. Do not add compatibility shims or imports there.

## Validation

For implementation PRs, expect:

- `npm run typecheck`
- `npm test`
- relevant `openspec validate <change> --strict` for OpenSpec changes

For OpenSpec work, only mark tasks complete after code, docs, and tests are done.
