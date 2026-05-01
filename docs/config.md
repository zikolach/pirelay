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
  "progressMode": "normal",
  "progressIntervalMs": 30000,
  "verboseProgressIntervalMs": 10000,
  "recentActivityLimit": 10,
  "maxProgressMessageChars": 700,
  "discord": {
    "enabled": false,
    "botToken": "<discord-bot-token>",
    "allowUserIds": ["123456789012345678"],
    "allowGuildChannels": false,
    "maxTextChars": 2000,
    "maxFileBytes": 8388608,
    "allowedImageMimeTypes": ["image/jpeg", "image/png", "image/webp"]
  },
  "slack": {
    "enabled": false,
    "botToken": "xoxb-...",
    "signingSecret": "<slack-signing-secret>",
    "workspaceId": "T012345",
    "allowUserIds": ["U012345"],
    "allowChannelMessages": false,
    "maxTextChars": 3000,
    "maxFileBytes": 10485760,
    "allowedImageMimeTypes": ["image/jpeg", "image/png", "image/webp"]
  },
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
- `PI_TELEGRAM_TUNNEL_PROGRESS_MODE`
- `PI_TELEGRAM_TUNNEL_PROGRESS_INTERVAL_MS`
- `PI_TELEGRAM_TUNNEL_VERBOSE_PROGRESS_INTERVAL_MS`
- `PI_TELEGRAM_TUNNEL_RECENT_ACTIVITY_LIMIT`
- `PI_TELEGRAM_TUNNEL_MAX_PROGRESS_CHARS`
- `PI_RELAY_DISCORD_ENABLED`
- `PI_RELAY_DISCORD_BOT_TOKEN`
- `PI_RELAY_DISCORD_ALLOW_USER_IDS`
- `PI_RELAY_DISCORD_ALLOW_GUILD_CHANNELS`
- `PI_RELAY_DISCORD_MAX_TEXT_CHARS`
- `PI_RELAY_DISCORD_MAX_FILE_BYTES`
- `PI_RELAY_DISCORD_ALLOWED_IMAGE_MIME_TYPES`
- `PI_RELAY_SLACK_ENABLED`
- `PI_RELAY_SLACK_BOT_TOKEN`
- `PI_RELAY_SLACK_SIGNING_SECRET`
- `PI_RELAY_SLACK_WORKSPACE_ID`
- `PI_RELAY_SLACK_ALLOW_USER_IDS`
- `PI_RELAY_SLACK_ALLOW_CHANNEL_MESSAGES`
- `PI_RELAY_SLACK_MAX_TEXT_CHARS`
- `PI_RELAY_SLACK_MAX_FILE_BYTES`
- `PI_RELAY_SLACK_ALLOWED_IMAGE_MIME_TYPES`

`PI_TELEGRAM_TUNNEL_ALLOW_USER_IDS`, Discord/Slack allow-user lists, and image MIME-type variables are comma-separated lists. `progressMode` can be `quiet`, `normal`, `verbose`, or `completionOnly`; Telegram users can override it per binding with `/progress`.

Discord and Slack configuration is intentionally namespaced so tokens/signing secrets are not confused with Telegram credentials. The current package includes DM-first adapter foundations with mockable platform clients; Telegram remains the default live runtime until a platform client is wired by an integration.

## Troubleshooting

- invalid token format: check `TELEGRAM_BOT_TOKEN`
- no Telegram response: run `/telegram-tunnel setup` and confirm the bot username resolves
- too many progress messages: use `/progress quiet` for the paired session or increase `progressIntervalMs`
- image prompt rejected: switch Pi to a model with image input support, reduce file size, or use one of the configured MIME types
- `/images` finds no image after Pi saved a file: make sure the latest Pi reply mentioned the relative workspace path, or use `/send-image <relative-path>`; absolute, hidden, traversal, symlink-outside-workspace, oversized, and non-image files are rejected
- pairing expires: rerun `/telegram-tunnel connect`
- permission warning: `chmod 600 ~/.pi/agent/telegram-tunnel/config.json`
