# Agent Guidelines

## Project

PiRelay is a Pi package that pairs a Telegram private chat with active Pi sessions for remote prompts, status checks, summaries, media delivery, and control actions.

## Required checks

Before finishing implementation changes, run:

- `npm run typecheck`
- `npm test`
- `openspec validate <change> --strict` when working on an OpenSpec change

For docs-only changes, run the smallest relevant validation and mention what was skipped.

## TypeScript style

- Keep `strict` TypeScript clean.
- Prefer explicit domain types over `any`; avoid type assertions unless narrowing is impractical.
- Use `import type` for type-only imports.
- Keep parsing, formatting, routing, and selection logic in small pure helpers with unit tests.
- Keep side effects at the edges: Telegram API calls, broker socket I/O, Pi runtime calls, and filesystem state.
- Do not add dependencies unless they are clearly justified and needed at runtime.

## Architecture boundaries

Preserve the current split:

- `extensions/telegram-tunnel/index.ts`: Pi extension lifecycle, local commands, session event handling.
- `extensions/telegram-tunnel/runtime.ts`: in-process Telegram runtime.
- `extensions/telegram-tunnel/broker-runtime.ts`: broker client/runtime bridge.
- `extensions/telegram-tunnel/broker.js`: detached broker process and Telegram polling/routing.
- `extensions/telegram-tunnel/types.ts`: shared data contracts.
- `extensions/telegram-tunnel/utils.ts` and focused helper modules: pure/shared logic.

When behavior must be shared between `runtime.ts` and `broker.js`, prefer extracting a helper module instead of duplicating logic.

## Safety and state rules

- Authorization must happen before prompt injection, media download, callbacks, or control actions.
- Pairing links must remain single-use and expiring.
- State schema changes must be backward-compatible with existing persisted bindings and pending pairings.
- Never store bot tokens, secrets, hidden prompts, tool internals, or full transcripts in persisted tunnel state.
- Keep existing `/telegram-tunnel` commands, paths, and config compatibility unless an OpenSpec change explicitly says otherwise.

## Testing expectations

- Add unit tests for pure helpers.
- Add runtime/integration tests for authorization, prompt routing, persisted state, media handling, and broker parity.
- For Telegram UX changes, cover both happy path and ambiguous/error states.
- Prefer small targeted tests over brittle transcript snapshots.

## OpenSpec workflow

When implementing an OpenSpec change:

1. Read the proposal, design, spec deltas, and tasks before editing code.
2. Keep changes scoped to the selected change.
3. Mark tasks complete only after code, docs, and tests are done.
4. Validate the change with `openspec validate <change> --strict`.
5. Archive only after implementation is complete and specs are synced.

## Git workflow

- Use concise Conventional Commits-style messages.
- Do not push directly to `main` unless explicitly asked.
- Prefer PR branches for feature work.
- Do not include unrelated untracked OpenSpec proposals or local state in commits.
