# Copilot Instructions

PiRelay is a strict TypeScript Pi package for relaying Telegram chats to active Pi sessions.

## What to prioritize

- Preserve authorization and privacy boundaries before prompt injection, media download, callbacks, or control actions.
- Keep persisted state backward-compatible.
- Keep Telegram runtime, broker, and pure helper logic separated.
- Extract shared behavior into helper modules instead of duplicating it between `runtime.ts` and `broker.js`.
- Add or update tests for behavior changes.

## TypeScript guidance

- Keep `npm run typecheck` clean under `strict` mode.
- Avoid `any` and broad type assertions.
- Use explicit domain types and `import type` where applicable.
- Put parsing/formatting/routing decisions in pure functions with tests.

## Project boundaries

- `extensions/telegram-tunnel/index.ts`: Pi extension lifecycle and local `/telegram-tunnel` commands.
- `extensions/telegram-tunnel/runtime.ts`: in-process Telegram runtime.
- `extensions/telegram-tunnel/broker-runtime.ts`: broker client bridge.
- `extensions/telegram-tunnel/broker.js`: detached broker process.
- `extensions/telegram-tunnel/types.ts`: shared contracts.
- `extensions/telegram-tunnel/utils.ts` and focused helper modules: pure/shared logic.

## Validation

For implementation PRs, expect:

- `npm run typecheck`
- `npm test`
- relevant `openspec validate <change> --strict` for OpenSpec changes

For OpenSpec work, only mark tasks complete after code, docs, and tests are done.
