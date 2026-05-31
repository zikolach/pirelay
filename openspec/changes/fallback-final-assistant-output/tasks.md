## 1. Runtime fallback

- [x] 1.1 Preserve the last non-empty assistant text seen during active-turn message lifecycle events.
- [x] 1.2 Use preserved assistant text as an `agent_end` fallback when final extraction returns no text.
- [x] 1.3 Keep fallback scoped to assistant text only; do not deliver tool results or user content as final output.

## 2. Tests and validation

- [x] 2.1 Add regression tests for empty `agent_end` after non-empty assistant `message_end`.
- [x] 2.2 Add regression tests proving empty assistant updates do not wipe a prior non-empty assistant draft.
- [x] 2.3 Run `npm run typecheck`.
- [x] 2.4 Run `npm test`.
- [x] 2.5 Run `openspec validate fallback-final-assistant-output --strict`.
