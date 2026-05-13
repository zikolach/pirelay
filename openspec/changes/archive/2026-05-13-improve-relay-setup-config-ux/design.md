## Context

`/relay setup <messenger>` already builds a messenger-neutral setup model and renders a TUI wizard with diagnostics, environment snippets, config snippets, links, troubleshooting, and next steps. The current wizard is intentionally secret-safe, but it is read-only: snippets are wrapped inside the bordered UI and cannot be conveniently copied, and users must manually convert environment variables into canonical `messengers.<kind>.default` config.

PiRelay configuration already supports env references (`tokenEnv`, `signingSecretEnv`, `appTokenEnv`) and legacy env fallback, and migration code already demonstrates the safe write pattern: backup existing config, write pretty JSON, and chmod the target to `600`. This change should reuse those patterns and keep setup behavior consistent across Telegram, Discord, and Slack.

## Goals / Non-Goals

**Goals:**

- Provide the same setup actions for Telegram, Discord, and Slack: copy env snippet to the system clipboard with Pi editor fallback, and write/update config from currently defined env vars.
- Keep snippets and written config secret-safe by using placeholders in copied snippets and env var names in config for secret fields.
- Preserve unrelated existing config and merge only the selected messenger's default instance fields.
- Create a timestamped backup before writing config and restrict written file permissions.
- Refresh runtime config after successful writes so subsequent `/relay doctor` and `/relay connect` use the updated config.
- Cover behavior with shared metadata and parity tests so new messengers can opt into the same setup UX.
- Make Slack setup/pairing easier to complete from App Home or explicit channel pairing, without relying on slash-command text.
- Provide Slack prompt activity feedback anchored to the user's message/thread where Slack APIs allow it.

**Non-Goals:**

- Do not require a Pi core clipboard API; PiRelay will use best-effort local clipboard commands with a Pi editor fallback.
- Do not store raw bot tokens, signing secrets, app tokens, OAuth secrets, or pairing material in config through this flow.
- Do not replace platform setup requirements such as BotFather, Discord Developer Portal setup, or Slack app installation.
- Do not implement an arbitrary config editor for all PiRelay settings.
- Do not make Slack channel messages implicit or broad; channel pairing remains gated by explicit configuration.

## Decisions

### Use shared setup environment metadata

Define a messenger-neutral setup metadata structure for environment-backed fields. Each binding should describe the environment variable, recognizable sample placeholder, target config key, parsing kind, whether the field is required for the messenger's common live setup path, and whether it is secret-backed. Placeholder samples should be visibly fake but keep platform-specific shapes such as Slack `xoxb-…`/`xapp-…` prefixes and `T…`/`U…` ids.

Example shape:

```ts
interface RelaySetupEnvBinding {
  env: string;
  configKey: string;
  placeholder: string;
  kind: "secret-ref" | "string" | "string-list" | "boolean";
  required?: boolean;
}
```

The same metadata should drive both env snippet rendering and config-from-env writes. This avoids drift where the wizard tells users to set one variable while the writer reads another.

Alternative considered: keep hard-coded snippets and separately hard-code writer mappings. That is simpler initially but likely to diverge across messengers and violates the consistency goal.

### Copy snippets to the system clipboard with editor fallback

The wizard should offer an action that copies the selected messenger's env snippet to the system clipboard using a best-effort local clipboard command without closing the wizard. If no supported clipboard command is available, it should fall back to `ctx.ui.setEditorText()` and clearly notify the user while leaving the wizard open.

Alternative considered: only place snippets in the Pi editor. That is portable but does not solve the main copy/paste workflow for shell profiles.

### Write config references, not secret values

When an env var is defined for a secret field, the config writer should persist only the env var name:

```json
{
  "messengers": {
    "slack": {
      "default": {
        "tokenEnv": "PI_RELAY_SLACK_BOT_TOKEN",
        "signingSecretEnv": "PI_RELAY_SLACK_SIGNING_SECRET",
        "appTokenEnv": "PI_RELAY_SLACK_APP_TOKEN"
      }
    }
  }
}
```

For non-secret values, the writer may parse and persist the value, for example `workspaceId`, `applicationId`, `allowUserIds`, or booleans. This lets `/relay doctor` and `/relay connect` use stable non-secret setup values while secrets remain in the shell/profile/direnv environment.

Alternative considered: offer a prompt to store raw secrets in config with a warning. That may be convenient but is out of scope for the first iteration and weakens the safety model.

### Simplify setup wizard content into tabs

Render setup content as tab-like panels rather than a vertical panel list plus repeated body sections. The body should show only the selected tab's content: diagnostics, env snippet, config snippet, Slack app manifest, links, or troubleshooting. Copy/write actions belong in the footer help line so they are always discoverable without duplicating content in the body. Slack setup also includes a secret-free app manifest tab and footer copy action so users can paste the manifest directly into Slack's manifest editor. The manifest includes App Home messaging, DM events, Socket Mode, and `reactions:write` so Slack can show reaction-based thinking indicators. Pairing QR dialogs for Discord and Slack highlight the exact text command users need to send and provide a copy shortcut; Slack uses the same short PIN-style code as Discord because App Home QR links open the app but cannot prefill a long message on mobile.

Alternative considered: keep the existing vertical panel list and add an Actions section. That made the wizard feel overwhelming and repeated information already present in tabs or next-step guidance.

### Keep Slack channel routing explicit but resilient

Slack channel control should remain opt-in via `slack.allowChannelMessages`, and unpaired channel messages should explain the DM-vs-channel pairing paths. Once a channel is paired, follow-up commands such as `pirelay status` should continue routing even if the per-user active selection record is missing by falling back to the latest active channel binding for that conversation and restoring the active selection for the sender.

Pairing parsing should prefer the explicit non-slash `pirelay pair <pin>` command. Legacy `pirelay <pin>` and `/pirelay <pin>` forms remain accepted only when the value looks like a real pairing code so normal commands such as `pirelay status` are never reported as invalid pairing codes.

### Use Slack reactions as the primary thinking indicator

Slack does not expose a supported Socket Mode/Web API operation for apps to show the native human typing bubble. PiRelay should therefore use `reactions.add`/`reactions.remove` with `thinking_face` on accepted prompt messages. This anchors activity to the exact Slack message and works naturally in threads and channels. If reaction calls are unavailable or rejected because `reactions:write` is missing, PiRelay falls back to the existing ephemeral `Pi is working…` activity message with `thread_ts` when available.

Alternative considered: send a placeholder `Thinking…` bot message and update it with `chat.update`. That creates an additional message lifecycle to track, can race with the existing final-answer delivery path, and is noisier in shared channels.

### Preserve canonical config and merge selected messenger fields

The writer should read the existing active config path, canonicalize legacy shapes where practical, ensure `messengers.<kind>.default` exists, and merge only fields produced by the selected messenger's env bindings. It must preserve unrelated relay defaults, machine settings, other messenger instances, and unsupported/future config sections.

For fields whose env vars are not defined, the writer should leave existing config values untouched by default. This avoids accidentally deleting a working partial setup. If required env vars are missing, the wizard should explain what is missing and avoid writing a misleading "ready" config unless the user explicitly confirms a partial write.

Alternative considered: regenerate the whole config from the current wizard model. That is easier to reason about but risks destroying user-managed settings.

### Reuse the migration write safety pattern

Config writes should follow the existing migration safety posture:

1. Resolve the active config path.
2. Read existing JSON if present or start with `{}`.
3. Create a timestamped backup if the config file already exists.
4. Create the parent directory with restricted permissions.
5. Write pretty JSON with trailing newline.
6. `chmod 600` the target file.
7. Return a secret-safe summary including config path, backup path, and changed fields.

Alternative considered: write in place without backup. That is simpler but makes setup mistakes harder to recover from.

### Keep headless fallback useful but non-writing by default

When custom UI is unavailable, `/relay setup <messenger>` should continue returning secret-safe text guidance. It may include the placeholder env snippet and tell the user to rerun setup after exporting env vars, but config writing should remain an explicit interactive action or a future explicit command.

Alternative considered: automatically write config whenever env vars are present during `/relay setup`. That would be surprising because setup has historically been diagnostic/read-only except for Telegram runtime startup.

## Risks / Trade-offs

- **Users may expect real clipboard support** → Name the action "copy to clipboard" and document that the Pi editor is only a fallback when clipboard access is unavailable.
- **Partial env setup may produce confusing config** → Detect missing required env vars, show a clear warning, and default to not writing partial required setup.
- **Config merge may overwrite intentional manual values** → Only update fields whose env vars are currently defined, show a preview/summary before writing, and create a backup.
- **Telegram env naming is less canonical than Discord/Slack** → Support existing `TELEGRAM_BOT_TOKEN` and `PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS` for compatibility; if canonical `PI_RELAY_TELEGRAM_*` aliases are introduced, keep legacy aliases supported and documented.
- **Runtime config cache may stay stale after write** → Clear or refresh the extension's config cache after successful writes and tell users to rerun `/relay doctor`.
- **TUI wizard could become too complex** → Keep the first iteration to two actions plus existing panels: copy env snippet and write config from env.
