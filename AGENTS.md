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

Preserve the current split under `extensions/relay/`:

- `extensions/relay/runtime/extension-runtime.ts`: Pi extension lifecycle, local commands, session event handling.
- `extensions/relay/adapters/<messenger>/`: platform-specific Telegram, Discord, Slack, and future adapter/runtime edges.
- `extensions/relay/broker/`: broker supervision, process entrypoints, route registry, ownership, federation, and broker runtime bridge.
- `extensions/relay/core/`: shared data contracts and pure domain helpers.
- `extensions/relay/config/`, `state/`, `commands/`, `middleware/`, `media/`, `notifications/`, `formatting/`, and `ui/`: focused shared relay modules.

The legacy Telegram-tunnel extension path has been removed; do not add compatibility shims or new imports there. When behavior must be shared between adapter runtimes and broker code, prefer extracting a helper module under `extensions/relay/` instead of duplicating logic.

## Safety and state rules

- Authorization must happen before prompt injection, media download, callbacks, or control actions.
- Pairing links must remain single-use and expiring.
- State schema changes must be backward-compatible with existing persisted bindings and pending pairings.
- Never store bot tokens, secrets, hidden prompts, tool internals, or full transcripts in persisted tunnel state.
- `/relay` is canonical. Do not restore `/telegram-tunnel` commands, paths, skills, or import shims; keep only explicit legacy config/state migration inputs where required.

## Testing expectations

- Add unit tests for pure helpers.
- Add runtime/integration tests for authorization, prompt routing, persisted state, media handling, and broker parity.
- For Telegram UX changes, cover both happy path and ambiguous/error states.
- For event-driven changes, define lifecycle states and safety invariants before implementation. Cover identifiers present and missing, repeated calls, partial or delayed events, authorization denial, and delivery failure where applicable.
- When multiple handlers participate in one lifecycle, test complete event sequences and assert that fallback paths preserve the same authorization, redaction, correlation, and deduplication invariants.
- Prefer small targeted tests over brittle transcript snapshots.

## OpenSpec workflow

When implementing an OpenSpec change:

1. Read the proposal, design, spec deltas, and tasks before editing code.
2. Keep changes scoped to the selected change.
3. Mark tasks complete only after code, docs, and tests are done.
4. Validate the change with `openspec validate <change> --strict`.
5. Archive only after implementation is complete and specs are synced.

## Review feedback workflow

1. Verify each comment against the current code before changing it.
2. When feedback exposes a shared invariant or lifecycle flaw, audit adjacent handlers and equivalent paths instead of patching only the cited line.
3. Add focused regression tests plus a complete lifecycle test for systemic fixes.
4. Batch related feedback, run the required checks, and perform a structured pre-review before requesting another review.
5. Re-fetch unresolved threads after pushing. Avoid repeated automated review requests after individual micro-fixes; request review once the related batch is complete and validated.

## Git workflow

- Use concise Conventional Commits-style messages.
- Do not push directly to `main` unless explicitly asked.
- Prefer PR branches for feature work.
- Do not include unrelated untracked OpenSpec proposals or local state in commits.
