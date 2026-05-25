## Why

PiRelay has detailed shared-room delegation mechanics, but lacks a user-facing, end-to-end playbook that shows two agents collaborating on one real project. A concrete scenario will make the inter-agent communication model easier to understand, configure, test, and safely demonstrate.

## What Changes

- Add documentation for a real-life two-agent collaboration workflow using PiRelay shared rooms and delegation task cards.
- Describe the roles, setup, commands, expected task lifecycle, result handoff, and human approval points for a common software-project scenario.
- Add a safe example transcript that demonstrates how agents coordinate without treating ordinary bot output as executable input.
- Add configuration snippets and operational guidance for two machine bots, trusted peers, capabilities, autonomy levels, and approval gates.
- Add manual/smoke-test guidance for verifying the collaboration flow on Telegram, Discord, or Slack without exposing secrets.

## Capabilities

### New Capabilities
- `agent-collaboration-playbooks`: Covers documented, reproducible multi-agent collaboration playbooks built on shared-room machine bots, delegation task cards, trusted peer policy, safe transcript examples, and manual validation checklists.

### Modified Capabilities

None.

## Impact

- Documentation: likely adds a new playbook document under `docs/` and links it from `README.md`, `docs/config.md`, `docs/shared-room-parity.md`, and `docs/testing.md`.
- OpenSpec: adds a documentation-focused capability for collaboration playbooks.
- Code/APIs/dependencies: no runtime behavior or dependency changes expected.
