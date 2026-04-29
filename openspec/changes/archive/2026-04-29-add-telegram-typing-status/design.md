## Context

The tunnel currently acknowledges accepted Telegram prompts with a persistent text message such as "Prompt delivered to Pi." or "Pi is busy; your message was queued as followUp." Completion notifications are sent later from Pi lifecycle events. Telegram also supports ephemeral chat actions (`sendChatAction`, e.g. `typing`) that are visible in the client for a few seconds and are better suited for "Pi is working" feedback.

The package has two Telegram runtime paths that must remain behaviorally aligned: the in-process runtime used by tests and fallback operation, and the singleton broker runtime used for normal multi-session polling. Route state is already published on `agent_start`, `message_end`, and `agent_end`, so the runtime/broker can observe when a session starts and stops being busy.

## Goals / Non-Goals

**Goals:**

- Show Telegram `typing...` activity after authorized remote input is accepted and while the bound Pi session is processing.
- Avoid adding noisy acknowledgement messages for the common accepted-prompt path.
- Stop refreshing activity promptly when the Pi turn completes, fails, aborts, disconnects, pauses, or the route unregisters.
- Keep existing textual responses for errors, commands, queued-state clarity where needed, and fallback when chat actions fail.
- Implement equivalent behavior in in-process and broker runtimes.

**Non-Goals:**

- Add real-time streaming of assistant output to Telegram.
- Change pairing, authorization, command semantics, or completion notification content.
- Guarantee that every Telegram client continuously displays the indicator; Telegram chat actions are best-effort and client-dependent.
- Introduce new dependencies or persistent state for activity indicators.

## Decisions

1. **Use Telegram Bot API `sendChatAction(chat_id, "typing")` as the primary activity signal.**
   - Rationale: it maps directly to the requested Telegram-native "typing..." UX and does not pollute chat history.
   - Alternative considered: send a persistent "Working..." message and edit/delete it later. This is noisier, requires message-id tracking, and is less native.

2. **Refresh the action on a timer while a route is busy.**
   - Rationale: Telegram chat actions expire after a short period, so a single call is insufficient for long Pi runs.
   - Implementation: keep an in-memory activity entry keyed by `sessionKey:chatId`; send immediately, then every ~4 seconds while the route remains bound, unpaused, and busy/running.
   - Alternative considered: only send on lifecycle events. This would leave long-running tasks without visible activity after the first few seconds.

3. **Start activity when remote input is accepted and reinforce it on `agent_start` route updates.**
   - Rationale: accepted prompts should produce immediate feedback even before the next route publish, and lifecycle updates keep the indicator correct for locally started tasks or resumed busy state when appropriate.
   - For a busy session follow-up/steer, the indicator reflects the existing active Pi work and the queued instruction; textual queued acknowledgements may remain when they clarify delivery mode.

4. **Treat chat actions as best-effort with safe fallback.**
   - Rationale: some Bot API errors are transient or non-critical. A failed chat action must not prevent prompt delivery.
   - Implementation: log or ignore non-fatal chat-action failures, but send the existing textual acknowledgement if the initial activity action cannot be sent for an accepted prompt.

5. **Do not persist indicator state.**
   - Rationale: activity indicators are ephemeral. On restart, route registration and lifecycle publication can start a new indicator if the session is still busy.

## Risks / Trade-offs

- **Telegram rate limits or transient API failures** → Use one refresh timer per bound chat/session, refresh conservatively, and never block prompt delivery on chat-action errors.
- **Indicator may continue briefly after completion** → Clear timers on terminal notifications, route unregister, disconnect, pause, and when route state shows idle.
- **Queued follow-ups can be confused with active processing of the new message** → Preserve existing queued textual acknowledgement for busy-session delivery while also showing activity for the current Pi run.
- **Broker and in-process behavior can drift** → Add shared tests for in-process behavior and mirror the same state machine in `broker.js` with small helper functions.
