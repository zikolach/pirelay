## Context

The Telegram tunnel already stores the latest completed assistant text, detects some structured choices/questions, supports text-based guided answers, and exposes `/full` for Telegram-sized chunks. Current outbound delivery is plain text only: Telegram polling accepts messages, completion notifications tell users to type `/full`, and detected choices require typing an option number or `answer`.

The desired UX is more native to Telegram: completion and choice messages should carry inline buttons. A user should be able to tap a detected option, tap “Custom answer” and then type a custom reply, or tap full-output actions without manually entering commands.

## Goals / Non-Goals

**Goals:**
- Detect answerable option blocks more reliably across real assistant transcripts while staying conservative for ambiguous prose/lists.
- Present answer choices as Telegram inline keyboard buttons scoped to the latest completed assistant turn.
- Support a “Custom answer” button that captures the next non-command Telegram text for that same session/turn.
- Add inline “Show in chat” and “Download .md” actions for the latest completed assistant message.
- Reformat assistant output sent as Telegram chat messages for mobile readability, including Markdown table handling.
- Keep existing text commands and replies (`/full`, direct numbers, `answer`, `cancel`) working as fallbacks.
- Keep in-process runtime and singleton broker runtime behavior consistent.

**Non-Goals:**
- Building a Telegram Web App or hosted rich-output page.
- Using an LLM to semantically rewrite assistant output before sending it to Telegram.
- Sending whole session transcripts, tool logs, hidden prompts, or anything beyond the latest completed assistant message.
- Replacing existing text-command workflows.
- Supporting Telegram group chats.

## Decisions

### Use Telegram inline keyboards for answer and full-output actions

Completion and decision-block messages should include inline keyboard buttons rather than reply keyboards. Inline keyboards stay attached to the relevant bot message, avoid cluttering the user's typing keyboard, and trigger callback queries without visible command messages.

Button groups:
- choice output: one button per detected option, plus “Custom answer” and full-output actions;
- generic completion output: “Show in chat” and “Download .md” when latest assistant output is available;
- fallback text still mentions `/full` for clients that do not use buttons.

Alternatives considered:
- Reply keyboards: rejected because they persist outside the relevant message and clutter chat input.
- Web App rich view: deferred due to hosting/security complexity.

### Represent callbacks with compact turn-scoped action IDs

Callback data should be short and never contain raw assistant output or option text. Use a compact format such as:

```text
ans:<turnId>:opt:<optionId>
ans:<turnId>:custom
full:<turnId>:chat
full:<turnId>:md
```

`turnId` can be derived from the latest completed assistant-output metadata and should change whenever a new assistant turn completes. Runtime state resolves the callback to the current route, validates chat/user authorization, checks that the turn still matches, and only then injects an answer or sends full output.

Alternatives considered:
- Embedding full option text in callback data: rejected due to Telegram callback-data size limits and privacy.
- Omitting turn ids: rejected because stale buttons could act on a newer assistant output.

### Add pending custom-answer state

When a user taps “Custom answer”, store pending state keyed by session key, chat id, and turn id. The next authorized non-command Telegram text becomes the custom answer injection. `cancel` clears the state, slash commands continue to work normally, and pending state expires after a short timeout such as 10 minutes or when a newer turn completes.

Alternatives considered:
- ForceReply only: useful as an optional prompt style, but not reliable enough to be the state model.
- Reusing the existing questionnaire flow only: insufficient because custom answer is a single free-text answer to a choice block.

### Improve detection with candidate scoring and parser diagnostics

Refactor answer detection around candidate blocks and confidence scoring instead of one narrow tail regex pass. Candidate patterns should include numeric, lettered, parenthesized, and “Option A:” styles. Bullet lists should require stronger lead-in hints to avoid false positives.

Detection output should include enough metadata for UX and tests: normalized prompt, normalized options/questions, confidence, and optional reason/diagnostics for declined ambiguous blocks. The system should only present buttons above the confidence threshold; otherwise it should keep the current safe fallback.

Alternatives considered:
- LLM-based parsing: deferred because deterministic local behavior is easier to test and does not require model availability.
- Very permissive parsing: rejected because false-positive answer buttons can inject unintended prompts.

### Keep full output as latest assistant message only

Both “Show in chat” and “Download .md” use `notification.lastAssistantText` only. “Show in chat” sends Telegram-sized chunks using existing redaction and chunking. “Download .md” sends a Markdown document attachment, also after redaction, with a safe generated filename.

Alternatives considered:
- Full turn or full session transcript: rejected for this change because it increases privacy risk and scope.
- PDF/HTML/Web App output: deferred; Markdown gives a simple whole-output format first.

### Add deterministic mobile-friendly chat formatting

Before sending assistant output into Telegram chat bubbles, run a deterministic formatting pass that preserves meaning but improves mobile readability. The formatter should focus on Telegram's weak Markdown/table support:

- convert Markdown tables to aligned monospace blocks for inline chat delivery;
- preserve fenced code blocks and avoid reflowing code;
- normalize very long separators or table borders that would wrap poorly;
- keep the Markdown document download as the source-preserving version.

This is a formatting/reflow step, not a semantic rewrite. It must not invent content, remove rows, change cell values, or include hidden/tool/session content beyond the latest assistant message.

Alternatives considered:
- Sending raw Markdown tables in chat: rejected because Telegram clients do not render tables and they become hard to read on mobile.
- Rendering tables as images: deferred because images are not copyable/searchable and add rendering dependencies.
- LLM rewriting: rejected for this change because it can alter meaning and is harder to test deterministically.

### Preserve broker parity through protocol additions

The broker owns Telegram polling in normal operation, so callback-query parsing, callback acknowledgements, inline keyboard delivery, full-output document sends, and custom-answer state must exist in `broker.js`. `BrokerTunnelRuntime` should receive only the actions needed to interact with live Pi routes: deliver prompt, append audit, persist state, and route snapshots. Any new route snapshot fields should remain non-secret.

## Risks / Trade-offs

- False-positive answer detection → use confidence thresholds, diagnostics, and broad transcript tests; fall back to text instructions when uncertain.
- Stale inline buttons → include turn ids, reject stale callbacks, and answer the callback with a clear “this output is no longer current” message.
- Custom-answer capture hijacks normal text → scope by chat/session/turn, let slash commands bypass capture, support `cancel`, and expire state.
- Long “Show in chat” output can spam Telegram → keep “Download .md” available beside it and use existing chunk limits/headers.
- Markdown attachment can still leak sensitive output → apply existing redaction patterns before sending and keep scope to latest assistant message.
- Mobile formatting could alter meaning → keep formatting deterministic, preserve raw values, add tests for tables/code blocks, and keep `.md` download as source-preserving fallback.
- Broker/in-process behavior can diverge → add shared helpers where practical and parity tests for callback handling.

## Migration Plan

1. Add callback-query and inline-keyboard support behind existing Telegram runtime paths.
2. Keep existing `/full`, direct numeric replies, and text guided-answer flows unchanged during rollout.
3. Add document-download support for latest assistant output.
4. Expand tests before enabling the new buttons in completion messages.
5. Roll back by omitting inline keyboards; text commands remain usable.

## Open Questions

- What exact threshold should split “Show in chat” from recommending “Download .md” first?
- Should Markdown download always be shown, or only when output exceeds a configurable size?
- Should custom-answer prompts use Telegram ForceReply in addition to inline button state?
- How aggressively should wide Markdown tables be narrowed before they become less useful than the `.md` download?
