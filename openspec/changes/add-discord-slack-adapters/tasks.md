## 1. Prerequisite validation

- [x] 1.1 Confirm channel adapter architecture is implemented and Telegram characterization tests pass.
- [x] 1.2 Decide supported Discord and Slack SDK/client dependencies.
- [x] 1.3 Add channel-specific config namespaces and secret loading.

## 2. Discord adapter

- [x] 2.1 Implement Discord bot connection, DM update parsing, identity normalization, and pairing.
- [x] 2.2 Implement Discord text delivery, message chunking, buttons/actions, and activity fallback.
- [x] 2.3 Implement Discord file/image attachment validation, inbound prompt delivery, and latest-image output.
- [x] 2.4 Add Discord unit/integration-style tests with mocked API clients.

## 3. Slack adapter

- [x] 3.1 Implement Slack app request validation, DM event parsing, identity normalization, and pairing.
- [x] 3.2 Implement Slack text delivery, block/button actions, chunking, and file upload/download.
- [x] 3.3 Implement Slack credential handling and workspace/user authorization checks.
- [x] 3.4 Add Slack unit/integration-style tests with mocked API clients.

## 4. Multi-channel broker routing

- [x] 4.1 Register multiple enabled adapters with the broker without cross-channel state leakage.
- [x] 4.2 Add tests for simultaneous Telegram, Discord, and Slack route registration.

## 5. Documentation and validation

- [x] 5.1 Update README, config docs, testing docs, and skills with Discord and Slack setup flows.
- [x] 5.2 Add manual smoke-test checklist for Discord and Slack DMs.
- [x] 5.3 Run typecheck and the full test suite.
