## Context

PiRelay already supports the primitives needed for inter-agent collaboration: shared-room machine bots, explicit targeting, delegation task cards, peer-bot trust, capability matching, bounded delegated prompts, task-scoped reporting, approval gates, and loop prevention. Those pieces are documented across the README, configuration docs, shared-room parity docs, test checklist, and prior OpenSpec changes.

The missing piece is a cohesive playbook that explains how a user would operate two Pi agents together on a real software project. This change is documentation-first and should not introduce new runtime behavior.

## Goals / Non-Goals

**Goals:**

- Provide a concrete two-agent software-project collaboration playbook that is easy to follow.
- Show the relationship between humans, machine bots, Pi sessions, delegation task cards, and shared-room messages.
- Include practical setup snippets for two machines with trusted peer configuration and capabilities.
- Demonstrate safe commands and example transcript fragments for a real workflow, such as fixing a failing CI test or splitting implementation and review work.
- Explain safety boundaries: explicit target selection, peer trust, no secrets in task goals, bounded summaries, inert ordinary bot output, loop prevention, and approval gates for sensitive operations.
- Add a manual validation checklist that exercises the documented flow without requiring production tokens or exposing transcripts.

**Non-Goals:**

- No new messenger adapter behavior.
- No new delegation lifecycle states or persisted state schema changes.
- No changes to authorization, approval-gate, or peer-trust semantics.
- No fully automated live multi-agent test in this change; the playbook may define a manual or optional smoke-test path.

## Decisions

### Add a dedicated playbook document

Create a new document, likely `docs/agent-collaboration-playbooks.md`, rather than expanding existing configuration or parity docs. The playbook needs narrative structure, diagrams, setup examples, command examples, and validation steps; keeping it dedicated avoids making reference docs too long.

Alternative considered: place the full content in `README.md`. This would make the README too broad and harder to scan. The README should link to the playbook and keep only a short summary.

### Use a software-project scenario as the primary playbook

Use a realistic workflow such as “planner/reviewer agent delegates failing-test reproduction and fix validation to implementer/test-runner agent.” This aligns with PiRelay’s target users and exercises delegation creation, claim, execution, result reporting, and approval gates.

Alternative considered: a generic “agent A asks agent B for help” example. That is simpler, but it does not demonstrate why multi-agent collaboration is useful or how users should split work safely.

### Present transcript fragments as examples, not executable fixtures

The playbook should include bounded example room messages and command snippets, but should clearly mark them as illustrative. Runtime behavior should remain governed by existing commands and specs.

Alternative considered: generate a golden transcript fixture. That would be brittle across messenger formatting changes and is not needed for a documentation-focused change.

### Keep safety language explicit

Every playbook flow should call out what is machine-actionable and what is inert. Delegation task commands/actions are actionable after authorization; ordinary bot output and summaries are not. Sensitive operations remain subject to approval gates.

Alternative considered: defer safety details to existing docs. Cross-linking is useful, but the playbook must be safe when read standalone because users may copy its workflow directly.

## Risks / Trade-offs

- **Risk: Users mistake transcript text for a bot-to-bot protocol.** → Mitigation: clearly label examples, emphasize validated delegation commands/actions, and state that ordinary bot output is inert.
- **Risk: Users expose secrets in delegation goals.** → Mitigation: include explicit “do not include” examples and safe goal-writing guidance.
- **Risk: Platform differences make one transcript misleading.** → Mitigation: describe messenger-neutral concepts first, then note Telegram/Discord/Slack command-surface differences and link to shared-room parity.
- **Risk: Documentation drifts from implementation.** → Mitigation: link commands to existing command reference, add a docs validation checklist, and avoid specifying behavior beyond existing specs.

## Migration Plan

This is documentation-only. Existing users do not need to migrate configuration or state. After implementation, users can adopt the playbook by enabling shared-room mode and delegation using the documented configuration snippets.

Rollback is removing the new playbook document and links.

## Open Questions

- Should the first playbook use Slack as the primary shared-room example, or stay platform-neutral with Telegram/Discord/Slack notes?
- Should the scenario prefer “fix failing CI” or “split implementation and review” as the headline workflow?
