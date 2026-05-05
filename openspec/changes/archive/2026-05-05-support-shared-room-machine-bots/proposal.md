## Why

PiRelay currently treats multi-machine control as a broker-federation problem when a single bot/account is shared across machines. Users also need a no-hosted-infrastructure mode where each machine owns a dedicated bot/app token and multiple machine bots participate in one messenger room, allowing a single visible chat per messenger to steer sessions across machines without brokers directly communicating.

## What Changes

- Introduce a shared-room machine-bot operating mode where each broker owns only its local sessions and its own messenger bot/app tokens.
- Allow multiple machine-specific bots/apps to coexist in one group/channel/shared room and coordinate active-session selection through visible messenger commands rather than broker-to-broker networking.
- Add machine-aware remote selectors such as `/use <machine> <session>` and `/to <machine> <session> <prompt>` for rooms that contain more than one PiRelay machine bot.
- Define conservative duplicate-prevention rules: a broker acts only when explicitly addressed or when the room/user active selection points to one of its local sessions; otherwise it remains silent.
- Define platform capability and setup requirements for shared rooms, including Telegram group privacy-mode limitations, Discord/Slack channel visibility, bot mentions, and text fallback behavior.
- Add diagnostics and safeguards for isolated mode: same bot token/account must not be configured on multiple unaware brokers; shared rooms require distinct machine bot identities.

## Capabilities

### New Capabilities
- `shared-room-machine-bots`: Defines no-federation multi-machine operation using one dedicated bot/app token per machine and one shared messenger room per platform.

### Modified Capabilities
- `messenger-relay-sessions`: Extends session selection and command routing semantics for machine-aware shared-room operation across independent brokers.
- `relay-broker-topology`: Clarifies isolated broker mode, duplicate-token safeguards, and the boundary between shared-room coordination and broker federation.
- `relay-configuration`: Adds configuration and diagnostics requirements for machine bot identity, shared-room readiness, and duplicate token/account detection.
- `relay-channel-adapters`: Adds adapter capability expectations for group/channel shared-room visibility, mention addressing, and safe silence behavior.

## Impact

- Affected areas: relay config schema/loader/diagnostics, remote command parsing, session selection helpers, messenger adapter runtimes, broker/runtime routing guards, state for active selections, setup guidance, and parity tests.
- No hosted PiRelay service or broker-to-broker transport is introduced by this change.
- No production support for sharing one bot token across unaware brokers is added; that remains a broker-federation/ingress-ownership problem.
- Platform-specific setup may require user action, such as disabling Telegram bot privacy mode for plain-text active-session prompts in groups or using mention/command-only fallback where full room visibility is unavailable.
