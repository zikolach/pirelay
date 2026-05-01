## Why

PiRelay's product name is broader than Telegram, but the current implementation is tightly coupled to Telegram transport concepts. A channel adapter architecture would let PiRelay support Discord, Slack, Signal, Matrix, or future channels without duplicating session routing, authorization, answer workflows, and media handling.

## What Changes

- Introduce a channel-neutral relay core with adapters for channel-specific transport.
- Extract Telegram behavior behind a first adapter while preserving existing `/telegram-tunnel` commands and config compatibility.
- Define normalized inbound messages, callbacks/actions, outbound text/documents/images, typing/activity, identity, and capabilities.
- Add generic `/relay ...` command aliases for future multi-channel workflows while retaining `/telegram-tunnel ...`.
- Document how new channel adapters should implement pairing, authorization, transport limits, and broker integration.

## Capabilities

### New Capabilities
- `relay-channel-adapters`: defines channel-neutral relay core and adapter behavior for current and future messaging channels.

### Modified Capabilities

## Impact

- Affected code: runtime/broker structure, Telegram API wrappers, callback/action abstractions, config loading, docs, tests.
- Existing Telegram behavior should remain functionally unchanged.
- This change is an architectural prerequisite for Discord, Slack, Signal, or Matrix adapters.
