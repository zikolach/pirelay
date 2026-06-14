## Why

Pi users can already invoke local skills with `/skill:<name>` inside the TUI, but remote messenger controllers have no safe, discoverable way to list or invoke those same skills. A shared remote skill command surface would let authorized Telegram, Discord, and Slack users use project/user/package skills from mobile without creating one-off relay commands for every workflow.

## What Changes

- Add an opt-in remote skill invocation surface centered on `/skills` and `/skill <name> [input]` (or platform equivalents such as `relay skills` / `relay skill ...`).
- List available local Pi skill commands from the live session command registry, filtered by configuration and safe metadata rules.
- Provide button/menu selection where the messenger supports actions, plus text fallbacks everywhere.
- Support pending-input mode: selecting `/skill <name>` without input asks the authorized requester for the next message, then invokes that skill with the supplied input.
- Invoke skills through the same safe prompt/command delivery path as local `/skill:<name>` usage, without exposing raw skill files, arbitrary filesystem paths, hidden prompts, or internal command registry details.
- Require explicit authorization, route selection, paused/offline checks, stale-action rejection, and optional allowlist/confirmation policy before any skill invocation is delivered to Pi.

## Capabilities

### New Capabilities
- `relay-skill-invocation`: Defines remote listing, selection, pending input, invocation, authorization, filtering, and safety behavior for local Pi skills exposed through PiRelay.

### Modified Capabilities
- `messenger-command-surfaces`: Add `/skills` and `/skill` to canonical command metadata and platform-safe command surfaces.
- `messenger-relay-sessions`: Add remote skill invocation to canonical command parity and terminal notification expectations.
- `relay-interaction-middleware`: Classify skill selection, pending input, and invocation as internal relay actions rather than ordinary prompts until invocation is authorized and resolved.

## Impact

- Affected runtime paths: Telegram, Discord, and Slack command parsing; channel button/action handling; route action delivery; broker parity; pending interaction state; help/command metadata.
- Affected Pi integration: uses live session command metadata (`getCommands()`) and a safe invocation mechanism for `/skill:<name>` commands or equivalent prompt delivery.
- Affected configuration: add opt-in skill exposure controls such as enabled/disabled state, allow/deny lists, source filters, and optional confirmation for risky skill sources.
- Affected tests/docs: command-surface parity tests, authorization/stale-state tests, pending-input tests, broker parity tests, and remote usage documentation.
- No new runtime dependencies are expected.
