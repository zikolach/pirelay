## Why

PiRelay is accumulating features that conceptually sit between a messenger channel and a Pi session: media handling, redaction, progress shaping, approval gates, guided answers, and future audio accessibility. Without an explicit middleware layer, each channel adapter risks duplicating these behaviors or embedding them in channel-specific runtimes.

## What Changes

- Introduce a channel-neutral interaction middleware pipeline between channel adapters and relay core session delivery.
- Define normalized inbound/outbound interaction envelopes for messages, media, actions, approvals, progress, and accessibility transforms.
- Support ordered pre-processing, intent/action resolution, delivery hooks, and post-processing without requiring channel-specific duplication.
- Allow middleware to declare capabilities, ordering constraints, failure behavior, and privacy/safety boundaries.
- Preserve current Telegram behavior while preparing architecture for audio accessibility, approval gates, progress dashboards, document/media handling, translation, and policy/redaction middleware.

## Capabilities

### New Capabilities
- `relay-interaction-middleware`: defines a pluggable middleware pipeline for transforming, validating, enriching, and responding to channel-neutral relay interactions.

### Modified Capabilities

## Impact

- Affected code: future relay core, channel adapter interfaces, runtime/broker event flow, action/callback routing, media handling, tests, and documentation.
- This change should align with `add-channel-adapter-architecture`; it can be implemented together with or immediately after that refactor.
- Existing `/telegram-tunnel` commands, Telegram pairing, prompt delivery, guided answers, images, and output retrieval must remain behaviorally compatible.
