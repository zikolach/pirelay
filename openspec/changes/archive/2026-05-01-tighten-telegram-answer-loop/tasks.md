## 1. Shared answer-intent classifier

- [x] 1.1 Add helper types for answer intent classification: command, explicit answer, bare option, prompt-like text, ambiguous, normal prompt, cancel.
- [x] 1.2 Implement prompt-like heuristics for long text, multi-paragraph text, questions, Markdown headings/lists/code, and new-instruction keywords.
- [x] 1.3 Implement explicit answer phrase parsing for `answer`, `option`, `choose`, option ids, and filled `A1:` templates.
- [x] 1.4 Keep bare short option matching only for current unambiguous structured choice metadata.

## 2. In-process runtime behavior

- [x] 2.1 Use the classifier before guided-answer capture in `handleAuthorizedMessage`.
- [x] 2.2 Route prompt-like messages as normal prompts even when structured answer metadata exists.
- [x] 2.3 Add ambiguity confirmation state, inline callbacks, expiry, and text fallback handling.
- [x] 2.4 Clear answer, custom-answer, and ambiguity state on normal prompt routing, cancellation, revocation, and newer completed turns.
- [x] 2.5 Update audit messages so only explicit guided answers use answer-flow audit text.

## 3. Broker runtime parity

- [x] 3.1 Use the shared classifier in `broker.js` message handling.
- [x] 3.2 Add broker ambiguity confirmation callbacks, expiry, stale checks, and text fallbacks.
- [x] 3.3 Mirror state cleanup and audit accuracy behavior in broker mode.

## 4. Tests

- [x] 4.1 Add unit tests for answer-intent classification heuristics.
- [x] 4.2 Add runtime tests proving new questions/instructions after answerable output are normal prompts.
- [x] 4.3 Add runtime tests for explicit answer phrases, bare short options, active answer draft flow, and custom-answer capture.
- [x] 4.4 Add tests for ambiguity confirmation send-as-prompt, answer-previous, cancel, expiry, stale turn, and unauthorized callbacks.
- [x] 4.5 Add broker parity tests for the same answer-loop cases.

## 5. Documentation and validation

- [x] 5.1 Update README and Telegram tunnel skill docs with explicit answer behavior and ambiguity handling.
- [x] 5.2 Update testing docs with manual checks for answer-loop false-positive prevention.
- [x] 5.3 Run typecheck and the full test suite.
