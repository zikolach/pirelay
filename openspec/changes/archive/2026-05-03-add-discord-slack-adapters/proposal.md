## Why

Discord and Slack are the most practical next channels after Telegram: Discord fits developer/community workflows, while Slack fits team and workplace approvals. Adding them after the channel adapter architecture would validate PiRelay as a multi-channel relay rather than a Telegram-only bridge.

## What Changes

- Add a Discord adapter for DM-first PiRelay pairing, prompting, status, output retrieval, images/documents, and buttons.
- Add a Slack adapter for app-based DM-first PiRelay pairing, prompting, status, output retrieval, images/documents, and buttons.
- Reuse the channel-neutral relay core, authorization, answer workflow, progress/dashboard, and media behavior where available.
- Keep channel-specific configuration and secrets isolated from Telegram configuration.
- Initially avoid public channel/group control unless explicitly configured later.

## Capabilities

### New Capabilities
- `discord-relay-adapter`: defines Discord DM adapter behavior for PiRelay.
- `slack-relay-adapter`: defines Slack app/DM adapter behavior for PiRelay.

### Modified Capabilities

## Impact

- Requires `add-channel-adapter-architecture` or equivalent adapter core to be implemented first.
- Affected code: new adapters, config, broker startup/routing, docs, tests, and packaging dependencies.
- New external setup: Discord bot token/application; Slack app credentials and OAuth/install flow or bot token setup.
