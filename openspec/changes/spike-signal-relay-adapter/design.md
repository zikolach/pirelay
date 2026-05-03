## Context

Signal support is qualitatively different from Telegram, Discord, and Slack. Common automation uses `signal-cli`, which may require a linked device, Java runtime, local daemon or DBus mode, phone number management, and careful operational setup. This can be acceptable for advanced users but may be too fragile for a packaged Pi extension.

## Goals / Non-Goals

**Goals:**
- Determine whether Signal support is technically and operationally viable.
- Document setup, dependencies, security model, and maintenance risks.
- Test whether text, attachments, typing/read state, and identity mapping can satisfy PiRelay needs.
- Produce a clear go/no-go recommendation.

**Non-Goals:**
- Shipping production Signal support in this spike.
- Adding Signal dependencies to the npm package by default.
- Supporting unofficial services that require sharing Signal credentials with third parties.

## Investigation Plan

1. Review `signal-cli` install, linking, daemon, JSON-RPC/DBus, and attachment APIs.
2. Test local send/receive feasibility with a disposable or explicitly approved Signal identity.
3. Map Signal features to relay adapter capabilities: text, files/images, buttons fallback, typing, message length, authorization identity, and pairing.
4. Assess packaging implications for macOS/Linux, Java, config paths, and daemon lifecycle.
5. Assess security/privacy risks of local Signal storage and session export.
6. Recommend one of: implement adapter, defer pending upstream maturity, or reject.

## Risks / Trade-offs

- `signal-cli` setup can be brittle and user-hostile compared with bot-token channels.
- Signal does not provide inline buttons; all interactions need text fallbacks.
- Device linking and message storage may create local privacy risks.
- Supporting Signal may significantly increase support burden.

## Output

The spike should end with a short feasibility report covering tested setup, capability matrix, risks, and recommendation. If viable, create a follow-up implementation proposal for a production Signal adapter.
