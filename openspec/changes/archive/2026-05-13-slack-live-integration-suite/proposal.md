## Why

We need a repeatable live integration suite that proves PiRelay can operate in a real Slack workspace without a human watching the channel. The suite should cover the full path from Slack app setup to two independent Pi instances exchanging messages in the same authorized channel and verifying the result through API-visible evidence.

This is especially important for Slack because the runtime is multi-user and shared-room behavior must be validated with real app installs, channel membership, event delivery, and message history rather than only unit tests.

## What Changes

- Add a live Slack integration test suite that accepts provided workspace/organization access and app credentials.
- Add setup and preflight guidance for preparing the Slack apps, scopes, event subscriptions, and test channel before running the suite.
- Add support for launching and wiring two separate Pi instances to the same Slack channel with distinct identities and bindings.
- Add a programmatic observer/harness that watches Slack events and API-visible message history to verify message delivery, routing, silence of non-target instances, and final outcomes.
- Add safety guards for secret redaction, test isolation, and opt-in execution when live Slack credentials are present.

## Capabilities

### New Capabilities

- `slack-live-integration-suite`: Defines the live Slack workspace setup, dual-instance execution model, and programmatic verification harness for shared-room integration testing.

### Modified Capabilities

- `slack-relay-adapter`: Documents and tests the Slack surfaces the live suite depends on, including app installs, channel membership, and message observation.
- `messenger-relay-sessions`: Extends end-to-end coverage expectations so live shared-room verification can be driven by an external harness instead of a human observer.
- `relay-configuration`: Adds live-test setup and secret-safe preflight requirements for Slack credentials and channel configuration.

## Impact

- Affected code: Slack live-test harness, setup/preflight helpers, multi-instance test runner, and test documentation.
- The suite must not require manual channel observation for pass/fail determination.
- The suite must not print tokens, signing secrets, or other sensitive Slack credentials in logs or assertions.
- The suite should be skipped cleanly when the required live Slack environment is not configured.
