## Context

Current PiRelay combines channel-independent concepts (sessions, routes, latest output, answer choices, busy delivery, image retrieval) with Telegram-specific transport (Bot API methods, update shapes, callback data, Markdown constraints). Supporting more messengers cleanly requires separating these concerns.

## Goals / Non-Goals

**Goals:**
- Create interfaces for channel adapters and shared relay core behavior.
- Keep Telegram as a compatibility-preserving adapter.
- Make future Discord/Slack/Signal adapters additive rather than invasive.
- Normalize capabilities such as buttons, documents, images, activity indicators, and message limits.

**Non-Goals:**
- Implementing Discord, Slack, or Signal in this change.
- Renaming existing Telegram paths/config storage in a breaking way.
- Removing `/telegram-tunnel` commands.

## Architecture Sketch

```
Pi session actions
      ▲
      │
Relay core ── route registry ── latest output/images ── answer workflows
      │
      ├── Telegram adapter
      ├── Discord adapter later
      ├── Slack adapter later
      └── Signal adapter later
```

## Decisions

1. **Define normalized channel primitives.**
   Use internal types for `ChannelIdentity`, `InboundMessage`, `InboundAction`, `OutboundMessage`, `OutboundDocument`, `ActionButton`, and `ChannelCapabilities`.

2. **Adapters own protocol details.**
   Adapters parse updates, send messages, encode/decode callback ids, enforce platform message/document limits, and expose channel capabilities.

3. **Relay core owns Pi semantics.**
   The core resolves routes, authorization, busy delivery, answer/action state, latest outputs, pause/resume, and broker client interactions.

4. **Telegram compatibility is a hard requirement.**
   Existing config paths, state metadata, `/telegram-tunnel`, skill behavior, and Telegram Bot API features continue to work. Generic `/relay` commands can be aliases.

5. **Support capability degradation.**
   Some channels may lack buttons, typing indicators, or document transport. The core should choose fallbacks based on adapter capabilities.

## Risks / Trade-offs

- Refactoring a working Telegram runtime can introduce regressions; mitigate with characterization tests before and after extraction.
- Too generic an abstraction can hide useful channel features; keep escape hatches in adapter-specific metadata.
- Broker IPC may need versioning to support multiple channel adapters safely.
- State migration must preserve existing Telegram bindings.

## Migration Plan

1. Add normalized channel interfaces and adapter capability types.
2. Wrap existing Telegram API/runtime behavior in a Telegram adapter with minimal behavior changes.
3. Extract shared relay core for route resolution, prompt delivery, callbacks, and output retrieval.
4. Add generic `/relay` aliases and documentation.
5. Validate with the existing Telegram test suite plus new adapter interface tests.
