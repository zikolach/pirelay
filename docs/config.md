# Configuration

PiRelay uses a namespaced configuration file at:

```text
~/.pi/agent/relay/config.json
```

Environment variables can still provide secrets and deployment overrides. Legacy Telegram tunnel env vars and state/config paths are accepted only as migration fallbacks.

## Canonical schema

```json
{
  "relay": {
    "machineId": "laptop",
    "stateDir": "~/.pi/agent/relay",
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
- legacy `PI_TELEGRAM_TUNNEL_*` variables during migration

Diagnostics never print token or signing-secret values.

## Multi-machine shared bot setup

Run one PiRelay broker per machine. If the same bot/account is configured on multiple machines, configure one ingress owner for that messenger instance and broker peers/federation for the other machines. PiRelay blocks ambiguous duplicate polling instead of letting multiple brokers race on the same bot token.

For no-federation shared rooms, use one dedicated bot/app identity per machine in the same messenger room:

- Telegram: invite each machine bot to the group/supergroup. Enable BotFather Bot-to-Bot Communication Mode for both bots only when testing bot-authored workflows; `/command@bot` addressed commands remain the reliable privacy-mode fallback.
- Discord: enable guild-channel shared rooms only with dedicated applications, allowed guild ids, Message Content Intent, and channel permissions. Prefer `relay <command>` and mentions over platform slash-command assumptions.
- Slack: channel events and app mentions can be configured, but Slack shared-room ordinary text/channel command/media pre-routing is diagnostic/deferred until explicit runtime support exists. Keep channel control disabled unless you are testing that gap deliberately.

See `docs/shared-room-parity.md` for the current parity matrix.

## Migration from legacy Telegram tunnel config/state

Legacy files under `~/.pi/agent/telegram-tunnel` are read as migration input. Active non-secret Telegram bindings migrate to `messengers.telegram.default`; active pairing nonces are not copied, so create a fresh pairing with `/relay connect telegram` when needed.

When `/relay doctor` detects legacy top-level config keys, it asks whether to migrate the config file to the namespaced schema, creates a timestamped backup, and writes the migrated file with `0600` permissions. If the canonical PiRelay config is missing but `~/.pi/agent/telegram-tunnel/config.json` exists, doctor can copy that legacy config to `~/.pi/agent/relay/config.json` after confirmation.

After migration, keep secrets in environment variables or namespaced `messengers.*.*.tokenEnv` references, and protect config/state files with:

```bash
chmod 600 ~/.pi/agent/relay/config.json
```

## Platform setup links

- Telegram BotFather: <https://core.telegram.org/bots/features#botfather>
- Discord Developer Portal: <https://discord.com/developers/docs/quick-start/getting-started>
- Slack app setup: <https://api.slack.com/apps>
