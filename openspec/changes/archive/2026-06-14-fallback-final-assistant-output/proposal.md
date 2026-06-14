## Why

PiRelay can report “The agent finished without a final assistant response” when the final `agent_end` payload does not contain non-empty assistant text. In some runs, useful assistant text may already have arrived in a completed assistant `message_end` event before a later empty assistant/tool-use update. PiRelay should use that safe assistant-only completed text before declaring the turn failed.

## What Changes

- Preserve the last non-empty completed assistant text observed during `message_end` instead of overwriting it with empty assistant content.
- When `agent_end` final extraction has no text, fall back to the completed assistant text from the same active turn.
- Keep tool results, user prompts, hidden prompts, and transcripts out of messenger fallback output.
- Continue to emit communication diagnostics that distinguish direct final extraction from fallback completion.

## Impact

- Affected runtime path: Pi extension agent/message lifecycle handling and terminal notification status selection.
- Affected UX: fewer false failure notifications when assistant text was streamed but omitted from `agent_end`.
- Affected tests/docs: add regression coverage for empty final events after non-empty completed assistant text and for preserving prior text across empty assistant updates without using stream-only drafts as terminal output.
