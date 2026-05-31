## Context

PiRelay approval gates were added as a confirmation layer for sensitive tool calls reached through remote messenger control. They rely on `SessionRoute.remoteRequester` to know which authorized Telegram, Discord, or Slack user can approve the operation. When an approval rule matches during a local-only Pi turn, there is no remote requester to ask, and the current fail-closed path can block local work with “Approval required, but no active remote requester is available.”

That fail-closed behavior is correct for remote turns whose requester disappeared or became unauthorized, but wrong for local prompts. A local user at the Pi session should not need to approve their own tool call through a messenger.

## Goals / Non-Goals

**Goals:**

- Keep approval gates disabled by default unless explicitly enabled by config or env.
- Make approval gates apply only to tool calls that belong to an accepted remote messenger turn.
- Ensure local prompts never require messenger approval, even if a configured rule matches the tool call.
- Preserve fail-closed behavior for remote turns with stale, revoked, paused, expired, or undeliverable approval context.
- Keep approval audit entries secret-safe and avoid creating misleading failure audit events for ordinary local turns.

**Non-Goals:**

- Replacing Pi host-level approval/sandboxing features.
- Adding local UI approval prompts for local turns.
- Changing approval matching semantics for enabled remote turns.
- Adding new persistent state schema fields unless a small backward-compatible marker is needed for accepted remote-turn ownership.

## Decisions

### Treat requester ownership as the approval scope boundary

Approval enforcement should run only when a tool call belongs to a remote-owned turn. In practice this means the route has a current `remoteRequester` that was set by accepted prompt delivery and is still pending/current for that turn. If no remote requester is present, the operation is local and approval gates are skipped.

**Rationale:** Existing requester context already drives remote file delivery and terminal output ownership. Reusing it avoids guessing from chat bindings or stale state.

**Alternative considered:** If no requester exists, fail closed for every matching rule. That caused local prompts to require remote approval and is the behavior this change removes.

### Keep remote missing/stale requester failures fail-closed

If a turn was accepted from a remote messenger and requester context is later unavailable, stale, revoked, paused, or cannot receive the approval request, matching sensitive operations must remain blocked.

**Rationale:** Remote approval gates protect unattended remote control. Losing the approval target during a remote turn should not silently downgrade the operation to local.

**Implementation note:** If current requester lifecycle state cannot distinguish “local turn” from “remote turn whose requester was cleared,” add the smallest explicit marker needed for accepted remote-turn ownership and clear it at turn boundaries.

### Disabled by default remains explicit

`resolveApprovalGateConfig(undefined)` and empty config should resolve to disabled. Env/config overrides should allow disabling with `enabled: false` or `PI_RELAY_APPROVAL_ENABLED=false`, even if rules are present.

**Rationale:** Approval gates are optional guardrails, not baseline runtime behavior. Config examples with rules should not become active unless explicitly enabled.

### Local bypass should not hide remote safety failures

Skipping approval for local turns should not catch or recover from parsing/config/state errors in remote approval paths. JSON config parsing and state errors should continue to fail loudly at their normal boundaries or be translated only at existing user-facing boundaries.

**Rationale:** This keeps the change scoped and preserves fail-fast behavior for untrusted or corrupted input.

## Risks / Trade-offs

- **Remote requester cleared too early** → Add/verify tests around accepted remote prompt ownership and `agent_start`/tool-call ordering; preserve a remote-turn marker until the turn ends.
- **Local prompts accidentally inherit stale remote requester** → Ensure local `agent_start` clears stale requester state when no remote prompt was accepted for that turn.
- **Users expect approval gates to protect local commands** → Document that approval gates are remote-turn guardrails only; local users should rely on Pi/local tooling controls for local approvals.
- **Existing configs contain rules with no `enabled` field** → They remain disabled by default; docs and doctor output should make the explicit `enabled: true` requirement clear.
