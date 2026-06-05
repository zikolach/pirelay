# Plan: address-pr70-remote-skill-review

Address the remaining actionable PR #70 review feedback for remote skill invocation. Older Copilot comments appear to have been answered in follow-up commits, but the latest review round still identifies current code paths that can misbehave when routes are stale, when users invoke skills while sessions are busy, or when shared messages expose Telegram-only command syntax to Discord/Slack users.

The goal is to make `/skills` and `/skill`/`relay skill` robust across local adapters and broker-owned Telegram: skill metadata lookup should not drop updates, skill delivery should honor configured busy-delivery semantics, and user-facing guidance should be platform-neutral or platform-specific where appropriate.

## Task: Make skill metadata lookup safe for stale or unavailable routes
Status: [x]

Update the in-process `getSkillCommands` path so stale extension references or missing live context cannot throw through `/skills` or `/skill` handling. Add regression coverage for stale/unavailable route skill listing and invocation paths, including broker bridge behavior if needed.

## Task: Use platform-neutral paused-skill messaging in shared helper
Status: [x]

Replace the shared `invokeRemoteSkill()` paused message that hard-codes `/resume` with neutral wording or a caller-provided command style. Add/update unit tests so Telegram, Discord, and Slack do not receive incorrect resume guidance from shared skill-invocation output.

## Task: Honor busy delivery mode for Telegram adapter skill invocation
Status: [x]

Pass the configured busy delivery mode into Telegram local `/skill` invocation and pending-skill-input completion so busy sessions queue skill prompts consistently and acknowledgements include the queued mode. Add regression tests for idle and busy Telegram skill invocation behavior.

## Task: Honor busy delivery mode for Discord and Slack skill invocation
Status: [ ]

Pass each adapter’s configured busy delivery mode into direct `relay skill` invocation and pending-skill-input completion for Discord and Slack. Add targeted adapter tests confirming busy sessions use the configured steer/follow-up mode and report it in the acknowledgement.

## Task: Honor busy delivery mode for broker-owned Telegram skill invocation
Status: [ ]

Update broker-owned Telegram skill delivery to choose `deliverAs` from `config.busyDeliveryMode` when the target route is busy, and include that mode in the accepted acknowledgement. Add broker/integration coverage for busy `/skill` and pending-input skill delivery.
