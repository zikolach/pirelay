## 1. Runtime foundations

- [x] 1.1 Replace the Slack receive-confirmation stub with a production `SlackRuntime` structure that mirrors Discord runtime responsibilities without copying unrelated Discord-only behavior.
- [x] 1.2 Implement `SlackLiveOperations` Socket Mode startup, shutdown, immediate envelope acknowledgement, secret-safe API errors, and bounded reconnect/backoff behavior.
- [x] 1.3 Add Slack bot identity discovery via Slack API startup checks, including workspace/team id, bot user id, bot id, and app id where available.
- [x] 1.4 Add event deduplication for Socket Mode envelope ids, Slack event ids, message timestamps, action ids, and live-test diagnostic observations.
- [x] 1.5 Remove or isolate history polling so it is test/diagnostic-only and not required for production Slack prompt routing.

## 2. Configuration and diagnostics

- [x] 2.1 Add canonical and environment-backed configuration support for Slack app-level Socket Mode tokens without persisting token values.
- [x] 2.2 Add optional non-secret Slack bot user id override handling for degraded startup or live-test use.
- [x] 2.3 Extend `/relay doctor` Slack diagnostics for Socket Mode readiness, app-level token presence, bot identity discovery, workspace boundary, channel-control safety, shared-room room hint, and duplicate local identity risks.
- [x] 2.4 Update `/relay setup slack`, docs, and live-test guidance to distinguish full runtime behavior from receive-only or history-polling diagnostics.
- [x] 2.5 Add tests proving Slack diagnostics redact bot tokens, app-level tokens, signing secrets, Socket Mode URLs, response URLs, pairing codes, and authorization headers.

## 3. Pairing and binding

- [x] 3.1 Implement Slack live pairing handling using `completeSlackPairing`, pending-pairing inspection/consumption, and channel binding persistence.
- [x] 3.2 Support authorized Slack DM pairing and explicitly enabled authorized channel pairing while rejecting wrong-workspace, wrong-instance, expired, consumed, and unauthorized attempts.
- [x] 3.3 Add local confirmation/trusted-user reuse for Slack pairing consistently with messenger-neutral trust semantics.
- [x] 3.4 Restore Slack channel bindings on route registration and ensure local disconnect/revoke clears Slack bindings and active selections safely.
- [x] 3.5 Add unit/integration tests for Slack pairing happy paths, wrong-channel/wrong-instance rejection, authorization rejection, expiry, reuse prevention, trust choices, and persisted binding restoration.

## 4. DM commands and prompt routing

- [x] 4.1 Route authorized Slack DM commands through the canonical remote command set and shared formatting/session-selection helpers.
- [x] 4.2 Route authorized Slack DM ordinary text into the selected Pi session using idle, busy, steer/follow-up, paused, and offline behavior equivalent to Telegram/Discord.
- [x] 4.3 Implement Slack active selection and one-shot `/to` semantics using shared active selection state scoped to Slack instance, conversation id, and user id.
- [x] 4.4 Reject unauthorized Slack text, media, and actions before route lookup, media download, prompt injection, or control execution.
- [x] 4.5 Add tests for Slack `/help`, `/status`, `/sessions`, `/use`, `/to`, `/summary`, `/full`, `/recent`, `/abort`, `/compact`, `/pause`, `/resume`, `/disconnect`, unknown-command, and ordinary prompt flows.

## 5. Shared-room Slack routing

- [x] 5.1 Implement Slack shared-room pre-routing for app mentions, replies or thread context where available, machine aliases, and active selections.
- [x] 5.2 Ensure local Slack app mentions are handled, remote-only mentions are silent, multi-machine mentions are safely disambiguated, and ordinary text is accepted only for active local selections.
- [x] 5.3 Ignore local bot self-messages and reject or ignore bot-authored Slack messages unless the sender bot identity is explicitly authorized or trusted for a supported workflow.
- [x] 5.4 Persist and honor Slack shared-room active selections for local and observed remote machine targets without exposing remote session state.
- [x] 5.5 Add tests for Slack shared-room local target, remote target, ambiguous target, no target, active local selection, active remote selection, self-loop prevention, bot-authored driver messages, and non-target silence.

## 6. Outbound delivery and interactions

- [x] 6.1 Implement Slack terminal notifications for accepted prompts, including completion, failure, abort, and busy-eventual-notification paths to the originating Slack conversation.
- [x] 6.2 Preserve Slack thread context for command responses, prompt acknowledgements, and completion notifications when Slack supplies usable `thread_ts` or message timestamp metadata.
- [x] 6.3 Implement Slack Block Kit action authorization, stale-action handling, guided-answer responses, and safe response URL or ephemeral acknowledgements.
- [x] 6.4 Complete Slack outbound text chunking and long-output fallback behavior for `/full`, `/summary`, completion excerpts, and errors.
- [x] 6.5 Implement Slack file download for authorized media after size/MIME/model validation and add explicit file-upload support or capability-specific limitations for upload-dependent commands.
- [x] 6.6 Add tests for Slack completions, failures, aborts, thread placement, action authorization/staleness, text chunking, media download authorization, and upload limitation or upload success paths.

## 7. Live suite upgrade

- [x] 7.1 Update the live Slack integration suite so it exercises real runtime pairing or pre-seeded bindings rather than only receive-confirmation stubs.
- [x] 7.2 Add live assertions for targeted prompt acceptance, non-target silence, final completion/failure notification, command parity, active selection, and shared-room app mention routing.
- [x] 7.3 Keep live Slack credentials opt-in and skipped cleanly when absent, with redacted logs and no committed local secret scripts.
- [x] 7.4 Run the live Slack suite against the provided Slack test workspace/channel when credentials are available and document any remaining platform caveats.
- [x] 7.5 Add an opt-in `PI_RELAY_SLACK_LIVE_REAL_AGENT=true` mode for real LLM-backed Pi bot commands with marker-oriented prompts and longer default timeouts.

## 8. Same-host real-agent live isolation

- [ ] 8.1 Add an optional non-secret broker namespace override for local broker clients and supervisors.
- [ ] 8.2 Scope broker socket, pid, lock, and supervision paths by namespace while preserving the current default singleton behavior.
- [ ] 8.3 Update Slack live real-agent harness to assign unique broker namespaces per bot process and keep state/config/credentials isolated.
- [ ] 8.4 Add tests proving two same-host namespaces do not share broker route registration, Slack runtime ownership, active selection, or completion delivery.
- [ ] 8.5 Rerun `PI_RELAY_SLACK_LIVE_REAL_AGENT=true ./run-slack-live-test.sh` and confirm stub output is rejected and real agent output is observed.

## 9. Validation

- [ ] 9.1 Run focused Slack runtime, adapter, setup/doctor, shared-room, broker namespace, and messenger parity tests.
- [ ] 9.2 Run `npm run typecheck`.
- [ ] 9.3 Run `npm test`.
- [ ] 9.4 Validate with `openspec validate complete-slack-adapter-support --strict`.
