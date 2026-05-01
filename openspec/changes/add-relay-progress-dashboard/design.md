## Context

PiRelay already tracks session state, busy/idle lifecycle, latest assistant output, latest images, and broker route metadata. The gap is that Telegram users only get sparse lifecycle feedback: accepted prompt activity plus terminal completion/failure/abort notifications.

## Goals / Non-Goals

**Goals:**
- Make long-running remote work observable from Telegram.
- Keep progress messages safe, concise, and rate-limited.
- Provide mobile-friendly session management for multiple paired sessions.
- Let users tune notification noise per binding/session.

**Non-Goals:**
- Streaming hidden prompts, full tool logs, or raw terminal output to Telegram.
- Replacing the local Pi TUI.
- Adding non-Telegram channels; that belongs to adapter architecture work.

## Decisions

1. **Use safe progress events, not raw logs.**
   Progress updates should be derived from lifecycle/tool categories that are already safe to expose or from sanitized short descriptions. Do not forward hidden prompts, raw command output, or whole tool payloads.

2. **Rate-limit and coalesce updates.**
   Maintain a per-route progress accumulator and send at most one update per configured interval. Coalesce repeated events into messages such as “Editing files…” or “Running tests…”.

3. **Keep notification preferences in binding metadata.**
   Store non-secret settings such as `progressMode`, `alias`, and dashboard preferences alongside existing binding metadata so they survive resume without adding secrets to session history.

4. **Prefer inline dashboard actions with command fallbacks.**
   `/sessions` and `/status` should include buttons for Use, Full, Images, Pause/Resume, Abort, Compact, and recent activity where relevant. Existing text commands remain supported.

5. **Avoid chat spam by default.**
   Default mode should be conservative: terminal notifications plus occasional progress for long-running turns. Verbose mode can increase update frequency explicitly.

## Risks / Trade-offs

- Progress events may be unavailable or too low-level in some Pi versions; fallback to lifecycle-only updates.
- Too many updates can annoy users; mitigate with quiet defaults and rate limits.
- Progress summaries can leak sensitive filenames or command names; mitigate through redaction and conservative event selection.
- Inline dashboards can become stale; callbacks must validate current route/turn/session state.

## Migration Plan

1. Add progress preference/config types and binding persistence.
2. Add progress accumulator and sanitized formatter in in-process runtime.
3. Mirror progress state and dashboard callbacks in broker runtime.
4. Extend `/sessions`, `/status`, and help/docs.
5. Add tests for rate limiting, quiet/verbose modes, stale callbacks, alias persistence, and broker parity.
