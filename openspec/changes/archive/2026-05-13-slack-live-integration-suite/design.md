## Context

Slack live testing differs from normal unit or adapter tests because the behavior depends on a real Slack workspace, installed apps, channel membership, inbound event delivery, and outbound message history. PiRelay also needs to verify that two independent Pi instances can participate in the same Slack channel and that message flow can be observed programmatically.

Slack apps cannot be provisioned from inside Slack by a bot. This change therefore assumes the organization/workspace and app credentials are provided externally, then validated by the suite before execution.

## Goals

- Provide a repeatable live Slack integration test workflow that can run in CI or locally when credentials are supplied.
- Validate Slack app setup before sending traffic.
- Run two separate Pi instances with distinct Slack bindings against the same authorized channel.
- Verify communication and silence using a harness that inspects events, API responses, and message history.
- Keep secrets out of logs and failures.

## Non-Goals

- Do not create Slack apps or bot identities from within Slack itself.
- Do not require a human to watch the channel for success.
- Do not change Slack runtime authorization semantics as part of this work.
- Do not make live Slack tests part of the default unit-test suite when credentials are absent.

## Design Decisions

1. **External provisioning is a prerequisite.**
   - The suite accepts provided Slack workspace/app credentials and verifies that the apps are installed and usable.
   - Preflight should fail fast with actionable diagnostics if the apps, scopes, subscriptions, or channel membership are missing.

2. **The harness is the observer.**
   - The test runner records inbound event payloads, outbound API acknowledgements, and resulting posted messages.
   - Assertions are based on Slack-visible state, not manual inspection.

3. **Two Pi instances are separate subjects.**
   - Each Pi instance gets its own local configuration and Slack binding.
   - The suite must prove that each instance can respond when targeted and remain silent when the other instance is targeted.

4. **Verification must be explicit.**
   - The suite should assert positive delivery, negative silence, and final completion/failure outcomes.
   - The suite should confirm that the observed channel/thread state matches the intended routing path.

5. **Safety comes first.**
   - Secrets are redacted from logs and assertions.
   - Tests should clean up or namespace their messages, threads, and temporary state so repeated runs do not interfere with each other.

## Risks / Trade-offs

- Slack event delivery and message history can be eventually consistent, so the harness may need retries and bounded polling.
- Two live Pi instances increase setup complexity and may require explicit port, config, or workspace isolation.
- Workspace permissions or channel membership problems can fail in ways that look like routing bugs unless preflight checks are thorough.
- A full end-to-end suite is slower than mocked tests, so it should remain opt-in and targeted.
