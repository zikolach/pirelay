## Context

A completed Pi turn can produce two Telegram messages: a completion summary and, when the assistant ended with choices/questions, a structured decision message. Recent full-output actions (`Show in chat`, `Download .md`) can appear on both messages for long outputs, which duplicates controls and makes the mobile decision block visually noisy.

## Goals / Non-Goals

**Goals:**

- Ensure at most one inline full-output action keyboard is presented per completed turn notification flow.
- Keep long-output retrieval easiest where it matters most: on the structured decision/options message.
- Preserve existing full-output actions for non-decision completions.
- Keep command fallback behavior (`/full`) unchanged.

**Non-Goals:**

- Redesign Telegram command semantics.
- Change answer extraction heuristics.
- Change Markdown rendering or file download content.

## Decisions

1. **Decision messages own full-output actions when present.**
   - If `structuredAnswer` is available and the latest assistant text is long enough for full-output actions, the completion summary should omit its keyboard and `/full` hint, while the decision message includes the answer keyboard plus full-output actions.
   - Rationale: users are expected to act on the decision block, so keeping related controls there reduces duplication and keeps the summary lightweight.
   - Alternative considered: keep actions on completion and omit them from decision messages. Rejected because it separates output retrieval from the visible options and can leave the decision message without the controls referenced by its helper text.

2. **Non-decision completions keep the existing long-output behavior.**
   - If no structured answer is present, completion summaries continue to attach full-output actions when the assistant output is long.
   - Rationale: ordinary completions still need a one-click way to retrieve longer output.

3. **Use the existing length threshold.**
   - Reuse `shouldOfferFullOutputActions` so this change only adjusts placement, not what counts as long output.
   - Rationale: avoids expanding scope and keeps tests focused on duplicate-control prevention.

## Risks / Trade-offs

- **Risk:** Users may miss full-output controls if they only look at the completion summary. → Mitigation: keep `/full` available and include controls on the immediately following decision message.
- **Risk:** Broker and in-process runtime behavior could diverge. → Mitigation: update both paths and cover runtime behavior with tests; keep broker helper logic equivalent.
