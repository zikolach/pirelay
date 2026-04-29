## 1. Telegram Chat Action Support

- [x] 1.1 Add a `sendChatAction(chatId, action)` helper to `TelegramApiClient` with retry/backoff behavior consistent with text sends.
- [x] 1.2 Add equivalent `sendChatAction` support to the broker process in `extensions/telegram-tunnel/broker.js`.
- [x] 1.3 Ensure chat-action failures are handled as best-effort and do not block prompt delivery.

## 2. Activity Indicator Lifecycle

- [x] 2.1 Implement an in-memory typing/activity indicator manager in the in-process runtime keyed by session/chat.
- [x] 2.2 Start the indicator immediately after accepted idle prompts and guided answer submissions that inject work into Pi.
- [x] 2.3 Refresh the indicator while route state shows Pi is busy/running and stop it on completion, failure, abort, disconnect, pause, or route unregister.
- [x] 2.4 Preserve clear textual queued-delivery acknowledgements for busy follow-up/steer messages while still showing active-run activity.

## 3. Broker Runtime Parity

- [x] 3.1 Mirror the activity indicator lifecycle in the singleton broker runtime.
- [x] 3.2 Update broker route registration/update handling so typing state follows `busy` and notification terminal states.
- [x] 3.3 Clear broker typing timers for stale routes, disconnected bindings, paused bindings, removed clients, and route unregisters.

## 4. Tests and Documentation

- [x] 4.1 Add unit tests for in-process prompt delivery showing `typing` instead of the idle "Prompt delivered to Pi" acknowledgement.
- [x] 4.2 Add tests for refresh/stop behavior and chat-action failure fallback.
- [x] 4.3 Update README and Telegram tunnel skill documentation to describe the `typing...` activity UX.
- [x] 4.4 Run `openspec validate add-telegram-typing-status --strict`, package typecheck, and tests.
