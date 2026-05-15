## Context

PiRelay has a canonical remote command registry in `extensions/relay/commands/remote.ts` and platform runtimes already parse Telegram slash commands, Discord text-prefix commands, and Slack `pirelay`/`relay` text commands. Current setup guidance correctly warns that Discord and Slack slash surfaces can be intercepted by the platform, but discoverability suffers because Telegram command menus, Discord native `/relay` metadata, and Slack `/pirelay` manifest wiring are not implemented as first-class surfaces.

Hermes Agent provides a useful reference pattern: a central command registry feeds Telegram BotCommands, Discord application commands, Slack slash command manifests, CLI help, and tests. PiRelay should adopt that registry-driven shape while preserving PiRelay-specific safety boundaries and reliable text fallbacks.

## Goals / Non-Goals

**Goals:**

- Generate platform command/menu metadata from the canonical PiRelay remote command registry.
- Register Telegram menu commands using Bot API-safe command names.
- Provide an optional Discord native `/relay` command with subcommands for canonical commands while keeping `relay <command>` text as the documented reliable path.
- Provide a Slack `/pirelay` native slash command path and include it in the generated setup manifest.
- Route every native command through the existing authorization, selection, pause, revocation, and command handlers instead of introducing parallel behavior.
- Add tests that compare registered/menu command metadata with runtime command support and documented fallbacks.

**Non-Goals:**

- Do not add many top-level Discord slash commands such as `/status` or `/abort` as the primary UX.
- Do not add many top-level Slack slash commands such as `/status`, which collide with Slack built-ins and workspace-wide command names.
- Do not change remote command semantics, approval-gate behavior, or safe file-request authorization.
- Do not add new messenger platforms or new runtime dependencies.
- Do not make native command registration required for Discord/Slack pairing or command correctness.

## Decisions

1. **Use the canonical remote command registry as the source of truth.**
   - Generate command-surface metadata from `CANONICAL_REMOTE_COMMANDS`, excluding aliases where the platform menu should show one canonical entry.
   - Alternative considered: hand-maintain platform command arrays. Rejected because parity drift already creates UX and test risk.

2. **Separate command metadata from command execution.**
   - Add pure helpers that expose platform-safe command names, descriptions, usage hints, and fallback notes.
   - Native command handlers should convert platform payloads into the same text-command form currently parsed by each runtime, then pass through existing routing.
   - Alternative considered: implement platform-specific command handlers directly. Rejected because it duplicates authorization and command semantics.

3. **Telegram uses menu commands, not a new command namespace.**
   - Register Telegram BotCommands after setup/startup with Telegram-safe names: lowercase, max 32 characters, underscores instead of invalid punctuation, and collision handling.
   - Because Telegram BotCommand names cannot contain hyphens, commands such as `send-file` and `send-image` need Telegram-safe menu names. Alias-style names must be registry-backed, using the existing `sendfile` alias and adding a canonical `sendimage` alias for `send-image`; otherwise use explicit underscore normalization such as `send_image` mapped back to canonical commands.
   - Registration failures are non-fatal and reported as secret-safe diagnostics.

4. **Discord uses one namespaced native command.**
   - Implement `/relay <subcommand>` as optional Discord application-command UX.
   - Continue documenting `relay <command>` as the reliable baseline because Discord owns slash-command routing and requires command sync.
   - Registration should be opt-in or conservative, secret-safe, and resilient to rate limits; global command sync must not block core runtime startup indefinitely.

5. **Slack uses one `/pirelay` slash command.**
   - Add `/pirelay [command] [args]` to the generated manifest and route slash-command payloads into existing Slack command handling.
   - Socket Mode and webhook modes both need normalized slash-command envelopes where applicable.
   - Initial acknowledgements and response URL use should be best-effort and requester-scoped; final behavior remains governed by the same authorization and command routing as text messages.

6. **Native surfaces are discoverability layers, not authority layers.**
   - Every native command event must pass authorization before route selection, media download, prompt injection, callback/action execution, or control actions.
   - Revoked bindings remain revoked even if a stale platform interaction arrives.
   - Native command metadata must not include tokens, pairing codes, hidden prompts, transcripts, or internal callback data.

## Risks / Trade-offs

- **Telegram sanitized names can diverge from canonical names.** → Provide explicit mapping tests and prefer existing aliases where possible.
- **Discord command sync can be rate-limited or stale.** → Keep sync optional/conservative, time-bound startup impact, and retain `relay <command>` text fallback as canonical documentation.
- **Slack slash commands require manifest reinstall.** → Update setup wizard manifest, docs, and troubleshooting so users know they must reinstall/update the Slack app.
- **Native command paths can bypass text parser assumptions.** → Normalize native payloads into existing command text before command execution and add authorization/regression tests.
- **Shared-room slash commands may target the wrong app or machine.** → Keep native commands namespaced, retain mention/text-prefix fallbacks, and document shared-room caveats.

## Migration Plan

- Existing Telegram, Discord, and Slack text commands remain supported without config changes.
- Telegram menu registration starts automatically when the bot is configured; failures are non-fatal.
- Discord native `/relay` registration is introduced without removing text-prefix support; deployments can continue using text-only if command sync is unavailable.
- Slack users update or reinstall the app from the generated manifest to enable `/pirelay`; text commands continue to work before manifest update.
- Rollback is safe by disabling native registration or reverting manifest changes; existing persisted bindings and pairing state do not need schema changes.

## Open Questions

- Should Discord native command registration be always-on when `applicationId` is configured, or guarded by an explicit config/env flag in the first release?
- Should Telegram menu show underscore forms like `/send_file`, alias forms like `/sendfile`, or both when a canonical command contains hyphens?
- Should Slack slash-command replies prefer ephemeral response URLs for command acknowledgements in all channel contexts, or only for native slash invocations that do not inject prompts?
