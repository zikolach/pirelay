## Context

Pi already discovers skills from global, project, package, settings, and CLI locations and registers them as local `/skill:<name>` slash commands. PiRelay currently exposes a messenger-neutral remote command set for status, session selection, prompt delivery, output retrieval, media, controls, approvals, and diagnostics, but it does not expose the local skill surface.

The useful primitive is not “register every skill as a platform slash command”. Skills can be numerous, dynamic, source-dependent, and freeform-input oriented. A stable PiRelay command surface should list and invoke skills through a small set of relay commands while preserving authorization, stale-state, and route-action safety.

## Goals / Non-Goals

**Goals:**

- Let authorized messenger users discover configured local skills for the selected Pi session.
- Let authorized users invoke an allowlisted skill immediately with input or through a pending-input flow.
- Render skill choices as buttons where available and text fallback everywhere.
- Preserve the same behavior across Telegram, Discord, Slack, broker-owned routes, and future adapters.
- Keep raw skill files, hidden prompts, tool internals, and arbitrary filesystem paths out of messenger responses.
- Make the feature configurable, conservative, and testable.

**Non-Goals:**

- Dynamically registering every skill as a native Telegram/Discord/Slack slash command.
- Replacing Pi’s local `/skill:<name>` command system.
- Exposing raw skill instructions or bundled scripts to messengers.
- Allowing arbitrary uploaded skill installation, skill editing, or skill repository management.
- Guaranteeing that every skill is safe for remote use; policy controls decide what is exposed.

## Decisions

### Use a small generic command surface

Expose `/skills` and `/skill <name> [input]` (or adapter-specific equivalents such as `relay skills` and `relay skill ...`) instead of one command per skill.

Rationale: this keeps platform command menus stable, avoids stale native slash-command registration, works when skills are added/removed at runtime, and avoids command-name collisions.

Alternatives considered:

- **Register one platform command per skill**: convenient but brittle across platforms and difficult to keep synchronized.
- **Treat all messages as possible skill names**: too ambiguous and risks accidental prompt routing.

### Discover via live Pi command metadata

Use the live route context’s command metadata where possible (`getCommands()` with `source: "skill"`) to discover available skill names and descriptions. Filter this metadata through PiRelay configuration before showing it remotely.

Rationale: Pi already owns skill discovery, precedence, and command naming. PiRelay should not duplicate the skill loader or parse arbitrary skill files.

### Invoke through a route-action helper

Add a narrow route action for skill invocation rather than exposing raw command execution to adapters. The helper should construct a local skill invocation equivalent to `/skill:<name> <input>` or a safe prompt/command handoff supported by Pi, and it should return typed outcomes for success, unavailable, unsupported, confirmation-required, and validation failure.

Rationale: adapters and broker code should not call stale contexts or build ad-hoc command strings. Route-action safety already centralizes prompt/control unavailable races.

### Pending-input state is requester-scoped

When a user selects a skill without input, PiRelay records pending skill input keyed by channel, instance, conversation/thread, user, session, skill name, and an expiry. The next non-command text from the same authorized requester becomes skill input. `/cancel` or `skill cancel` clears the pending state.

Rationale: many skills are naturally “Skill, then input”. Scoping prevents a different chat/user from completing the invocation.

### Button actions carry only opaque references

Buttons should use compact callback/action payloads that reference pending skill-selection state or safe skill identifiers. They must not embed skill file paths, full descriptions, hidden prompts, or raw user input.

Rationale: callback data can be logged by platforms and has size limits.

### Configuration is opt-in and filter-first

The safest default is disabled or allowlist-only. Configuration should support enabling, allow/deny skill names, source filters (project/user/package/temporary where available), maximum listed skills, pending-input expiry, and confirmation policy for selected skills or sources.

Rationale: skills can perform powerful workflows, including network, local mail, browser, shell, or repository operations after the agent follows their instructions.

## Risks / Trade-offs

- **Risk: a risky local skill becomes remotely triggerable** → Keep disabled or allowlist-only by default; support local confirmation policy and source filters.
- **Risk: raw skill instructions or paths leak to chat** → Send only bounded name/description/source category metadata, never file contents or absolute paths.
- **Risk: stale button/pending input invokes the wrong session** → Include route/session/user/conversation keys and expiry in pending state; reauthorize before invocation.
- **Risk: command execution API is not available to extensions** → Use a safe prompt handoff as a fallback design, or gate implementation on confirming Pi exposes a suitable command invocation primitive.
- **Risk: platform UX differs** → Treat buttons as progressive enhancement; keep text command fallback normative.
- **Risk: skill invocation while busy is ambiguous** → Reuse existing delivery mode semantics and busy acknowledgement; invocation should be steer/follow-up according to explicit args/config, not implicit.
