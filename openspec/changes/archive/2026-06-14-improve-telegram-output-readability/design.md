## Context

PiRelay has two Telegram terminal-output delivery paths:

- in-process runtime delivery, which can send full assistant output as chat chunks when it fits; and
- broker fallback delivery, where `sendSessionNotification()` currently stores a deterministic summary and calls `sendToBoundChat()` with that summary.

The deterministic summary is intentionally safe and short, but it collapses whitespace and list structure. For short completion messages this creates a less readable Telegram notification even though the original assistant output would fit comfortably inside the existing Telegram message limit. The `/full` command still recovers the original text, but requiring an extra action for comparable-size output is unnecessary.

The root problem is that terminal-output length is currently entangled with progress-mode handling in some paths. Progress mode should control non-terminal progress noise and terminal-notification cadence, not whether a final answer that fits platform limits is summarized. This change makes terminal-output delivery a separate policy and aligns broker and in-process behavior with it.

## Goals / Non-Goals

**Goals:**

- Preserve paragraph breaks, bullet lists, code-ish lines, and validation result blocks for short final assistant outputs.
- Use the same terminal-output decision policy for broker-owned and in-process Telegram runtime paths.
- Decouple progress mode from final-output length: quiet mode suppresses non-terminal progress updates, but does not by itself summarize short final output.
- Use summaries/excerpts only when platform limits, adapter capabilities, or an explicit future terminal-output preference require shortening.
- Expose full-output retrieval whenever the notification text is shorter than, summarized from, or otherwise not equal to the full assistant output.
- Keep existing Telegram max-message, chunk-count, Markdown document fallback, and redaction behavior.

**Non-Goals:**

- Adding a new summarization model or dependency.
- Adding a new user-facing terminal-output preference such as `terminalOutput: full|summary|auto` in this change.
- Changing Telegram Bot API hard limits or bypassing configured `maxTelegramMessageChars`.
- Sending full transcripts, tool internals, hidden prompts, or other data beyond the latest safe assistant output.
- Redesigning progress update shortening; this change is scoped to terminal assistant-output notifications and `/full` retrieval affordances.
- Changing Discord/Slack terminal-output UX except where shared helper tests reveal obvious parity regressions.

## Decisions

### Use a shared terminal-output delivery decision helper

Create or extend a shared pure helper that decides whether a terminal notification should send:

1. the full assistant output as chat chunks;
2. a format-preserving excerpt/summary with full-output affordance; or
3. a Markdown document fallback.

The helper should take adapter text limit, maximum safe message chunks, adapter document capability, source prefix/header overhead, and optional image hint/action availability into account. It should not use progress mode as a proxy for shortening. Progress mode can decide whether non-terminal progress updates are sent before completion, but terminal-output length policy should be independent.

**Rationale:** The current bug exists because broker and in-process paths make different decisions and one path treats terminal output as a summary. A shared helper keeps future Telegram, broker, Discord, and Slack changes aligned.

**Alternative considered:** Raise the deterministic summary length from 320 to a larger number. This would not preserve formatting and would still be a separate broker-only policy.

### Prefer lossless formatted text whenever it fits bounded chat delivery

For every progress mode that sends a terminal notification, if the latest assistant output can be delivered within existing safe message chunk limits, PiRelay should send it losslessly as chat text. The completion header can remain separate from the assistant output to avoid consuming output capacity and to keep the output readable.

**Rationale:** Users perceive a readable 450-character multi-paragraph message as better than a 320-character collapsed summary; Telegram limits are not the constraint in this case. Quiet mode should not alter that conclusion because quiet is about progress noise, not final-output length.

**Alternative considered:** Always send summaries first and rely on `/full`. This optimizes message count but creates unnecessary friction for common short outputs.

### Keep progress mode scoped to progress behavior

`quiet`, `normal`, `verbose`, and `completion-only` should continue controlling progress update behavior and terminal notification eligibility/cadence. They should not be overloaded as terminal-output length preferences. If users need concise final answers as a separate feature, introduce an explicit terminal-output preference in a future change.

**Rationale:** Separating concerns makes the UX predictable: progress mode answers “how noisy should the run be while it is happening?”, while terminal-output policy answers “how should the final assistant answer be delivered safely?”.

**Alternative considered:** Preserve quiet mode as a concise-final-output mode. That keeps current behavior but makes the name misleading and causes exactly the unreadable-short-output issue reported here.

### Offer full-output actions based on omission, not only raw length

The existing 2000-character threshold can hide full-output buttons for short-but-summarized messages. Full-output actions should be included whenever the sent terminal notification omits or changes any assistant output, even when the original text is below the long-output threshold.

**Rationale:** If PiRelay chooses to shorten text because of limits or a future explicit preference, it must provide a direct way back to the original.

**Alternative considered:** Keep `/full` as the only fallback for short summaries. This is discoverable for experienced users but worse than the existing button UX.

## Risks / Trade-offs

- **More Telegram messages for short quiet-mode completions** → This is intentional: quiet mode suppresses non-terminal progress noise, not readable final output. Keep the existing maximum safe chunk threshold and document fallback for genuinely large output.
- **Header/prefix pushes output over a limit** → Send the completion header separately or account for prefix/header overhead in the delivery decision.
- **Broker process cannot use TypeScript-only helper directly** → Put pure policy in an importable shared module already used by both runtime and broker, or mirror only a thin JavaScript call to shared compiled/loader-compatible functions.
- **Users may still want concise final notifications** → Treat that as a separate explicit terminal-output preference, not progress mode semantics.
- **Full-output buttons become noisier** → Add buttons only when the notification is not the full assistant output or when existing long-output rules already require them.
