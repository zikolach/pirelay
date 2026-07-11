## Context

Pi emits rich tool lifecycle events: `tool_call`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, and tool-result messages. PiRelay currently uses only coarse progress messages such as `Tool completed — bash`, which are safe but not useful. The live-progress coalescing change gives Telegram a mutable live message and Slack/Discord bounded snapshots, but the content being coalesced still lacks semantic value.

Tool reporting must remain safe because tool arguments can include shell commands, paths, search queries, file contents, user text, or secrets. Normal-mode progress should explain what Pi is doing without relaying tool output, raw transcripts, hidden prompts, pairing codes, chat IDs, or unbounded arguments.

## Goals / Non-Goals

**Goals:**

- Make normal-mode tool progress human-readable and compact.
- Aggregate repeated tool calls into one live status card per binding instead of many low-signal milestones.
- Summarize built-in tool intent using allowlisted fields only.
- Preserve existing progress-mode semantics: normal is low-noise, verbose is more detailed, completion-only excludes ordinary tool progress, and quiet suppresses all progress.
- Keep Telegram direct and broker edit-in-place behavior, with Slack/Discord using the same shared formatted snapshot.
- Add safety tests for redaction, argument bounding, and no tool-output leakage.

**Non-Goals:**

- Do not expose full tool output or raw command output in normal-mode progress.
- Do not build a full remote terminal transcript or per-tool log viewer.
- Do not change final assistant output delivery or `/full` behavior.
- Do not add new runtime dependencies.
- Do not rely on private Pi internals beyond documented extension events currently available.

## Decisions

### 1. Track tool progress by `toolCallId`

Maintain a small in-memory tool progress accumulator for the current turn, keyed by `toolCallId`. `tool_call` and `tool_execution_start` can create or update an active record, and `tool_execution_end` can mark it completed or failed.

Rationale: event ids are too granular and produce repeated messages; `toolCallId` is the stable lifecycle identity.

Alternative considered: continue emitting independent progress activities and rely only on text coalescing. This still produces poor summaries and cannot represent active vs completed tool state.

### 2. Summarize only allowlisted tool arguments

Create pure helpers that accept `toolName`, `toolCallId`, and tool input/args and return a safe bounded summary. Examples:

- `bash`: first command line, redacted and truncated.
- `read`: file path and optional range if present.
- `edit`/`write`: target path only, not replacement text or file content.
- `grep`/`rg`: pattern and search path, redacted and truncated.
- `find`/`ls`: target path or search root.
- unknown/custom tools: tool name only, or a conservative sanitized label in verbose mode.

Rationale: allowlists prevent accidental leakage from arbitrary tool args.

Alternative considered: summarize all JSON args generically. Rejected because it risks leaking secrets, file contents, prompt fragments, or raw destination IDs.

### 3. Format one compact tool status card

Represent tool progress as a bounded set of rows plus counts, for example:

```text
● Working
  ▶ bash: npm test
  📖 read: extensions/relay/runtime/extension-runtime.ts
  ✏️ edit: tests/integration.test.ts
  🔧 tools: bash×2 read×4 edit×1
```

The card should fit the configured progress limit and prefer the most recent active/failed rows plus aggregate counts.

Rationale: humans need to know current intent and rough progress, not every raw event.

Alternative considered: one message per tool completion. The screenshot demonstrates this is not useful.

### 4. Keep normal and verbose distinct

Normal mode shows safe operation summaries and aggregate counts. Verbose mode may include additional safe lifecycle markers such as active/completed/failed status per recent tool, but it still uses the same redaction, bounding, and coalescing helpers.

Rationale: verbose should help debugging without reintroducing unbounded noise or sensitive output leakage.

### 5. Clear accumulator on turn boundaries

The accumulator is current-turn state. It resets on `agent_start`, terminal `agent_end`, abort/failure handling, route unregister, and runtime restart. It is not persisted.

Rationale: persisted state must avoid storing tool internals or transcripts, and stale tool rows would confuse later turns.

## Risks / Trade-offs

- **Risk: Useful command/path context can contain secrets** → Apply configured redaction before storing summaries, bound lengths, and avoid unallowlisted fields.
- **Risk: Tool event coverage differs across Pi versions** → Use `tool_call` and `tool_execution_end` as primary sources, and degrade to generic tool-name summaries when start/update details are unavailable.
- **Risk: The live card can still churn too often** → Reuse existing per-binding rate limiting and semantic coalescing; update Telegram in place where possible.
- **Risk: Multiple same-name tools become ambiguous** → Show aggregate counts and recent summaries rather than pretending every call is unique.
- **Risk: Broker parity diverges** → Put summarization and formatting in shared helpers used by direct runtimes and broker-facing route state.

## Migration Plan

- No persisted schema migration is required.
- Existing progress preferences continue to work.
- Rollback is safe: removing the accumulator returns progress to existing generic tool milestones.

## Open Questions

- Should normal mode show active tool rows (`▶ bash: npm test`) or only completed summaries? The recommended default is to show active rows because it answers “what is Pi doing now?”.
- Should verbose mode include sanitized elapsed durations per tool when available? This can be deferred unless Pi event timing proves reliable enough.
