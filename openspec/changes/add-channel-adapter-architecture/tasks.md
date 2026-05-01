## 1. Adapter interfaces

- [ ] 1.1 Define channel identity, inbound message, inbound action, outbound payload, button, file, and capability types.
- [ ] 1.2 Define adapter interface methods for polling/webhook input, text delivery, documents/images, activity, and callbacks.
- [ ] 1.3 Define relay core boundaries for route authorization, delivery, output retrieval, and answer workflows.

## 2. Telegram adapter extraction

- [ ] 2.1 Wrap existing Telegram API operations in a Telegram adapter.
- [ ] 2.2 Convert Telegram update parsing into normalized inbound messages/actions.
- [ ] 2.3 Convert relay core outbound payloads into Telegram messages/documents/buttons.
- [ ] 2.4 Preserve existing Telegram config, state paths, commands, and skill behavior.

## 3. Broker/runtime refactor

- [ ] 3.1 Extract shared relay core from in-process runtime.
- [ ] 3.2 Update broker runtime and broker process to route channel-neutral IPC payloads.
- [ ] 3.3 Add adapter capability fallback behavior for buttons, files, activity, and message limits.

## 4. Generic commands and docs

- [ ] 4.1 Add `/relay` local command aliases where appropriate.
- [ ] 4.2 Document adapter boundaries and how future adapters plug in.
- [ ] 4.3 Update README and skill docs without removing `/telegram-tunnel` guidance.

## 5. Tests and validation

- [ ] 5.1 Add characterization tests to prove Telegram behavior is unchanged.
- [ ] 5.2 Add adapter interface/unit tests for capability fallback behavior.
- [ ] 5.3 Run typecheck and the full test suite.
