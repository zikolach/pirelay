## Context

Slack channel pairing currently can produce a valid active channel binding and outbound progress/completion messages, while inbound channel prompts fail unless the Slack bot is explicitly mentioned. Commands such as `pirelay status`, `pirelay sessions`, and `pirelay summary` can still answer because they are routed as explicit commands and do not prove that plain prompt routing is usable.

The fragile area is Slack shared-room pre-routing: channel messages are filtered before binding lookup to preserve DM-first/shared-room safety. That filter must keep ordinary channel chatter out of Pi, but it must also let documented local-machine `use`/`to` flows create or use a local active selection reliably.

## Goals / Non-Goals

**Goals:**
- Make Slack channel pairing followed by `pirelay use <session>` or equivalent documented selection produce a persisted active selection for the Slack conversation/user.
- Make unmentioned plain Slack channel prompts route only when that active selection points to a local online session.
- Make `pirelay to <machine> <session> <prompt>` route as a one-shot prompt when `<machine>` targets the local Slack machine/app identity.
- Make malformed or non-local Slack shared-room command forms fail with useful guidance when PiRelay responds, instead of claiming success or silently dropping after command recognition.
- Preserve safety: no free-form unmentioned channel text routes without mention or active local selection.

**Non-Goals:**
- Allow arbitrary Slack channel chatter to route without active selection or mention.
- Change Slack authorization or pairing code security.
- Add broker federation or cross-machine aggregation.
- Require new Slack scopes beyond the channel-message visibility already needed for channel pairing/control.

## Decisions

### Separate command recovery from plain-prompt routing

Slack channel pre-routing should continue to allow explicit commands to recover or inspect routing without an existing active selection, but plain non-command text must remain gated by mention or active local selection. The fix should make command paths that are intended to establish or use selection actually persist and use the local selection.

Alternative considered: treat any bound user's channel text as routed after pairing. This was rejected because it would re-open the shared-room safety issue where ordinary channel chatter can be injected into Pi.

### Support both single-machine and machine-qualified Slack selection where safe

For Slack channels with a single local machine context, `pirelay use <session>` should remain a valid way to select the local session. Machine-qualified forms such as `pirelay use <machine> <session>` and `pirelay to <machine> <session> <prompt>` should route only when the machine selector resolves to the local configured machine id/display name/aliases.

If a machine selector is non-local, the local runtime should remain silent or record remote selection state according to existing shared-room rules. If a local-looking command is malformed, PiRelay should provide guidance rather than silently ignoring it.

### Verify prompt injection, not just acknowledgement text

Regression tests must assert that `route.actions.sendUserMessage` is called for successful channel prompt routes. Command response text alone is insufficient because the observed failure had working Slack command responses but no prompt injection.

## Risks / Trade-offs

- **Risk: making channel routing too permissive** → Keep non-command unmentioned text gated by active local selection and add negative tests for ordinary chatter from selected and non-selected users.
- **Risk: command forms become ambiguous between machine selector and session selector** → Prefer explicit parsing branches with clear fallback guidance and tests for both `pirelay use <session>` and `pirelay use <machine> <session>`.
- **Risk: Slack event delivery limitations are mistaken for routing bugs** → Tests should exercise runtime routing directly, and docs/guidance should still mention bot mention fallback when Slack app visibility is limited.
- **Risk: active selection state is not persisted due to state-store shape** → Add assertions against `TunnelStateStore.getActiveChannelSelection` after pairing and use commands.

## Migration Plan

No migration is required. Existing active Slack bindings remain valid. Users with channel bindings can re-run `pirelay use <session>` after the fix to create the active selection if it was missing.
