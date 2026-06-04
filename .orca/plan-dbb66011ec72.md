# Plan: pr-70-review-followups

PR #70 review triage shows the earlier review threads are resolved, but three current Copilot threads are still valid on the local branch. We should address them before considering the PR ready: one hardens user-facing error output for invalid skill names, and two correct misleading skill-list usage hints for Discord and Slack.

This epic keeps the remote skill invocation surface safe and platform-accurate without changing the core behavior of skill discovery/invocation. The goal is to eliminate malformed chat output risks and ensure each messenger advertises the command form that actually works for that adapter.

## Task: Sanitize invalid remote skill-name error output
Status: [x]

Update resolveRemoteSkill so empty or invalid raw skill names are not echoed back inside formatted chat output. Return a generic unavailable/invalid message or quote only a normalized validated name. Add unit tests covering invalid names with backticks, newlines, and empty input so adapter-rendered messages cannot be malformed.

## Task: Use platform-specific skill-list usage hints
Status: [x]

Change skill-list formatting so Telegram/broker responses can keep /skill guidance while Discord and Slack list responses advertise relay skill/relay skills. Add tests for the formatter or adapter message output to prove Discord and Slack no longer emit Telegram-only /skill instructions and Telegram behavior remains unchanged.
