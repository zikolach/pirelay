## Context

Pi skills are instruction bundles loaded into the model on demand. They are useful for discoverability and workflows, but they do not run background network listeners, subscribe to session lifecycle events, or inject messages into a live session by themselves. The tunnel therefore needs an extension-backed implementation, optionally packaged with a skill that explains and triggers the setup workflow.

Pi extensions can register slash commands, subscribe to `session_start`, `message_update`, `agent_end`, and `session_shutdown`, call `pi.sendUserMessage()` to inject remote prompts, call `ctx.abort()`/`ctx.compact()` for control operations, persist state with `pi.appendEntry()`, and render custom TUI content. Telegram private chat pairing is possible with Bot API deep links of the form `https://t.me/<bot>?start=<payload>`; a QR code can encode that link.

Telegram constraints shape the design: bots cannot initiate a private chat before the user presses Start, messages have size limits, Bot API chats are not end-to-end encrypted, and long polling conflicts if multiple local processes use the same bot token independently.

## Goals / Non-Goals

**Goals:**
- Pair a trusted Telegram user to the exact Pi session where setup was invoked.
- Display a QR code and fallback link inside Pi for the Telegram deep-link handshake.
- Notify Telegram when tasks start, make progress, finish, fail, or are aborted.
- Send a concise completion summary by default and make the full response/transcript available on demand.
- Route authorized Telegram messages back into the bound Pi session as prompts, steering messages, follow-ups, or explicit control commands.
- Persist non-secret binding metadata across session reload/resume while keeping tokens and one-time secrets out of session history.
- Support safe disconnect/revoke and sensible behavior when Pi is offline or a session is no longer active.

**Non-Goals:**
- Replacing Pi's terminal UI with a full Telegram client.
- Supporting Telegram group chats in the first release.
- Providing E2E encryption beyond Telegram Bot API transport.
- Remotely switching arbitrary Pi sessions from Telegram unless those sessions were explicitly paired and are currently registered with the tunnel runtime.
- Requiring a public webhook URL for the MVP.

## Decisions

### Extension-backed package, not a pure skill

Implement the runtime as a Pi extension and ship a companion skill for documentation/discovery. The extension registers `/telegram-tunnel` commands and owns the bot connection, event subscriptions, state, and message injection. The skill can explain usage and point users to the command, but should not be the only entrypoint.

Alternatives considered:
- Pure skill: rejected because skills cannot maintain a bot connection or subscribe to Pi lifecycle events.
- External standalone app using Pi RPC only: possible, but harder to bind to an already-running interactive session and less integrated with Pi commands/UI.

### Pairing via Telegram deep-link QR

`/telegram-tunnel connect` creates a high-entropy, expiring, single-use pairing nonce scoped to the current session id/file and renders a QR code for `https://t.me/<botUsername>?start=<nonce>`. When Telegram sends `/start <nonce>`, the extension validates the nonce, records the Telegram `chat_id`/`user_id`, and asks the local Pi user to confirm the visible Telegram identity before activating the tunnel unless an allow-list already matches.

Alternatives considered:
- Asking the user to paste a code manually: useful as fallback, but less convenient.
- Bot-initiated chat: impossible until the user starts the bot.
- Public webhook with QR callback: adds deployment complexity; long polling is enough for local-first MVP.

### Telegram runtime topology

Start with an in-process polling runtime for MVP, guarded by a local lock to prevent two processes from polling the same bot token simultaneously. Define the internal interface so it can later be moved behind a singleton broker process if multi-terminal concurrency is required.

A robust multi-session version should introduce a broker under `~/.pi/agent/telegram-tunnel/` that owns Telegram polling once per bot token and exposes a local IPC channel to extension instances. Each extension registers its active session route with the broker; the broker forwards updates to the correct session and sends outbound messages. This avoids Telegram `getUpdates` conflicts and enables `/sessions`/`/use` across concurrently running Pi terminals.

Alternatives considered:
- Always require a broker from day one: more reliable for power users, but significantly larger MVP.
- One bot token per Pi process/session: simple but poor UX and easy to misconfigure.

### Session-scoped routing and persistence

Use Pi's session id and session file path as the local binding target. Persist only binding metadata (chat id, user id, session id, label, timestamps, preferences, revoked state) in a custom session entry and a local config store. Do not store bot tokens or pairing nonces in session history. On `session_start`, restore active binding metadata and re-register the route. On `session_shutdown`, unregister the route and optionally notify Telegram that the session is offline.

Alternatives considered:
- Store all state globally only: loses useful per-session restore behavior.
- Store secrets in session custom entries: rejected because session files can be shared/exported.

### Telegram command model

Reserve Telegram slash commands for tunnel controls and treat non-command text as user prompts. Default delivery is configurable:
- idle session: normal `sendUserMessage()` prompt;
- busy session: `followUp` by default, with `/steer <text>` available for steering and `/followup <text>` for explicit follow-up.

Core commands: `/help`, `/status`, `/summary`, `/full`, `/steer`, `/followup`, `/abort`, `/compact`, `/pause`, `/resume`, and `/disconnect`. Inline keyboards can provide common actions such as “Full output”, “Abort”, “Disconnect”, and entry into a structured answer flow when the latest assistant output contains numbered options or explicit questions.

Alternatives considered:
- Forward all Telegram messages verbatim to the model: unsafe for control commands and poor for abort/status.
- Make every remote message steer while busy: powerful but surprising; follow-up is safer as a default.

### Local and remote interaction coexistence

Pairing a Telegram chat must not monopolize the bound Pi session. The local Pi user should still be able to type normal prompts, invoke skills, and continue working in the same session after pairing, after guided-answer use, and after any Telegram-driven prompt injection. Route-state publication to the broker therefore needs to be strictly non-blocking on the interactive path, and any confirmation or synchronization workflow must avoid deadlocking the main session loop.

Alternatives considered:
- Treat the Telegram tunnel as exclusive control once paired: rejected because the primary use case is mobile monitoring/steering of a still-local Pi session.
- Open a separate hidden session for Telegram work: rejected because it breaks the requirement that Telegram maps to the exact active session.

### Summary and full-output delivery

At `agent_end`, extract the final assistant text from the completed turn. Send a Telegram completion message containing status, elapsed time, compact final text or generated summary, and buttons/commands for full output. If an LLM summary mode is enabled, use a cheap/selected model through Pi's model registry; otherwise use deterministic truncation/extraction. Store the last full assistant response and last-turn metadata in extension memory/session metadata so `/full` can send paginated chunks respecting Telegram message limits.

When the assistant output contains an actionable tail section such as “Choose:” with numbered options near the end, the delivery logic should not hide that part behind a short head-only excerpt. Instead, the tunnel should either send the relevant continuation chunk automatically, include an explicit “continued” follow-up message, or attach a clear affordance (`/full`, inline button, or both) that preserves access to the final decision block.

The runtime should also parse lightweight structured question/choice metadata from the latest completed assistant response when it detects numbered options, bullet options, explicit questions, or similar answer prompts. That metadata should not be treated as a raw mirror of the assistant text. Instead, when the user enters `answer`, the tunnel should generate a normalized answer draft from the latest completed output, similar to Pi's prompt-generator/Q&A pattern: present a stable choice list or `Q1/A1` template, then accept a deterministic reply against that generated draft. For question sets, the primary path should be a filled answer template (`A1: ...`, `A2: ...`), with question-by-question replies as a fallback rather than the only mode.

This keeps the mobile answer workflow closer to Pi's own answer UX: operate on the latest completed assistant output, generate explicit editable answer structure, and avoid making the user respond against fragile raw prose. It also means the tunnel must only start answer mode when it has reliable structured metadata from a completed assistant turn; otherwise it should decline cleanly and point the user to `/full` or a normal free-text reply.

Because these flows are driven by heuristic parsing of assistant output, the package needs broader regression coverage over real transcripts, including numbered lists, bulleted lists, mixed prose-plus-options responses, multi-question tails, repeated answer cycles, and interruption/recovery cases. The answer workflow should prefer a conservative fallback (plain `/full` or normal free-text reply) over entering a broken guided flow.

Alternatives considered:
- Always send the full response: noisy and can exceed Telegram limits.
- Always call an LLM summarizer: higher cost and can fail if no secondary model/key is configured.
- Require the user to retype option text manually: works everywhere, but is awkward on mobile and error-prone when the visible preview cropped the decisive part.
- Add a dedicated Telegram slash command for answers: possible, but less natural than a guided workflow derived from the same structured-answer semantics used in Pi.

### Security and privacy posture

Require an explicit pairing action from the local session and authenticate all inbound Telegram updates against the stored `chat_id`/`user_id`. Pairing nonces must be high entropy, single use, expire quickly, and never be logged in full. Provide allow-list configuration, local confirmation, disconnect/revoke, and clear warnings that Telegram Bot API is not E2E encrypted and should not be used for secrets unless the user accepts that risk.

Alternatives considered:
- Trust anyone with the deep link indefinitely: rejected.
- Bind only to `chat_id`: sufficient for private chats most of the time, but recording `user_id` improves audit and future group support.

## Risks / Trade-offs

- Telegram polling conflict if multiple Pi processes use the same bot token → MVP uses a lock and reports a clear error; broker architecture is planned for multi-process support.
- Remote control can execute powerful agent actions → require pairing confirmation, user allow-list, revocation, audit messages, and conservative default follow-up behavior while busy.
- Telegram messages can leak sensitive task output → warn during setup, allow summary-only mode, redact known secret patterns before sending, and require explicit `/full` for long output.
- Pi process offline means Telegram cannot reach the session → bot replies with offline state if broker is alive, or no response in in-process MVP; reconnect on `session_start`.
- Large outputs exceed Telegram limits → chunk/paginate with safe formatting and rate limiting, and preserve important tail content such as decision prompts rather than only keeping the beginning of the response.
- LLM-generated summaries can be inaccurate → deterministic final-message summary is the default; generated summaries are optional and labeled.
- Broker route synchronization or guided-answer control flow can block the local Pi session → keep the interactive path non-blocking and add explicit regression tests for continued local input/skill usage after pairing.
- Telegram `typing...` behavior is client-dependent and timing-sensitive → validate with end-to-end tests and manual smoke checks, and make fallback messaging explicit when chat actions are not observable.

## Migration Plan

1. Add the package locally and configure `TELEGRAM_BOT_TOKEN` or a local config file.
2. Run `/telegram-tunnel setup` to validate the token and fetch bot username.
3. Run `/telegram-tunnel connect` in a Pi session, scan the QR code, press Start in Telegram, and confirm the pairing in Pi.
4. Use the tunnel for task completion summaries and remote commands.
5. Roll back by disabling/removing the Pi package and deleting `~/.pi/agent/telegram-tunnel/` local state; session history remains readable because only non-secret metadata is stored.

## Open Questions

- Should the initial implementation include the singleton broker, or should it ship the simpler in-process runtime first?
- Which summary mode should be the default: deterministic final assistant excerpt or LLM-generated summary?
- Should `/full` return only the last assistant response, the last turn including tool summaries, or the entire current branch transcript?
- Where should bot token setup live: environment variable only, Pi auth storage, or package-local config with chmod checks?
