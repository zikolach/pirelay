## Context

The immediate bug report was that Slack file delivery did not work. Investigation showed a narrower implementation gap (`SlackLiveOperations.uploadFile` was a placeholder), but the user need is broader: PiRelay should provide a coherent file/artifact delivery model across all messengers.

Current behavior is fragmented:

- Telegram can send documents and has a Telegram-specific full-output Markdown download action.
- Discord can send files/images through its adapter and runtime image commands.
- Slack adapter tests claimed upload support, but the live client lacked the external upload flow and the runtime disabled image commands.
- There is no local Pi command to send an explicit arbitrary workspace artifact/file to a paired messenger.
- Final-output delivery differs by messenger and history: Telegram often sends a summary plus `/full`/download affordances, while Discord and Slack lean on text chunks or explicit commands.

This change reframes Slack upload as one adapter implementation inside a messenger-neutral file/artifact delivery capability.

## Goals / Non-Goals

**Goals:**

- Add a safe, local-user-initiated `/relay send-file` command for explicit workspace-relative file/artifact delivery.
- Deliver files through Telegram, Discord, Slack, and future adapters via normalized document/image contracts when supported.
- Keep generic arbitrary file reads unavailable to remote messenger users.
- Complete Slack live file upload via the supported external upload flow.
- Preserve channel/thread context for file delivery when the destination messenger supports it.
- Unify final-output delivery policy by progress/notification mode across messengers.
- Turn Telegram's Markdown download affordance into a presentation of shared file delivery rather than a Telegram-only workaround.
- Update setup guidance, manifests, docs, and tests for file delivery parity.

**Non-Goals:**

- Building a hosted artifact store or public link service.
- Letting remote messenger users download arbitrary workspace files by path.
- Automatically sending every generated local file without explicit local instruction or safe latest-output selection.
- Implementing Slack native slash commands.
- Adding new Slack/Discord/Telegram SDK dependencies.

## Decisions

### Treat local file delivery as a local command, not a remote command

The generic file path capability should be local-only:

```text
/relay send-file <target> <relative-path> [caption]
```

Examples:

```text
/relay send-file slack openspec/changes/foo/proposal.md
/relay send-file slack:work docs/report.md Release notes
/relay send-file all outputs/summary.md
```

Rationale: local users already have filesystem authority. Remote messenger users do not, so exposing arbitrary path reads remotely would become an exfiltration surface.

Remote users keep bounded commands:

- `pirelay images`
- `pirelay send-image <relative-image-path>` where existing path validation and image-only constraints apply
- `/full` / `pirelay full` for latest assistant output, not arbitrary files

### Introduce a messenger-neutral artifact target model

Local file delivery needs target resolution separate from session prompt routing:

```text
Local command
  └─ target: telegram | discord | slack | messenger:instance | all
       └─ conversation: current session's active non-revoked binding(s)
            └─ adapter.sendDocument / adapter.sendImage
```

Default target should be the current Pi session's bound conversation for the selected messenger instance. `all` sends to every active non-paused bound messenger conversation for the current session. A future extension can add explicit conversation ids, but this first version should avoid raw IDs in normal UX.

### Reuse route/adapter outbound contracts

The implementation should prefer normalized adapter calls:

- `sendDocument(address, file, { caption })`
- `sendImage(address, file, { caption })`

This keeps Telegram, Discord, and Slack as peers and avoids new per-messenger local command logic beyond destination resolution.

### Keep file safety explicit

Local `/relay send-file` should:

- require a relative path under the current workspace;
- reject hidden paths, symlink escapes, directories, missing files, oversized files, and unsupported/binary files where a messenger cannot safely send them;
- never persist file contents;
- use adapter limits before upload;
- redact secrets from errors.

For broad arbitrary local files, support a conservative document allow-list first: text/markdown/json/yaml/plain text plus image MIME types already supported. Binary/unknown files can be added later if needed.

### Use Slack external upload flow directly

Slack live operations should use:

1. `files.getUploadURLExternal` with filename and byte length.
2. HTTP upload to the returned upload URL.
3. `files.completeUploadExternal` with file id, title, channel id, optional initial comment, and optional thread timestamp.

Rationale: this is Slack's supported replacement for legacy `files.upload`, works with the existing bot token, and avoids adding a Slack SDK dependency.

### Make final output policy mode-aware and shared

Final assistant output should follow one shared policy:

| Mode | Terminal output behavior |
|---|---|
| `quiet` | short completion/summary, with `/full` or download/file action |
| `normal` | full final output as paragraph-aware message chunks where feasible |
| `verbose` | progress updates plus full final output at completion |
| `completion-only` | no progress updates, full final output at completion |

If full output is too large for a reasonable number of chunks, the adapter should offer/upload a Markdown document when document delivery is supported. Otherwise it returns a clear limitation.

### Paragraph-aware chunking before file fallback

Text output should split by paragraphs and pack chunks under the platform limit before falling back to a file. This avoids unreadable line breaks and reduces unnecessary file uploads.

### Slack permissions are part of setup

Add `files:write` to generated manifests, checked-in live-test manifests, setup checklist/guidance, and docs. Slack users must reinstall the app after scope changes.

## Risks / Trade-offs

- **Risk: local send-file can leak secrets accidentally.** → Mitigate with local-only command, workspace-relative paths, hidden/unsafe path rejection, size/type limits, and explicit user action.
- **Risk: sending to `all` surprises users.** → Make `all` explicit only; default to one named messenger target.
- **Risk: raw channel IDs creep into UX.** → Prefer current session bindings and labels; reserve raw IDs for diagnostics or future advanced options.
- **Risk: Slack upload scope missing.** → Provide setup guidance and actionable chat/local errors mentioning `files:write` and reinstall.
- **Risk: output policy changes create more message noise.** → Make quiet mode preserve terse behavior and ensure normal/verbose are the modes that send full output.
- **Risk: large files consume memory.** → Use existing max outbound file/image limits and reject before upload.
- **Risk: Telegram full-output behavior changes unexpectedly.** → Keep existing buttons/commands but implement them through shared file delivery semantics.

## Migration Plan

1. Land Slack upload support and docs as the first adapter-gap fix.
2. Add shared local file loading/validation helpers for explicit local file delivery.
3. Add `/relay send-file` command using active current-session bindings.
4. Refactor Telegram/Discord/Slack file sends to share destination and validation logic where practical.
5. Update final-output notification policy and tests after file delivery primitives are stable.
6. Existing remote commands continue to work; Slack users add `files:write` only if they want file/image delivery.

## Open Questions

- Should `/relay send-file all ...` include paused bindings or skip them? Initial preference: skip paused bindings and report skipped count.
- Should local file delivery support unknown binary files immediately? Initial preference: text/markdown/json/yaml and images first.
- Should normal mode always send full final output, or should there be a maximum chunk count before file fallback? Initial preference: paragraph chunks up to a bounded count, then document fallback.
- Should Slack upload failures affect status line health? Initial preference: no; file upload is a command failure, not runtime ingress failure.
