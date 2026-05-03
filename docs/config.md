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
        "clientId": "123456789012345678",
        "allowUserIds": ["123456789012345678"]
      }
    },
    "slack": {
      "work": {
        "enabled": false,
        "tokenEnv": "PI_RELAY_SLACK_BOT_TOKEN",
        "signingSecretEnv": "PI_RELAY_SLACK_SIGNING_SECRET",
        "workspaceId": "T012345"
      }
    }
  }
}
```

Messenger instances are addressed as `<kind>:<instance>`, for example `telegram:default`, `discord:personal`, or `slack:work`. The `:default` suffix can be omitted in commands.

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
- `PI_RELAY_DISCORD_CLIENT_ID`
- `PI_RELAY_SLACK_BOT_TOKEN`
- `PI_RELAY_SLACK_SIGNING_SECRET`
- legacy `PI_TELEGRAM_TUNNEL_*` variables during migration

Diagnostics never print token or signing-secret values.

## Multi-machine shared bot setup

Run one PiRelay broker per machine. If the same bot/account is configured on multiple machines, configure one ingress owner for that messenger instance and broker peers/federation for the other machines. PiRelay blocks ambiguous duplicate polling instead of letting multiple brokers race on the same bot token.

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
