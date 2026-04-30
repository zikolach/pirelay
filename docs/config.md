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
  "maxInboundImageBytes": 10485760,
  "maxOutboundImageBytes": 10485760,
  "maxLatestImages": 4,
  "allowedImageMimeTypes": ["image/jpeg", "image/png", "image/webp"],
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
- `PI_TELEGRAM_TUNNEL_MAX_INBOUND_IMAGE_BYTES`
- `PI_TELEGRAM_TUNNEL_MAX_OUTBOUND_IMAGE_BYTES`
- `PI_TELEGRAM_TUNNEL_MAX_LATEST_IMAGES`
- `PI_TELEGRAM_TUNNEL_ALLOWED_IMAGE_MIME_TYPES`

`PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS` and `PI_TELEGRAM_TUNNEL_ALLOWED_IMAGE_MIME_TYPES` are comma-separated lists.

## Troubleshooting

- invalid token format: check `TELEGRAM_BOT_TOKEN`
- no Telegram response: run `/telegram-tunnel setup` and confirm the bot username resolves
- image prompt rejected: switch Pi to a model with image input support, reduce file size, or use one of the configured MIME types
- `/images` finds no image after Pi saved a file: make sure the latest Pi reply mentioned the relative workspace path, or use `/send-image <relative-path>`; absolute, hidden, traversal, symlink-outside-workspace, oversized, and non-image files are rejected
- pairing expires: rerun `/telegram-tunnel connect`
- permission warning: `chmod 600 ~/.pi/agent/telegram-tunnel/config.json`
