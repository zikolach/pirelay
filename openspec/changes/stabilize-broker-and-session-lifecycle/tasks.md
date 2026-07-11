## 1. Broker Singleton Design Enforcement

- [x] 1.1 Document the broker scope key in code comments or docs as `{stateDir, bot token hash, brokerNamespace}`.
- [x] 1.2 Move startup locking and stale coordination recovery from `BrokerTunnelRuntime` into `extensions/relay/broker/supervisor.ts`.
- [x] 1.3 Expose a supervisor API that ensures one local broker process for a broker scope and returns socket/pid/control paths.
- [x] 1.4 Update `BrokerTunnelRuntime` to call the supervisor before connecting instead of independently deciding when to spawn a broker.
- [x] 1.5 Preserve existing default socket/pid naming or provide a backward-compatible migration for current broker control files.
- [x] 1.6 Ensure broker startup diagnostics mention only secret-safe scope labels and never bot tokens or pairing payloads.

## 2. Broker Recovery and Route Re-registration

- [x] 2.1 Keep route re-registration idempotent after reconnect and broker socket recreation.
- [x] 2.2 Add tests for two concurrent runtimes starting with an unavailable socket and verify only one broker spawn occurs.
- [x] 2.3 Add tests for live pid/socket-not-ready behavior where the second runtime waits instead of spawning a competing broker.
- [x] 2.4 Add tests that multiple clients reconnect to the same recovered broker and all routes appear online.
- [x] 2.5 Verify stale route registrations still respect persisted binding authority and cannot resurrect revoked bindings.
- [x] 2.6 Transfer route ownership on replacement registration and prevent stale sockets from unregistering or deleting the replacement route.

## 3. Workspace-aware Session Hygiene

- [x] 3.1 Define a safe workspace identity helper for session routes/bindings using available non-secret route metadata.
- [x] 3.2 Add session-list grouping logic that identifies older offline same-machine same-workspace bindings as superseded by newer online sessions.
- [x] 3.3 Hide or clearly mark superseded offline sessions in default `/sessions` output.
- [x] 3.4 Add an explicit all-sessions/diagnostic view that shows superseded entries without exposing raw paths or transcripts.
- [x] 3.5 Ensure `/forget <session>` works for superseded offline entries and updates persisted state consistently.
- [x] 3.6 Add tests for same-folder duplicate sessions, different-folder same-label sessions, and unknown-workspace fallback behavior.

## 4. Session Menu and Command Surface UX

- [x] 4.1 Update Telegram session-list button generation to remove per-row `Recent N` from the default grid.
- [x] 4.2 Replace offline-row inert actions with cleanup-oriented actions such as `Forget N`.
- [x] 4.3 Prioritize `Use N` or equivalent selection actions for online non-current sessions.
- [x] 4.4 Keep `/recent` and `/activity` text commands working for the current or resolved session.
- [x] 4.5 Update Discord and Slack session-list/action rendering where equivalent buttons or blocks exist.
- [x] 4.6 Add cross-surface tests that command metadata still treats recent/activity as supported even when not shown as default row buttons.

## 5. Documentation and Validation

- [x] 5.1 Update README or relay docs to explain one broker per machine/broker scope and how stale sessions are handled.
- [x] 5.2 Update troubleshooting guidance for offline sessions and `/sessions --all` or the chosen all-sessions equivalent.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Run `npm test`.
- [x] 5.5 Run `openspec validate stabilize-broker-and-session-lifecycle --strict`.
