# Slack live integration suite

The Slack live integration suite is opt-in and runs only when disposable Slack workspace credentials are supplied. It validates two installed Slack apps, launches two isolated PiRelay instances, sends targeted Slack traffic, and verifies the result from Slack API-visible message history.

Do not use production tokens, private channels with real work, hidden prompts, or long-lived pairing codes for this suite.

## Required Slack workspace setup

Create or select a disposable Slack workspace and a disposable test channel. Install two separate Slack apps/bots in the same workspace and invite both apps to the test channel.

Each app should have:

- a Bot User OAuth token (`xoxb-...`)
- an app signing secret
- Socket Mode enabled with an app-level token (`xapp-...`) for local runs, or a webhook endpoint capable of delivering raw Slack request bodies
- bot scopes:
  - `chat:write`
  - `app_mentions:read`
  - `channels:read` and `channels:history` for public channels, or `groups:read` and `groups:history` for private channels
- event subscriptions for message/app-mention delivery in the target channel
- membership in the target channel

The harness also needs a driver token that can post test prompts to the channel as an authorized Slack user. The user id for that token must be listed as the authorized PiRelay user.

## App manifests

Template manifests are checked in under `docs/slack-app-manifests/`:

- `pirelay-live-bot-a.yaml`
- `pirelay-live-bot-b.yaml`
- `pirelay-live-driver.yaml`

Create each app at https://api.slack.com/apps with **Create New App → From an app manifest**, paste the matching YAML, and install it to the disposable workspace. For Bot A and Bot B, create an app-level token with the `connections:write` scope after enabling Socket Mode; Slack does not include app-level tokens in the manifest output. Invite all three apps to the test channel, then copy the Bot User OAuth tokens, signing secrets, app-level tokens, and bot user IDs into the local environment/script.

## Environment variables

Set these variables only in a secure local shell or CI secret store:

```bash
export PI_RELAY_SLACK_LIVE_ENABLED=true
export PI_RELAY_SLACK_LIVE_WORKSPACE_ID=T123...
export PI_RELAY_SLACK_LIVE_CHANNEL_ID=C123...   # or G123... for private channels
export PI_RELAY_SLACK_LIVE_AUTHORIZED_USER_ID=U123...
export PI_RELAY_SLACK_LIVE_DRIVER_TOKEN=xoxp-or-test-driver-token
export PI_RELAY_SLACK_LIVE_EVENT_MODE=socket    # default; use webhook only with external delivery

export PI_RELAY_SLACK_LIVE_BOT_A_TOKEN=xoxb-...
export PI_RELAY_SLACK_LIVE_BOT_A_SIGNING_SECRET=...
export PI_RELAY_SLACK_LIVE_BOT_A_APP_TOKEN=xapp-...
export PI_RELAY_SLACK_LIVE_BOT_A_USER_ID=UAPP_A # optional but recommended
export PI_RELAY_SLACK_LIVE_BOT_A_PI_COMMAND='tail -f /dev/null | pi --extension /path/to/pirelay/extensions/relay/index.ts --mode rpc'

export PI_RELAY_SLACK_LIVE_BOT_B_TOKEN=xoxb-...
export PI_RELAY_SLACK_LIVE_BOT_B_SIGNING_SECRET=...
export PI_RELAY_SLACK_LIVE_BOT_B_APP_TOKEN=xapp-...
export PI_RELAY_SLACK_LIVE_BOT_B_USER_ID=UAPP_B # optional but recommended
export PI_RELAY_SLACK_LIVE_BOT_B_PI_COMMAND='tail -f /dev/null | pi --extension /path/to/pirelay/extensions/relay/index.ts --mode rpc'
```

Optional:

```bash
export PI_RELAY_SLACK_LIVE_TIMEOUT_MS=120000
export PI_RELAY_SLACK_LIVE_BOT_A_INSTANCE_ID=slack-live-a
export PI_RELAY_SLACK_LIVE_BOT_B_INSTANCE_ID=slack-live-b
export PI_RELAY_SLACK_LIVE_BOT_A_DISPLAY_NAME='PiRelay Slack A'
export PI_RELAY_SLACK_LIVE_BOT_B_DISPLAY_NAME='PiRelay Slack B'
```

The harness writes per-instance config files under a temporary directory, points each Pi process at a distinct `PI_RELAY_CONFIG`/`PI_RELAY_STATE_DIR`, and passes the relevant Slack token/signing-secret/app-level token values via environment variables. Temporary state is deleted during teardown so repeated runs do not reuse stale local bindings. The live harness enables a test-only pre-seeded binding path for its disposable channel so targeted prompts exercise real runtime prompt routing and completion notifications without committing pairing codes. Production Socket Mode uses the same token shape: a bot token (`xoxb-...`) plus an app-level token (`xapp-...`) with `connections:write`. Prefer namespaced PiRelay config (`tokenEnv`, `signingSecretEnv`, and `appTokenEnv`) for non-test runs; `PI_RELAY_SLACK_BOT_USER_ID`/`slack.botUserId` is only a non-secret fallback when startup `auth.test` discovery is unavailable. The live harness also enables the bounded history-polling fallback for diagnostics, but production prompt routing should use Socket Mode events.

## Running locally

```bash
npm run test -- tests/slack-live-integration.test.ts
```

When `PI_RELAY_SLACK_LIVE_ENABLED` or required credentials are absent, the test is skipped and prints which configuration is missing. The normal `npm test` run is safe without live Slack secrets.

## CI guidance

- Use a dedicated Slack test workspace and channel.
- Store tokens and signing secrets as masked CI secrets.
- Run the live test as a separate, manually triggered or scheduled job rather than in every unit-test job.
- Rotate credentials if any CI log, artifact, or failure output unexpectedly contains a secret.

## Preflight failures

The preflight fails before sending test traffic when it detects:

- a token installed in the wrong workspace
- missing bot scopes needed to post/read/channel-observe
- missing channel membership
- missing Socket Mode app-level token or failed `apps.connections.open`
- missing webhook signing secret when webhook mode is selected

Failure output is redacted with Slack token/signing-secret patterns and known configured secret values before it is stored in test observations or assertion messages.
