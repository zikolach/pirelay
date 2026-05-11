## Context

PiRelay currently has a mature Telegram runtime, a live Discord runtime, and a Slack channel adapter that normalizes Slack payloads and sends basic Slack outbound messages. The live Slack integration suite proved that externally provisioned Slack apps can connect through Socket Mode, receive channel events, post messages, and demonstrate shared-room non-target silence. A temporary receive-confirmation stub was added so the live suite can verify Pi-side receipt, but it does not complete pairing, prompt injection, command routing, output delivery, or production-grade runtime lifecycle behavior.

Slack differs from Telegram and Discord in ways that shape the runtime:

- Socket Mode requires an app-level `xapp-...` token in addition to the bot token and signing secret used elsewhere.
- Slack may deliver both `message` and `app_mention` events, and may retry events if acknowledgement is delayed.
- Shared channels can deliver the same human-authored or bot-authored event to every installed machine app, so local/remote mention classification and self-loop prevention are mandatory.
- Thread placement and Block Kit interactions are Slack-specific even though command and session semantics should remain messenger-neutral.

## Goals / Non-Goals

**Goals:**

- Replace the Slack receive-confirmation stub with a first-class Slack runtime that can operate in DMs and explicitly enabled shared channels.
- Start and stop Slack Socket Mode only when Slack is enabled and has the required credentials, without blocking Telegram or Discord startup.
- Complete Slack pairing through the existing pending-pairing and channel-binding store.
- Reuse messenger-neutral command, session-selection, prompt, busy-delivery, output, and notification semantics wherever possible.
- Implement Slack shared-room targeting so local mentions/replies/active selections are handled and non-target machine apps remain silent.
- Discover or configure the local Slack bot user id for self-message filtering, mention routing, diagnostics, and live test assertions.
- Keep Slack tokens, signing secrets, app-level tokens, Socket Mode URLs, pairing secrets, and hidden prompt content out of logs, state, diagnostics, and exports.
- Upgrade the live suite from stub receipt verification to end-to-end Slack runtime regression coverage, including real-agent mode that can run two LLM-backed Pi machine bots on one host without sharing a broker.

**Non-Goals:**

- Creating or installing Slack apps programmatically from PiRelay.
- Requiring Slack live credentials for the default unit-test suite.
- Replacing Telegram or Discord runtime behavior.
- Implementing a hosted relay service or broker federation as part of Slack completion.
- Redesigning the full broker topology beyond an opt-in same-host namespace needed for real-agent live isolation.
- Supporting every Slack Enterprise/Grid topology beyond validating workspace/team boundaries exposed by the configured app credentials.

## Decisions

### 1. Build SlackRuntime as a sibling of DiscordRuntime

Slack should get its own `extensions/relay/adapters/slack/runtime.ts` with the same broad responsibilities as DiscordRuntime: lifecycle, pairing, route registration, command handling, shared-room pre-routing, prompt delivery, and terminal notifications. This keeps platform-specific Socket Mode, event shape, Block Kit, and Slack retry behavior out of the generic adapter and extension lifecycle.

Alternative considered: route Slack entirely through the broker/channel adapter abstraction. That would keep runtime code more generic, but today the Discord runtime already contains the richest live messenger semantics, and Slack needs platform-specific shared-room handling before the broker path can safely own it.

### 2. Keep SlackChannelAdapter focused on normalization and outbound primitives

The existing adapter should continue to normalize Slack events, validate webhook signatures, chunk text, map buttons, and perform outbound sends. Runtime state such as pending pairings, active selections, route ownership, command parsing, and typing/progress loops belongs in SlackRuntime.

Alternative considered: expanding the adapter contract to include runtime semantics. That would blur the existing architecture split and make tests harder to isolate.

### 3. Use Socket Mode as the production ingress path; keep history polling test-only or diagnostic-only

The live stub used channel-history polling to compensate for early Socket Mode acknowledgement and runtime-lifetime issues. Production should use Socket Mode as the primary ingress path because it gives explicit event envelopes, retry metadata, and interaction payloads. History polling may remain as a bounded live-test diagnostic fallback but must not be required for normal prompt routing.

Alternative considered: production polling of `conversations.history`. Polling is less real-time, harder to dedupe, consumes Web API quota, and can accidentally replay old messages.

### 4. Acknowledge Slack envelopes before heavy work and dedupe retries

Slack expects prompt acknowledgement. The live suite showed retry delivery when events were not handled quickly. SlackLiveOperations should acknowledge envelopes immediately, record enough envelope/event identity for dedupe, then hand normalized events to SlackRuntime. SlackRuntime should ignore duplicate `event_id`, message `ts`, or interaction ids within a bounded in-memory window.

Alternative considered: acknowledge after route handling succeeds. That risks retries during long Pi work and duplicate prompt injection.

### 5. Resolve local bot identity at runtime

The runtime should call `auth.test` with the bot token at startup and cache the bot user id/team/app identity. A configured `PI_RELAY_SLACK_BOT_USER_ID` can remain a live-test override, but production should not depend on manual bot-user-id entry.

Alternative considered: parse the bot user id only from live app manifests or env. That is brittle and creates avoidable setup mistakes.

### 6. Treat bot-authored messages as unsafe by default

Slack live testing used a driver bot token, so bot-authored events can be useful in tests. Production prompt/control handling should accept bot-authored messages only when the sender bot user id is explicitly allowed or trusted and the event is not from the local bot itself. This prevents bot feedback loops and unintended bot-to-bot prompt injection.

Alternative considered: reject all bot-authored Slack messages. That is safest, but it would block legitimate machine-to-machine/shared-room test flows and future automation. Explicit allow/trust keeps the boundary clear.

### 7. Extract shared command/session helpers only where pressure is real

Slack should reuse existing pure helpers for command parsing, session selection, formatting, shared-room classification, progress, and image support. If implementation starts duplicating DiscordRuntime blocks verbatim, extract a shared helper under `extensions/relay/` rather than creating a premature framework.

Alternative considered: copy DiscordRuntime first and refactor later. That would move fastest initially but increases drift and parity bugs.

### 8. Preserve thread context through metadata before changing core address types

Slack replies should prefer the originating thread when Slack supplies `thread_ts` or a parent `ts`. The first implementation can carry this in event/binding metadata and Slack-specific outbound metadata. Only widen `ChannelRouteAddress` if multiple adapters need first-class thread semantics.

Alternative considered: immediately add `threadId` to `ChannelRouteAddress`. That may be cleaner eventually, but it is a cross-adapter contract change that should be justified by more than Slack alone.

### 9. Add opt-in broker namespace isolation for same-host real-agent live tests

The real-agent Slack live suite can launch two Pi commands on the same development host, each with distinct Slack app credentials and machine identity. If both commands attach to the same machine-local broker, the test no longer proves independent machine-bot behavior and can mask stale/stub runtimes. Add a non-secret broker namespace override that scopes broker socket, pid/lock, and supervision paths while preserving the default singleton behavior when no namespace is configured.

Alternative considered: require separate machines, containers, or OS users for the real-agent live suite. That would avoid broker changes but makes the regression suite much harder to run locally and still leaves no explicit safety mechanism for same-host multi-machine testing.

## Risks / Trade-offs

- Slack retries cause duplicate prompt injection → Acknowledge immediately and dedupe by envelope id/event id/message ts/action id before route handling.
- Bot loops in shared channels → Ignore local bot messages, reject bot-authored senders unless explicitly authorized/trusted, and ensure non-target apps remain silent.
- Shared-room routing diverges from Discord → Reuse shared-room pure helpers and add parity tests for equivalent local/remote/ambiguous/active-selection cases.
- Socket Mode connection drops → Add reconnect/backoff and status diagnostics without failing Telegram/Discord runtimes.
- Slack scopes differ for public vs private channels → Preflight and doctor should distinguish `channels:*` and `groups:*` requirements and name missing categories safely.
- File upload complexity delays command parity → Return explicit capability limitation for upload-dependent commands until Slack files upload v2 is implemented, then tighten tests.
- Thread context leaks into generic abstractions → Start with Slack metadata and revisit core address changes only if needed.
- Existing live-test stub may mask production gaps → Convert stub assertions into real runtime tests, fail real-agent live mode on stub text, and remove or clearly isolate stub-only behavior during implementation.
- Same-host real-agent bots may attach to one broker → Add an opt-in broker namespace that scopes broker coordination files and runtime ownership without changing default single-broker behavior.
