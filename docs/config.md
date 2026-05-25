# Configuration

PiRelay uses a namespaced configuration file at:

```text
~/.pi/agent/pirelay/config.json
```

Environment variables can still provide secrets and deployment overrides. Legacy Telegram tunnel env vars and state/config paths are accepted only as migration fallbacks.

## Canonical schema

```json
{
  "relay": {
    "machineId": "laptop",
    "stateDir": "~/.pi/agent/pirelay",
    "brokerGroup": "personal",
    "brokerPeers": []
  },
  "defaults": {
    "pairingExpiryMs": 300000,
    "busyDeliveryMode": "followUp",
    "maxTextChars": 3900,
    "maxInboundImageBytes": 10485760,
    "maxOutboundImageBytes": 10485760,
    "allowedImageMimeTypes": ["image/jpeg", "image/png", "image/webp"]
  },
  "messengers": {
    "telegram": {
      "default": {
        "enabled": true,
        "tokenEnv": "TELEGRAM_BOT_TOKEN",
        "allowUserIds": ["123456789"],
        "ingressPolicy": { "kind": "owner", "machineId": "laptop" }
      }
    },
    "discord": {
      "personal": {
        "enabled": true,
        "tokenEnv": "PI_RELAY_DISCORD_BOT_TOKEN",
        "applicationId": "123456789012345678",
        "allowUserIds": ["123456789012345678"]
      }
    },
    "slack": {
      "work": {
        "enabled": false,
        "tokenEnv": "PI_RELAY_SLACK_BOT_TOKEN",
        "signingSecretEnv": "PI_RELAY_SLACK_SIGNING_SECRET",
        "appTokenEnv": "PI_RELAY_SLACK_APP_TOKEN",
        "appId": "A0123456789",
        "workspaceId": "T012345"
      }
    }
  }
}
```

Messenger instances are addressed as `<kind>:<instance>`, for example `telegram:default`, `discord:personal`, or `slack:work`. The `:default` suffix can be omitted in commands.

For Discord, `applicationId` is the Discord Developer Portal → General Information → Application ID (`clientId` is accepted as an alias because Discord OAuth URLs call the same value `client_id`). It is used by `/relay setup discord` for the Discord OAuth2 bot invite URL and by `/relay connect discord` to render a QR code to the bot profile/DM link. Short Discord PIN pairing still requires local Pi approval unless the user is listed in `allowUserIds` or trusted locally from a previous approval. Use `/relay trusted` to inspect locally trusted users and `/relay untrust <messenger> <userId>` to revoke that local trust without editing config.

For Slack, `/relay setup slack` can copy a ready-to-paste app manifest with App Home messages, Socket Mode, interactivity, `/relay`, DM events, and required scopes. Set `appId` (or `PI_RELAY_SLACK_APP_ID`) from Basic Information → App Credentials → App ID to let `/relay setup slack` and `/relay connect slack` render an App Home QR/open link. `/relay connect slack` highlights a short `relay pair 123-456` PIN command and `c` copies it for paste; either open the App Home DM from the QR/link and paste the command there, or invite the app to a channel and paste the command in that channel after enabling `slack.allowChannelMessages`. Slack DMs require App Home → Messages Tab → Allow users to send messages to your app, plus the `message.im` bot event, `im:history`/`im:read` scopes, interactivity, the `/relay` slash command, `reactions:write` for thinking indicators, and `files:write` for `relay images`, `relay send-image`, requester-scoped `relay send-file`, local `/relay send-file slack ...`, and large-output Markdown fallback; reinstall the app after changing scopes, slash commands, or App Home settings.

Run `/relay setup <messenger>` in Pi for an interactive secret-safe setup wizard when TUI is available. The wizard uses tab-like navigation for diagnostics, env snippet, config snippet, Slack app manifest, links, and troubleshooting so each tab shows only its own content. Press `c` to copy the messenger env snippet to the system clipboard, press `m` in Slack setup to copy the app manifest, with a Pi editor fallback when no clipboard command is available. After exporting env vars, press `w` to write/update canonical config from the current environment; PiRelay stores env var names for secrets and never writes resolved token/signing-secret values through this flow. Headless/no-UI runs keep the plain text guidance and never write config implicitly.

## Commands

```text
/relay doctor
/relay setup telegram
/relay setup discord:personal
/relay connect telegram docs
/relay connect discord:personal api
```

`/telegram-tunnel ...` is removed. Use `/relay ...`.

## Environment fallback

Preferred secret style is `tokenEnv` / `signingSecretEnv` in the namespaced config. PiRelay also recognizes these existing variables as fallbacks:

- `TELEGRAM_BOT_TOKEN`
- `PI_RELAY_DISCORD_BOT_TOKEN`
- `PI_RELAY_DISCORD_APPLICATION_ID` (`PI_RELAY_DISCORD_CLIENT_ID` is accepted as an alias)
- `PI_RELAY_SLACK_BOT_TOKEN`
- `PI_RELAY_SLACK_SIGNING_SECRET`
- approval gate overrides: `PI_RELAY_APPROVAL_ENABLED`, `PI_RELAY_APPROVAL_TIMEOUT_MS`, `PI_RELAY_APPROVAL_SESSION_GRANTS`, `PI_RELAY_APPROVAL_REMOTE_PERSISTENT_GRANTS`, and `PI_RELAY_APPROVAL_RULES_JSON`
- legacy `PI_TELEGRAM_TUNNEL_*` variables during migration

Diagnostics never print token, signing-secret, or raw approval-rule secret values.

## Multi-machine shared bot setup

Run one PiRelay broker per machine. If the same bot/account is configured on multiple machines, configure one ingress owner for that messenger instance and broker peers/federation for the other machines. PiRelay blocks ambiguous duplicate polling instead of letting multiple brokers race on the same bot token.

For no-federation shared rooms, use one dedicated bot/app identity per machine in the same messenger room:

- Telegram: invite each machine bot to the group/supergroup. Enable BotFather Bot-to-Bot Communication Mode for both bots only when testing bot-authored workflows; `/command@bot` addressed commands remain the reliable privacy-mode fallback.
- Discord: enable guild-channel shared rooms only with dedicated applications, allowed guild ids, Message Content Intent, and channel permissions. Prefer `relay <command>` and mentions over platform slash-command assumptions.
- Slack: channel events, app mentions, ordinary channel text, and `relay <command>` fallbacks are supported only after `allowChannelMessages`, shared-room enablement, app invitation, and explicit channel pairing are configured.

Agent delegation is disabled by default. Enable it per messenger instance with a `delegation` block, for example:

```json
{
  "relay": { "machineId": "laptop", "capabilities": ["linux-tests"] },
  "messengers": {
    "discord": {
      "default": {
        "sharedRoom": { "enabled": true },
        "delegation": {
          "enabled": true,
          "autonomy": "propose-only",
          "trustedPeers": [
            { "peerId": "1234567890", "allowCreate": true, "targetMachineIds": ["laptop"] }
          ]
        }
      }
    }
  }
}
```

Supported autonomy levels are `off`, `propose-only`, `auto-claim-targeted`, and `auto-claim-safe-capability`. Peer-bot trust is separate from human `allowUserIds`; do not put tokens, hidden prompts, transcripts, or raw tool inputs in delegation task goals.

See `docs/shared-room-parity.md` for the current parity matrix and `docs/agent-collaboration-playbooks.md` for a concrete two-agent project workflow.

## Communication diagnostics

Communication diagnostics are opt-in local JSONL logs for troubleshooting runtime, broker, adapter, and final assistant extraction behavior. They are disabled by default.

```json
{
  "communicationDiagnostics": {
    "enabled": true,
    "maxFileBytes": 2097152,
    "maxFiles": 5,
    "includeContentPreview": false
  }
}
```

Environment overrides include `PI_RELAY_COMMUNICATION_DIAGNOSTICS`, `PI_RELAY_DIAGNOSTICS_LOG_PATH`, `PI_RELAY_DIAGNOSTICS_MAX_BYTES`, `PI_RELAY_DIAGNOSTICS_MAX_FILES`, `PI_RELAY_DIAGNOSTICS_INCLUDE_CONTENT_PREVIEW`, and `PI_RELAY_DIAGNOSTICS_PREVIEW_CHARS`. Keep content previews disabled unless you explicitly need short redacted snippets. See `docs/communication-diagnostics.md`.

## Approval gates

Approval gates are explicit opt-in guardrails for remote turns. When enabled, matching Pi tool calls pause before execution and ask the active authorized requester to approve or deny the operation through Telegram, Discord, or Slack. Timeout, stale actions, revoked/paused bindings, offline sessions, or delivery failures block the operation; approval gates are not a sandbox.

Example:

```json
{
  "approvalGates": {
    "enabled": true,
    "timeoutMs": 120000,
    "sessionGrants": true,
    "sessionGrantTtlMs": 3600000,
    "allowRemotePersistentGrants": false,
    "rules": [
      { "id": "git-push", "tools": ["bash"], "categories": ["git-remote"], "commandPatterns": ["git push"] },
      { "id": "publish", "tools": ["bash"], "categories": ["publish"], "commandPatterns": ["npm publish", "docker push"] },
      { "id": "destructive-shell", "tools": ["bash"], "categories": ["destructive"] },
      { "id": "protected-files", "tools": ["write", "edit"], "pathPatterns": ["package.json", ".github/workflows/"] }
    ]
  }
}
```

Approval requests show bounded redacted summaries only. Buttons offer Approve once, Deny, and optionally Approve for session. Text fallback is `relay approval approve <id>`, `relay approval approve-session <id>`, or `relay approval deny <id>`. Remote persistent grants are hidden unless `allowRemotePersistentGrants` is explicitly true; keep that disabled unless you have a clear revocation/audit process.

`/relay doctor` reports whether approval gates are enabled, the number of rules, timeout, grant scopes, and risky settings without printing raw secrets or unredacted command data. `/relay approvals` shows recent bounded non-secret approval audit events for the current session.

## Migration from legacy Telegram tunnel config/state

Legacy files under `~/.pi/agent/telegram-tunnel` are read as migration input. Active non-secret Telegram bindings migrate to `messengers.telegram.default`; active pairing nonces are not copied, so create a fresh pairing with `/relay connect telegram` when needed.

When `/relay doctor` detects legacy top-level config keys, it asks whether to migrate the config file to the namespaced schema, creates a timestamped backup, and writes the migrated file with `0600` permissions. If the canonical PiRelay config is missing but `~/.pi/agent/telegram-tunnel/config.json` exists, doctor can copy that legacy config to `~/.pi/agent/pirelay/config.json` after confirmation.

After migration, keep secrets in environment variables or namespaced `messengers.*.*.tokenEnv` references, and protect config/state files with:

```bash
chmod 600 ~/.pi/agent/pirelay/config.json
```

## Platform setup links

- Telegram BotFather: <https://core.telegram.org/bots/features#botfather>
- Discord Developer Portal: <https://discord.com/developers/docs/quick-start/getting-started>
- Slack app setup: <https://api.slack.com/apps>
