## Why

Signal is appealing for private mobile control, but it lacks a simple official bot API comparable to Telegram, Discord, or Slack. A focused spike should determine whether Signal support is reliable enough for PiRelay before committing to a production adapter.

## What Changes

- Evaluate Signal integration options, especially `signal-cli`, device linking, local daemon/runtime requirements, and message/file support.
- Prototype or document a minimal local Signal adapter path without committing to production support.
- Identify security, operational, packaging, and support risks.
- Produce a recommendation: implement Signal adapter, defer, or reject.

## Capabilities

### New Capabilities
- `signal-relay-adapter-evaluation`: defines the expected feasibility assessment and decision criteria for Signal relay support.

### Modified Capabilities

## Impact

- No production runtime behavior should change unless a later implementation proposal is accepted.
- May add throwaway scripts or docs under a spike branch/change, but should avoid shipping experimental Signal dependencies in the npm package.
- Informs future adapter architecture and privacy-focused channel decisions.
