## Context

PiRelay already has the hard parts of file delivery: workspace-relative file validation, size/type checks, normalized adapter document/image sends, and live Telegram/Discord/Slack upload paths. The gap is the invocation model. The implemented `/relay send-file ...` command is a local Pi extension command, so it is not available to an assistant turn that was started from Telegram/Discord/Slack and it is intentionally refused by current remote runtimes.

Remote messenger prompts currently follow this shape:

```text
messenger event
  -> adapter authorization and route selection
  -> adapter calls route.actions.sendUserMessage(...)
  -> Pi assistant/tool loop runs
  -> completion/progress is sent back by relay notifications
```

Local slash commands follow a different shape:

```text
local Pi input /relay send-file ...
  -> pi.registerCommand("relay") handler
  -> extension runtime validates file
  -> adapter sends document/image
```

The change connects these paths without weakening the authorization boundary.

## Goals / Non-Goals

**Goals:**

- Let authorized paired messenger users request safe workspace files from the selected online Pi session.
- Support explicit remote command forms for Telegram, Discord, and Slack.
- Let the assistant satisfy natural-language file requests through a first-class relay tool/action in the same session.
- Send requested files only to the originating/selected authorized conversation, preserving thread context where applicable.
- Reuse existing local file validation, adapter capability checks, and document/image upload contracts.
- Keep errors secret-safe and actionable in the requesting messenger and local audit trail.

**Non-Goals:**

- Exposing unrestricted filesystem download or absolute paths to remote users.
- Adding a hosted artifact store, public links, or long-lived file sharing URLs.
- Letting a remote user send files to arbitrary raw chat/channel ids.
- Automatically uploading every generated workspace file without an explicit remote request or assistant action.
- Changing pairing, allow-list, or local trust semantics beyond the authorization required for this feature.

## Decisions

### Add a shared requester-scoped file delivery helper

Introduce a shared helper under `extensions/relay/` that can be called by local commands, remote command handlers, and the assistant tool. It should accept:

```ts
{
  route: SessionRoute;
  requester: RelayFileDeliveryRequester;
  relativePath: string;
  caption?: string;
  source: "local-command" | "remote-command" | "assistant-tool";
}
```

The helper resolves the target conversation from the requester rather than from arbitrary user-provided ids, validates the path with `loadWorkspaceOutboundFile`, applies adapter-specific limits, sends a normalized document/image payload, and returns a safe delivery result.

Alternative considered: keep remote send-file logic inside each adapter runtime. That would be faster to patch but would duplicate validation, error wording, and target rules across Telegram/Discord/Slack.

### Remote commands target the requesting conversation only

Remote explicit commands should use platform-native text forms:

```text
Telegram: /send-file <relative-path> [caption]
Discord:  relay send-file <relative-path> [caption]
Slack:    pirelay send-file <relative-path> [caption]
```

The command sends only to the authorized conversation/thread that issued the request and the selected route for that identity. Use `/use <session>` or the equivalent platform command to switch the active session before requesting a file; `/to <session> <prompt>` remains a one-shot prompt mechanism and does not change which workspace a later `send-file` request uses. Remote `send-file` should not accept raw chat ids or cross-messenger target refs.

Alternative considered: mirror local `/relay send-file <target> <path>` remotely. That would be surprising and dangerous because a remote user could try to fan out files to other messengers. Requester-scoped delivery is safer and matches “send me this file”.

### Register an assistant-callable relay file tool

The extension should register a custom tool, for example `relay_send_file`, with a narrow schema:

```ts
{
  relativePath: string;
  caption?: string;
}
```

The tool is enabled for the current session and can be called by the LLM when the user asks to send a file. It should not expose bot tokens, raw chat ids, upload URLs, or filesystem browsing. The tool must deliver to the latest authorized remote prompt source for the active turn, or fail with local guidance when no remote requester context exists.

Alternative considered: ask the assistant to run `pi -p --session ... /relay send-file ...` through shell. That is exactly the awkward behavior this change fixes; it creates a second Pi invocation, loses normal command feedback, and can interact poorly with active-session state.

### Preserve remote requester context with the route

When an adapter accepts an authorized prompt or command, it should attach a `RelayRemoteRequesterContext` to the route/action layer for the resulting turn. The context should include only non-secret routing data needed for delivery:

- messenger kind and instance id;
- conversation id and optional thread id;
- authorized platform user id/display label;
- session key/id;
- message id or turn correlation id when useful for audit;
- conversation kind metadata needed by the adapter.

This context should be in memory and/or persisted only as non-secret binding metadata if needed for broker parity. It should not include message transcripts, hidden prompts, tokens, file bytes, or upload URLs.

### Treat assistant tool delivery as a privileged relay action, not a normal remote command

The assistant tool should require both:

1. an active authorized remote requester context for the current or latest turn; and
2. a path argument provided by the assistant/user that passes workspace validation.

If the current turn originated locally, the tool should not guess a messenger target. It can instruct the local user to run `/relay send-file ...` instead. If the requester binding is paused, revoked, offline, or no longer selected, the tool should refuse delivery rather than falling back to another binding.

### Keep file safety conservative

Remote file requests should use at least the existing local send-file constraints:

- relative path under the current workspace;
- no traversal, absolute path, hidden path, directory, missing file, or symlink escape;
- MIME/type allow-list for text/Markdown/JSON/YAML and supported images unless a later spec expands binary support;
- adapter-specific document/image size limits before upload;
- safe redacted errors.

For remote requests, error messages should mention the class of failure but avoid echoing sensitive absolute paths or filesystem details.

### Update command parity and help

`send-file` should become a canonical supported remote command where the adapter can upload documents. Help text should distinguish:

- remote requester-scoped `send-file <path> [caption]`; and
- local fan-out `/relay send-file <messenger|all> <path> [caption]`.

Adapters without file upload support should return an explicit capability limitation.

## Risks / Trade-offs

- **Risk: remote file requests can leak secrets by path.** → Keep authorization-first handling, workspace-only relative paths, hidden path rejection, conservative MIME allow-list, size limits, and local audit messages.
- **Risk: natural-language tool calls send the wrong file to the wrong chat.** → Require requester-scoped context and never accept raw destination ids from the tool; fail closed when context is ambiguous or stale.
- **Risk: current route state does not identify the active remote turn cleanly.** → Add a small non-secret requester context abstraction rather than inferring from audit text or session history.
- **Risk: duplicated adapter behavior drifts.** → Extract shared delivery/result formatting and use adapter-specific code only for converting requester context to an outbound address.
- **Risk: broker/federation parity is harder than in-process delivery.** → Define the requester context as messenger-neutral data that can be forwarded to the session-owning runtime; initially test in-process and broker paths that already carry route information.
- **Risk: users may expect arbitrary binary download.** → Document the conservative allow-list and return explicit unsupported-type guidance.

## Migration Plan

1. Add the shared remote/requester file delivery helper while keeping existing local `/relay send-file` behavior unchanged.
2. Add requester context plumbing to route actions and adapter prompt/command handling.
3. Implement explicit remote `send-file` commands for Telegram, Discord, and Slack.
4. Register the assistant-callable relay file tool and enable it with prompt guidance.
5. Update help/docs/tests and remove the current remote “arbitrary file download is disabled” response for safe requester-scoped requests.
6. Rollback is straightforward: disable the new remote command/tool path while leaving local send-file and adapter uploads intact.

## Open Questions

- Should remote text/Markdown file requests require confirmation when the file name looks sensitive but is not hidden, such as `config.md` or `secrets-example.md`?
- Should the assistant tool be enabled only after a remote prompt in the current turn, or also for the latest authorized remote requester in the session when the local user asks the assistant to send a file?
- Should future binary support be opt-in per messenger or per workspace?
- How much requester context, if any, must be persisted for broker federation versus kept only in memory?
