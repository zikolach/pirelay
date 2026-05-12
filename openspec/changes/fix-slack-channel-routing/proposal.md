## Why

Slack channel pairing can currently succeed and outbound progress/status/summary responses can work, while inbound Slack channel prompts still fail unless the bot is explicitly mentioned. This breaks the advertised Slack channel UX: after pairing or selecting a session, users expect plain channel prompts and one-shot `pirelay to ...` commands to reach Pi safely.

## What Changes

- Fix Slack channel/shared-room pre-routing so active selection commands persist usable local selections for the Slack conversation/user.
- Ensure plain Slack channel text routes to Pi only after a valid local active selection exists, preserving the shared-room safety boundary.
- Ensure Slack one-shot targeting works with documented local-machine forms such as `pirelay to <machine> <session> <prompt>` and does not silently disappear when malformed.
- Improve Slack channel guidance/error responses for command forms that are accepted as commands but cannot be routed.
- Add regression coverage for actual channel pairing/use/to/plain-prompt flows, not only command responses.

## Capabilities

### New Capabilities

### Modified Capabilities
- `slack-relay-adapter`: Slack channel routing after pairing/selection and machine-aware one-shot prompt delivery requirements.
- `shared-room-machine-bots`: Shared-room active selection and one-shot command behavior must be observable and not silently claim success without a usable route.

## Impact

- `extensions/relay/adapters/slack/runtime.ts` shared-room pre-routing, `use`, `to`, binding lookup, and active selection persistence.
- Slack runtime tests for channel pairing, active selection, one-shot prompts, mention fallback, and silent/non-silent error cases.
- Potential documentation/help text updates if command forms need clarification.
- No new runtime dependencies and no secret/state schema changes beyond existing active-selection state use.
