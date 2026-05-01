## Context

PiRelay already detects structured answer metadata in completed assistant output and supports several answer paths:

- inline option buttons;
- direct option text/number replies;
- `answer` guided draft flow;
- `Custom answer` callback that captures the next text message;
- free-form text as a normal prompt.

The risk is that the more answer conveniences exist, the easier it is for a normal prompt to be captured as an answer. This happened when a user sent a new exploration question, but the surrounding Telegram flow treated it as an answer to a previous guided question.

## Goals / Non-Goals

**Goals:**
- Make answer intent explicit enough to avoid surprising captures.
- Preserve fast mobile answer paths for truly obvious choices.
- Add a safe ambiguity resolution path.
- Keep in-process and broker behavior equivalent.
- Improve tests around normal prompts that occur after answerable outputs.

**Non-Goals:**
- Removing guided answer flow or inline buttons.
- Replacing the existing answer metadata parser.
- Building the future middleware intent resolver in this change.
- Changing local Pi prompt behavior.

## Decisions

1. **Explicit answer contexts are trusted.**
   Treat these as deliberate answer submissions: inline option callback, `answer` flow response, `Custom answer` pending capture, and messages with explicit answer prefixes such as `answer 2`, `option 1`, `choose B`, or filled `A1:` templates.

2. **Bare short choices remain convenient but constrained.**
   Bare `1`, `2`, `A`, or exact option labels may still answer a current choice set, but only when the latest metadata is current, no answer flow is stale, and the message is short and unambiguous.

3. **Prompt-like text wins by default.**
   Long messages, question-like messages, Markdown headings/lists/code, messages containing proposal/implement/explore instructions, or multi-paragraph text should be treated as normal prompts unless the user is in explicit answer/custom-answer mode or uses an explicit answer prefix.

4. **Ambiguity gets confirmation instead of guessing.**
   If a message could plausibly be a previous answer and a new prompt, PiRelay should ask the user to choose: send as prompt, answer previous, or cancel. In Telegram this can use inline buttons with text command fallbacks.

5. **State cleanup is part of intent resolution.**
   When a normal prompt is routed, stale answer and custom-answer state for that route/user should be cleared. New completed assistant turns also invalidate older pending answer actions.

6. **Audit text must match actual intent.**
   Only explicit answer submissions should append “answered a guided Telegram question flow.” Normal prompts and ambiguous prompts resolved as prompts should use prompt audit messages.

## Classification Sketch

```
Incoming authorized text
  │
  ├─ slash command? ─────────────▶ command handler
  │
  ├─ pending custom answer? ─────▶ custom-answer capture or cancel/stale
  │
  ├─ active answer draft flow? ──▶ answer-flow response if explicit/expected
  │
  ├─ explicit answer phrase? ────▶ guided answer if current metadata exists
  │
  ├─ bare short option? ─────────▶ guided answer only if unambiguous
  │
  ├─ ambiguous? ─────────────────▶ ask prompt-vs-answer confirmation
  │
  └─ otherwise ──────────────────▶ normal prompt
```

## Risks / Trade-offs

- More conservative matching can require one extra tap for some users who relied on bare free-text answers. Mitigation: preserve bare short option matching and explicit `answer` mode.
- Ambiguity confirmation adds state and callback handling. Mitigation: bound expiry and clear it on new turns/prompts.
- Broker and in-process runtimes can drift. Mitigation: share classification helpers and add parity tests.

## Migration Plan

1. Add shared answer-intent classification helpers.
2. Update in-process runtime to use the classifier before guided-answer capture.
3. Update broker runtime to use the same classifier and confirmation flow.
4. Add stale-state cleanup for normal prompt routing and newer turns.
5. Update tests and docs to describe explicit answer behavior.
