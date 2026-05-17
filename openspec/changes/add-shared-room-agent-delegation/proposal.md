## Why

PiRelay shared rooms can now host multiple machine bots safely, but they are still mostly human-commanded control surfaces. The next step is agent-directed delegation: one Pi agent should be able to ask another machine bot to take a bounded task in the same conventional messenger room while humans can supervise, approve, cancel, and understand what is happening.

## What Changes

- Add visible, human-readable delegation task cards in shared messenger rooms.
- Add a delegation lifecycle: propose, approve if required, claim, run, report blocked/needs-approval, complete, fail, decline, cancel, and expire.
- Add trusted peer-bot identity and capability policies separate from human allow-lists.
- Allow targeted machine delegation and capability-based delegation with conservative auto-claim defaults.
- Inject claimed delegation work into the target local Pi session as an explicit, bounded prompt with task context and report destination.
- Add loop-prevention rules for bot-authored messages, delegation chains, duplicate claims, and completion feedback.
- Integrate with approval-gate semantics by adding task-scoped approval grants and requiring human supervision for sensitive delegated work.
- Preserve messenger-native behavior: Discord/Slack threads and buttons where available, Telegram compact cards and addressed commands where needed, plain text fallbacks everywhere.

## Capabilities

### New Capabilities
- `relay-agent-delegation`: Defines visible shared-room delegation tasks, peer trust, capability matching, task lifecycle, human supervision, approval integration, loop prevention, and messenger rendering.

### Modified Capabilities
- `shared-room-machine-bots`: Adds rules for bot-authored delegation events, trusted peer bots, task-card targeting, and non-target silence.
- `messenger-relay-sessions`: Adds delegated prompt injection and delegated completion/failure reporting semantics to existing session routing behavior.
- `relay-configuration`: Adds delegation policy configuration for peer trust, capabilities, autonomy level, expiry, depth, and approval requirements.
- `relay-broker-topology`: Clarifies that shared-room delegation remains messenger-visible coordination unless explicit broker federation is configured, and that local brokers own only their local delegation execution state.

## Impact

- Affected code: shared-room routing helpers, messenger runtimes, broker route registry/runtime bridge, state store, command surfaces, approval-gate integration, setup/doctor diagnostics, docs, and tests.
- Affected user workflows: multi-machine Discord/Slack/Telegram rooms where agents delegate work to each other under human supervision.
- Security impact: introduces new bot-authored ingress paths, so peer identity, explicit structure, authorization, shared-room pairing, full room/thread scoping, expiry, loop prevention, redelivery idempotency, revocation, approval checks, and audit must be first-class from the start. Delegation is a guarded control-plane path, not general bot chat: bot-authored ordinary messages remain inert, and only explicit scoped delegation commands or task-card actions may create, mutate, claim, or execute tasks.
- No breaking changes to existing human-directed commands, private chat pairing, shared-room active selection, or messenger file delivery.
