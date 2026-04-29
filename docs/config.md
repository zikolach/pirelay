# Configuration

## Sources

The tunnel loads configuration from:

1. environment variables
2. `~/.pi/agent/telegram-tunnel/config.json`
3. overrides from `PI_TELEGRAM_TUNNEL_CONFIG` or `PI_TELEGRAM_TUNNEL_STATE_DIR`

Environment variables win over file values.

## Keys

```json
{
  "botToken": "<telegram-bot-token>",
  "TELEGRAM_BOT_TOKEN": "<telegram-bot-token>",
  "stateDir": "~/.pi/agent/telegram-tunnel",
  "pairingExpiryMs": 300000,
  "busyDeliveryMode": "followUp",
  "allowUserIds": [123456789],
  "summaryMode": "deterministic",
  "maxTelegramMessageChars": 3900,
  "sendRetryCount": 3,
  "sendRetryBaseMs": 800,
  "pollingTimeoutSeconds": 20,
  "redactionPatterns": ["token\\s*[:=]\\s*\\S+"]
}
```

## Environment variables

- `TELEGRAM_BOT_TOKEN`
- `PI_TELEGRAM_TUNNEL_CONFIG`
- `PI_TELEGRAM_TUNNEL_STATE_DIR`
- `PI_TELEGRAM_TUNNEL_PAIRING_EXPIRY_MS`
- `PI_TELEGRAM_TUNNEL_BUSY_MODE`
- `PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS`
- `PI_TELEGRAM_TUNNEL_SUMMARY_MODE`
- `PI_TELEGRAM_TUNNEL_MAX_MESSAGE_CHARS`
- `PI_TELEGRAM_TUNNEL_SEND_RETRY_COUNT`
- `PI_TELEGRAM_TUNNEL_SEND_RETRY_BASE_MS`
- `PI_TELEGRAM_TUNNEL_POLLING_TIMEOUT_SECONDS`

`PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS` is a comma-separated list.

## Troubleshooting

- invalid token format: check `TELEGRAM_BOT_TOKEN`
- no Telegram response: run `/telegram-tunnel setup` and confirm the bot username resolves
- pairing expires: rerun `/telegram-tunnel connect`
- permission warning: `chmod 600 ~/.pi/agent/telegram-tunnel/config.json`
