## 1. Domain model and configuration

- [x] 1.1 Add shared-room machine identity types for machine id, display name, aliases, and local/remote target classification.
- [x] 1.2 Extend resolved relay configuration with optional shared-room settings and machine aliases without storing secrets in state.
- [x] 1.3 Add token/account fingerprint duplicate detection for local messenger instances and secret-safe diagnostics.
- [x] 1.4 Update `/relay setup` and `/relay doctor` guidance for Telegram, Discord, and Slack shared-room readiness and platform caveats.

## 2. Shared-room command parsing and selection helpers

- [x] 2.1 Implement pure helpers to parse machine-aware selectors for `/use <machine> <session>`, `/to <machine> <session> <prompt>`, `/sessions <machine>`, and addressed fallback forms.
- [x] 2.2 Implement shared-room event classification helpers for explicit local target, explicit remote target, active local selection, active remote selection, ambiguous target, and no target.
- [x] 2.3 Extend active-selection persistence to record enough machine identity metadata for shared-room decisions while preserving existing messenger/conversation/user scoping.
- [x] 2.4 Add unit tests for selector parsing, ambiguity handling, active-selection scoping across messengers, and safe no-target classification.

## 3. Adapter visibility and addressing metadata

- [x] 3.1 Extend adapter capability declarations with shared-room visibility fields for ordinary room text, mentions, replies, platform commands, media, and membership visibility.
- [x] 3.2 Normalize Telegram group mentions/replies/commands into local-target metadata and expose privacy-mode or plain-text visibility limitations in diagnostics or smoke guidance.
- [x] 3.3 Normalize Discord channel mentions/replies/text-prefix commands into local-target metadata and document slash-command collision fallback.
- [x] 3.4 Normalize Slack shared-channel app mentions/text events where supported and report missing scopes/channel visibility safely.
- [x] 3.5 Add adapter tests for local-target, remote-target, and non-target metadata normalization.

## 4. Routing behavior and safe silence

- [x] 4.1 Integrate shared-room classification before route selection, media download, prompt injection, command execution, activity indicators, or acknowledgements.
- [x] 4.2 Implement local handling for explicit machine targets and active local selections using existing authorization, prompt delivery, busy mode, media validation, and control command semantics.
- [x] 4.3 Implement safe silence for non-target, unknown-active, and ambiguous unaddressed shared-room events.
- [x] 4.4 Implement machine-specific `/sessions`, fan-out-compatible all-machines sessions behavior, and local-only status/session reporting.
- [x] 4.5 Ensure completion, failure, abort, progress, full-output, image, and guided-action responses are sent only by the machine bot that owns the local session/binding.

## 5. Runtime, setup, and UX coverage

- [x] 5.1 Update local `/relay connect` and pairing guidance for group/channel shared-room bindings where supported by each messenger.
- [x] 5.2 Update remote help text to explain machine-aware commands, mention/reply fallback, and active-session behavior in shared rooms.
- [x] 5.3 Add integration-style tests for two independent fake machine brokers observing the same room where only the selected or explicitly addressed machine injects prompts.
- [x] 5.4 Add tests showing Telegram and Discord shared rooms can keep different active machine/session selections for the same user.
- [x] 5.5 Add regression tests that duplicate local tokens produce diagnostics and do not start unsafe duplicate ingress.

## 6. Validation and documentation

- [x] 6.1 Update user-facing relay documentation and skill guidance with the isolated shared-room topology and its contrast with broker federation.
- [x] 6.2 Run `npm run typecheck`.
- [x] 6.3 Run `npm test`.
- [x] 6.4 Run `openspec validate support-shared-room-machine-bots --strict`.
