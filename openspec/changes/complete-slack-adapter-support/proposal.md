## Why

Slack live testing now proves that PiRelay can connect to a real Slack workspace, receive events from multiple app identities, and detect wrong-bot replies. The remaining gap is to replace the receive-confirmation stub with a first-class Slack runtime that supports pairing, authorization, commands, prompt routing, completion delivery, and shared-room non-target silence with the same safety guarantees as Telegram and Discord.

## What Changes

- Add a production Slack runtime client for Socket Mode that starts/stops with PiRelay, reconnects safely, acknowledges events quickly, deduplicates retries, and redacts Slack secrets in diagnostics.
- Complete Slack DM and authorized channel pairing using existing channel-scoped, single-use, expiring pairing state.
- Route authorized Slack DMs and configured channel/app-mention messages through canonical PiRelay command, selection, prompt, busy, pause/resume, abort, compact, output retrieval, and completion semantics.
- Replace the live-test receive-confirmation stub with real Slack runtime behavior while retaining the live suite as an opt-in regression harness, including real-agent mode that fails if stub output is observed.
- Implement Slack shared-room machine-bot targeting so the local app responds only to local mentions, replies, or active selections and non-target Slack apps remain silent.
- Support Slack platform limits for text chunking, Block Kit buttons/action responses, typing/working indications, file download, and explicit file-upload limitations or implementation.
- Add setup/doctor diagnostics for Slack runtime readiness, app-level Socket Mode tokens, bot user identity, scopes, event subscriptions, channel membership, duplicate identity risks, and secret-safe failure reporting.
- Add optional broker namespace isolation so two real LLM-backed Slack machine bots can run on the same host without sharing the same broker.

## Capabilities

### New Capabilities
- `slack-runtime-client`: Defines the live Slack Socket Mode runtime lifecycle, event acknowledgement, retry/deduplication, bot identity discovery, and Web API operations needed for Slack to operate as a first-class live PiRelay messenger.

### Modified Capabilities
- `slack-relay-adapter`: Completes Slack pairing, prompt routing, outbound delivery, action handling, file/media handling boundaries, and runtime security behavior beyond adapter normalization.
- `messenger-relay-sessions`: Extends canonical remote-command, prompt, busy, completion, and output parity requirements to Slack as a fully live adapter.
- `shared-room-machine-bots`: Adds Slack-specific shared-room targeting, app-mention handling, active selection, self/remote bot loop prevention, and non-target silence requirements.
- `relay-configuration`: Adds Slack Socket Mode/app-level-token, bot user identity discovery, runtime readiness, and shared-room diagnostics expectations.
- `relay-broker-topology`: Adds optional same-host broker namespace isolation for real-agent Slack live tests and independent machine-bot processes.

## Impact

- Affected code: `extensions/relay/adapters/slack/`, `extensions/relay/runtime/extension-runtime.ts`, shared relay command/session helpers, setup/doctor diagnostics, broker supervision/paths, Slack live harness, and tests.
- No breaking changes are expected for existing Telegram or Discord users.
- Slack live control remains opt-in and requires configured Slack app credentials; secrets must not be persisted, logged, or exported.
- The existing live Slack suite should evolve from stub receipt verification to end-to-end command/prompt/completion/shared-room regression coverage.
