## 1. Slack setup and preflight

- [x] 1.1 Document the required Slack workspace/org inputs, app credentials, channel identifiers, and environment variables for the live suite.
- [x] 1.2 Add a preflight step that validates the Slack apps are installed, have the required scopes/subscriptions, and are members of the target channel.
- [x] 1.3 Add failure messages that explain missing workspace access, missing channel membership, or missing event delivery permissions without exposing secrets.

## 2. Dual-instance Pi execution

- [x] 2.1 Add a test harness that launches two separate Pi instances with distinct local bindings/configuration.
- [x] 2.2 Wire each Pi instance to the same authorized Slack channel through its own app identity or configured binding.
- [x] 2.3 Add setup/teardown so repeated runs do not reuse stale bindings or channel state.

## 3. Programmatic observation and assertions

- [x] 3.1 Add an observer that records Slack events, API acknowledgements, and posted messages during the test run.
- [x] 3.2 Assert that targeted messages reach the intended Pi instance and that the non-target instance remains silent.
- [x] 3.3 Assert that the final channel/thread state contains the expected replies, acknowledgements, and completion or failure messages.

## 4. Safety and developer ergonomics

- [x] 4.1 Redact tokens, signing secrets, and other sensitive values from logs and test output.
- [x] 4.2 Add an opt-in test entrypoint that skips cleanly when live Slack credentials are not configured.
- [x] 4.3 Add documentation for how to run the suite locally and in CI with a provided Slack organization.

## 5. Validation

- [x] 5.1 Run the live suite against a provided Slack test workspace/channel when credentials are available. (No live Slack credentials configured locally; opt-in entrypoint was run and skipped cleanly.)
- [x] 5.2 Run the normal test suite and typecheck after any harness changes.
- [x] 5.3 Validate the change with `openspec validate slack-live-integration-suite --strict`.
