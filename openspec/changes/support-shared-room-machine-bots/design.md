## Context

PiRelay already has machine-local brokers, messenger-neutral contracts, active selection state keyed by messenger/conversation/user, and OpenSpec requirements for broker federation. Federation is the right answer when one shared bot/account must control sessions on multiple machines, but it requires a reachable coordination path between brokers and one ingress owner per bot/account.

This change defines a simpler no-federation topology: every machine has its own dedicated bot/app token per messenger, and those machine bots are invited into the same user-visible messenger room. The shared room becomes the coordination surface. Brokers remain independent and observe the same command timeline through their own bot identities; no hosted PiRelay service and no broker-to-broker transport are required.

## Goals / Non-Goals

**Goals:**

- Support multi-machine PiRelay control without broker federation by using one bot/app identity per machine.
- Allow a single group/channel/shared room per messenger to contain multiple PiRelay machine bots.
- Ensure only the explicitly addressed or currently active local machine/session handles an inbound prompt.
- Keep active selection scoped by messenger instance, conversation, and user so different messengers/chats can select different sessions.
- Provide machine-aware session selectors and clear setup/diagnostic guidance for Telegram, Discord, Slack, and future adapters.
- Preserve authorization-before-side-effects for prompts, media, callbacks, and control actions.

**Non-Goals:**

- Sharing one bot token/account across unaware brokers.
- Adding broker-to-broker networking, a hosted control plane, peer discovery, NAT traversal, or route federation implementation.
- Guaranteeing merged cross-machine `/sessions` output from one broker; in shared-room mode each machine bot reports only its local sessions.
- Making group/channel plain-text routing work on platforms/configurations where bots cannot observe ordinary room messages.
- Linking user identities across messengers; active selections remain messenger/chat/user scoped.

## Decisions

### Use distinct bot/app identity per machine

Each broker starts ingress only for the messenger instances configured locally. A shared-room deployment requires every participating machine to use a distinct bot token/app account for the same messenger room.

Alternatives considered:
- **Same token on multiple brokers:** rejected because Telegram exposes one update stream and Discord/Slack duplicate consumers create races and split-brain state.
- **One federation ingress owner:** valid for a separate federation mode, but out of scope for no-infrastructure operation.

### Treat the shared room as the coordination log

Machine bots observe commands such as `/use laptop docs` or `relay use laptop docs`. Each broker updates its local active-selection mirror for that messenger conversation/user when it can see a machine-aware selection command. Later unaddressed text is handled only by the selected machine/session.

Alternatives considered:
- **Shared database or local network transport:** rejected for this mode because it reintroduces infrastructure or broker awareness.
- **Messenger platform state:** rejected because common messengers do not provide a portable bot-owned active-selection primitive.

### Conservative single-target handling

For every inbound event, a broker classifies whether it is explicitly addressed to this machine bot, matches an active local selection, targets another machine, or is ambiguous. The broker injects only in the first two cases and remains silent otherwise, except for safe help/error responses when the message is explicitly addressed to it.

This prevents duplicate prompt injection when multiple machine bots can see the same room message.

### Machine-aware selectors extend existing session selection

Shared-room command parsing adds a machine dimension without replacing current single-broker selectors:

- `/use <machine> <session>` selects an active session for the current messenger conversation/user.
- `/to <machine> <session> <prompt>` sends a one-shot prompt without changing active selection.
- Explicit mention/reply to a machine bot can imply the machine target, allowing existing session selectors within that machine.

Machine identifiers come from configured machine display names/aliases and stable `relay.machineId` values. Ambiguous or unknown machine selectors produce safe guidance rather than prompt injection.

### Shared-room visibility is adapter capability-gated

Adapters declare whether they can see group/channel messages, mentions, replies, and plain text in shared rooms. Telegram shared-room plain text requires bot privacy mode to be disabled; otherwise Telegram must fall back to commands addressed to a bot, mentions, or replies. Discord and Slack require appropriate channel scopes/permissions and should prefer reliable text-prefix or mention forms over collision-prone slash command surfaces.

### Local-only authoritative session state

A broker remains authoritative only for its local session routes, local binding state, local action state, and local notifications. It does not claim knowledge of remote sessions except for machine names discovered through observed shared-room commands or static configuration used for routing decisions.

`/sessions` in shared-room mode is fan-out by convention: each visible machine bot may respond with its local sessions when explicitly asked or when the command is addressed to all PiRelay bots. A broker does not fabricate a merged list.

### Duplicate token/account safeguards remain mandatory

Because shared-room mode relies on distinct bot identities, diagnostics should fingerprint local tokens/accounts and warn when duplicate tokens are configured within one config/state directory. Runtime conflict signals from platforms, especially Telegram polling conflicts, must disable ingress for that adapter rather than risking message loss or duplicate handling.

Cross-machine duplicate-token prevention cannot be guaranteed without coordination, so setup text must state that a shared room requires one dedicated bot/app per machine.

## Risks / Trade-offs

- **Bots miss active-selection commands** → Require explicit addressing fallback; treat unknown or stale active state as no-target and remain silent.
- **Telegram privacy mode hides ordinary group text** → Detect/document privacy-mode limitation where possible and require mention/reply/command fallback unless privacy mode is disabled.
- **Multiple bots respond noisily to `/sessions` or help** → Define fan-out response rules and prefer addressed/all-machines commands; non-target bots remain silent for ordinary prompts.
- **Machine selector ambiguity** → Use stable machine ids plus optional display aliases; reject ambiguous selectors with safe guidance.
- **No global offline knowledge** → Each bot reports only local offline/online state; cross-machine absence is represented by lack of that machine bot response, not a fabricated global state.
- **Group/channel authorization is broader than private DM** → Keep allow-lists, conversation policy, and user authorization checks before media download or prompt injection.
- **Slash command collisions in shared rooms** → Prefer text-prefix, mention, and reply UX as the reliable surface; platform-native slash commands are optional convenience surfaces only.

## Migration Plan

1. Keep existing private-chat and single-broker behavior unchanged by default.
2. Add opt-in shared-room configuration/diagnostics for each messenger instance and machine display identity.
3. Introduce machine-aware parsing and conservative routing guards behind shared-room readiness checks.
4. Add setup guidance for inviting machine bots to rooms and verifying visibility/permissions.
5. Add tests for shared-room classification, active selection, explicit target routing, and safe silence.
6. Rollback is disabling shared-room mode or removing machine bots from the shared room; existing local pairings and private chat behavior remain valid.

## Open Questions

- Should shared-room mode have an explicit config flag per messenger instance, or should it be inferred from group/channel binding kind plus diagnostics?
- Should `/sessions` fan-out require an explicit command such as `/sessions all` to avoid noisy multi-bot responses?
- What is the canonical machine display selector precedence: alias, configured display name, then machine id prefix?
- Can Telegram diagnostics reliably detect privacy mode, or should PiRelay provide a manual smoke-test command instead?
