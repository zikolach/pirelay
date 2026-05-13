## Why

PiRelay setup guidance currently shows environment and JSON snippets inside a read-only wizard, which makes them hard to copy and leaves users to manually translate environment variables into canonical config. Users need a safer, consistent setup path across Telegram, Discord, and Slack that helps them copy placeholder env snippets and write config references when those env vars are already defined.

Slack setup also has several sharp edges discovered during live use: App Home DM setup is easy to misconfigure, slash-prefixed pairing commands are intercepted by Slack, channel pairing needs explicit guidance, and post-pairing prompts need clear activity feedback in the correct thread.

## What Changes

- Simplify the setup wizard into tab-like panels so diagnostics, env snippets, config snippets, links, and troubleshooting each appear only on their own tab.
- Add a consistent setup wizard action for every supported messenger to copy the messenger's environment-variable snippet with placeholder values to the system clipboard, with Pi editor fallback when clipboard access is unavailable.
- Add a consistent setup wizard action for every supported messenger to write or update canonical PiRelay config from currently defined environment variables.
- Ensure the config-writing flow stores secret environment variable names such as `tokenEnv`, `signingSecretEnv`, and `appTokenEnv` rather than resolved secret values.
- Preserve unrelated existing config, create a timestamped backup before writing, restrict the written config file mode, and refresh runtime config after a successful write.
- Keep plain text fallback behavior secret-safe and useful when the TUI is unavailable.
- Keep Telegram, Discord, and Slack setup behavior aligned through shared setup metadata rather than separate one-off flows.
- Improve Slack setup/pairing UX with App ID/App Home QR support, a copyable secret-free Slack app manifest, short non-slash PIN pairing commands, channel-pairing guidance, and App Home troubleshooting.
- Improve Slack runtime UX so paired channel commands continue to route after pairing, local pairing notifications are messenger-labeled, Slack command parsing does not treat commands such as `pirelay status` as pairing attempts, busy follow-ups do not retarget the active thread, and Slack prompts show a reaction-based thinking indicator with a thread-aware fallback.

## Capabilities

### New Capabilities

### Modified Capabilities

- `relay-setup-tui`: Adds copy-to-clipboard and write-config-from-env actions to the setup wizard with consistent behavior across supported messengers, plus Slack App Home QR/manifest and pairing-command copy affordances.
- `relay-configuration`: Adds canonical config update behavior driven by defined environment variables, preserving secret safety and existing config.
- `slack-relay-adapter`: Adds Slack pairing/runtime UX refinements, channel-pairing recovery, and reaction-based thinking indicators.

## Impact

- Affected setup model and UI: `extensions/relay/config/setup-wizard.ts`, `extensions/relay/ui/setup-wizard.ts`, and `/relay setup` handling in `extensions/relay/runtime/extension-runtime.ts`.
- Affected config logic: new or extended helpers under `extensions/relay/config/` for env-to-config mapping, merging, backup, chmod, and reload behavior.
- Affected Slack runtime/adapter logic: Slack command parsing, pairing completion, channel binding lookup, thread context/activity handling, reaction API operations, and local pairing notifications.
- Tests: setup wizard model/render tests, config helper tests, runtime setup command tests across Telegram, Discord, and Slack, Slack adapter/runtime tests, and pairing tests.
- No new runtime dependencies are expected.
