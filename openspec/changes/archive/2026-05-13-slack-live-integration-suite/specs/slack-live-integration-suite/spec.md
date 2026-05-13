## ADDED Requirements

### Requirement: Slack live test preflight
The system SHALL validate the Slack workspace, app credentials, and test channel before running live integration tests.

#### Scenario: Provided Slack organization is validated
- **WHEN** the live suite is started with provided Slack workspace or organization credentials, app credentials, and a target channel
- **THEN** the suite verifies that the app(s) are installed and can observe and post in the target channel
- **AND** it reports missing scopes, subscriptions, or channel membership as a preflight failure before sending test traffic

#### Scenario: Missing live configuration skips the suite
- **WHEN** the live Slack environment variables or configuration are absent
- **THEN** the suite skips cleanly and reports that live Slack credentials are not configured

### Requirement: Dual Pi instance Slack execution
The system SHALL support running two separate Pi instances against the same authorized Slack channel during a live test.

#### Scenario: Two Pi instances share one channel
- **WHEN** the suite launches two Pi instances with distinct local bindings and Slack identities in the same authorized channel
- **THEN** each instance can receive messages targeted to it
- **AND** each instance can respond through its own binding without using the other instance's credentials

#### Scenario: Non-target instance stays silent
- **WHEN** a live test sends a message that targets only one Pi instance
- **THEN** the other Pi instance remains silent
- **AND** the harness records that no unexpected reply or acknowledgement was posted by the non-target instance

### Requirement: Programmatic message observation
The system SHALL verify live Slack communication using programmatic observation of events and message history rather than a human watching the channel.

#### Scenario: Harness observes the exchange
- **WHEN** a live test sends a prompt and expects a response in Slack
- **THEN** the harness records the inbound event payloads, outbound acknowledgements, and resulting posted messages
- **AND** the test passes only if the observed Slack state matches the expected message flow

#### Scenario: Final state matches expected routing
- **WHEN** the live test completes a two-instance message exchange
- **THEN** the harness verifies that the expected replies, thread placement, and completion or failure notifications are present
- **AND** it verifies that no extra messages from the wrong instance were emitted

### Requirement: Secret-safe live test output
The system SHALL keep Slack secrets and pairing data out of live test logs, assertions, and artifacts.

#### Scenario: Sensitive values are redacted
- **WHEN** the live suite logs setup, preflight, failures, or observed message flows
- **THEN** tokens, signing secrets, and other sensitive Slack credentials are redacted
- **AND** the logs remain usable for debugging without revealing secret material
