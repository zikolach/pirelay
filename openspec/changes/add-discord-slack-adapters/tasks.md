## 1. Prerequisite validation

- [ ] 1.1 Confirm channel adapter architecture is implemented and Telegram characterization tests pass.
- [ ] 1.2 Decide supported Discord and Slack SDK/client dependencies.
- [ ] 1.3 Add channel-specific config namespaces and secret loading.

## 2. Discord adapter

- [ ] 2.1 Implement Discord bot connection, DM update parsing, identity normalization, and pairing.
- [ ] 2.2 Implement Discord text delivery, message chunking, buttons/actions, and activity fallback.
- [ ] 2.3 Implement Discord file/image attachment validation, inbound prompt delivery, and latest-image output.
- [ ] 2.4 Add Discord unit/integration-style tests with mocked API clients.

## 3. Slack adapter

- [ ] 3.1 Implement Slack app request validation, DM event parsing, identity normalization, and pairing.
- [ ] 3.2 Implement Slack text delivery, block/button actions, chunking, and file upload/download.
- [ ] 3.3 Implement Slack credential handling and workspace/user authorization checks.
- [ ] 3.4 Add Slack unit/integration-style tests with mocked API clients.

## 4. Multi-channel broker routing

- [ ] 4.1 Register multiple enabled adapters with the broker without cross-channel state leakage.
- [ ] 4.2 Add tests for simultaneous Telegram, Discord, and Slack route registration.

## 5. Documentation and validation

- [ ] 5.1 Update README, config docs, testing docs, and skills with Discord and Slack setup flows.
- [ ] 5.2 Add manual smoke-test checklist for Discord and Slack DMs.
- [ ] 5.3 Run typecheck and the full test suite.
