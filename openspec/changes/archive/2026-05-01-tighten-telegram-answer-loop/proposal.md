## Why

PiRelay's guided answer flow can accidentally consume an ordinary Telegram prompt as an answer when recent assistant output contains structured answer metadata or an answer state is still active. This is especially confusing when the user's message is a new question or exploration prompt, because PiRelay may inject it as “Answer to …” instead of treating it as a normal prompt.

## What Changes

- Make guided-answer capture more explicit and conservative.
- Distinguish normal prompts, guided answers, custom answers, direct option selections, commands, and ambiguous replies.
- Avoid consuming long, question-like, Markdown-like, or instruction-like messages as answers unless the user explicitly entered answer mode or used an explicit answer phrase.
- Add an ambiguity confirmation path when a message plausibly could be either a new prompt or an answer to the previous assistant output.
- Clear stale answer/custom-answer state on newer turns, expiry, cancellation, and normal prompt routing.
- Improve audit messages so only explicit guided answers are logged as answer-flow submissions.

## Capabilities

### New Capabilities

### Modified Capabilities
- `telegram-session-tunnel`: tightens guided-answer intent resolution and ambiguity handling for Telegram text and callback interactions.

## Impact

- Affected code: Telegram runtime, broker runtime, answer workflow helpers, action callbacks, state cleanup, tests, and documentation.
- Existing inline option buttons, `answer` draft flow, `Custom answer`, and command fallbacks remain supported.
- Behavior changes intentionally favor treating ambiguous free text as a normal prompt instead of an answer.
