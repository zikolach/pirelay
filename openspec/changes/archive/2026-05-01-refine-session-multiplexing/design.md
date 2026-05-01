## Context

The broker runtime currently keeps an active session pointer per Telegram chat and supports `/sessions` plus `/use <session>`. This is the right core model. The main gaps are naming and clarity: default labels can be session-file basenames, duplicate labels can be confusing, and the connect flow does not let the user choose a short name such as `web`, `docs`, or `cloud`.

The desired philosophy is Pi-like: small, explicit, understandable. A chat controls one active session at a time. The user can switch intentionally. The system should not guess.

## Goals / Non-Goals

**Goals:**
- Make multiple sessions in one chat easy to identify and switch.
- Keep the routing model simple: one active session pointer per authorized chat/user.
- Let users name a connection at connect time.
- Use the project folder name as the default label when possible.
- Add a small one-shot targeting command for convenience without changing the active session.
- Clearly document local broker limits and multi-machine constraints.

**Non-Goals:**
- Remote relay hub for laptop + cloud under one bot/chat.
- Multiple authoritative brokers polling the same Telegram bot token.
- Group chat support.
- Broadcast prompts to multiple sessions.
- Natural-language guessing of target session.
- Complex dashboards or nested menus.

## Decisions

1. **One chat has one active session pointer.**
   Normal Telegram text, images, and commands target the selected active session. If several live sessions are paired and no active session can be resolved, PiRelay asks the user to run `/sessions` and `/use` instead of guessing.

2. **Connect accepts a simple optional label.**
   `/telegram-tunnel connect [name]` treats everything after `connect` as a display label. The label is trimmed, bounded, sanitized for display, and persisted in binding metadata after pairing. It is not a secret.

3. **Default labels prefer project folder name.**
   Label selection should be:
   1. explicit connect label;
   2. Pi session name when set;
   3. project/current working directory basename;
   4. session file basename;
   5. short session id fallback.

4. **Duplicate labels are allowed but disambiguated in lists.**
   Do not force complex unique naming. `/sessions` can show numbers and short ids or paths when labels collide. `/use <number>` always works.

5. **One-shot targeting is explicit.**
   `/to <session> <prompt>` sends one prompt to the named/numbered session and does not change the active session. This is optional convenience; `/use` remains the main flow.

6. **Notifications include source context when needed.**
   When a chat has multiple paired sessions, completion/failure/abort notifications should include the session label so users know which session produced the message.

7. **Multi-machine stays out of scope.**
   Same machine with many Pi sessions uses one broker. Laptop + cloud under one chat would require a future hub/remote-client architecture. The docs should explicitly say that two brokers must not poll the same bot token.

## UX Sketch

```
/telegram-tunnel connect docs
```

Telegram after pairing:

```text
Connected to Pi session docs.
```

Session list:

```text
Pi sessions

1. docs — active — idle
2. api — busy 2m
3. pirelay — offline

Use /use 2 to switch, or /to docs <prompt> for a one-shot prompt.
```

Ambiguous state:

```text
Multiple Pi sessions are paired to this chat.
Use /sessions then /use <session> first.
```

One-shot:

```text
/to api run tests
```

## Risks / Trade-offs

- Project folder names can collide; mitigate with numeric selection and short-id disambiguation.
- User-provided labels could be too long or contain awkward characters; bound and sanitize labels for display.
- `/to` parsing can be ambiguous when labels contain spaces; recommend short labels and support quoted labels only if needed later. Initial implementation can require first token session selector.
- Persisting labels must not break old bindings; support missing label fields and keep existing labels as-is.

## Migration Plan

1. Add label derivation helper that can use explicit label, session name, cwd basename, session file, and session id.
2. Parse optional label from `/telegram-tunnel connect [name]` and apply it to current route before creating pending pairing.
3. Persist and register the selected label in route and binding metadata.
4. Refine broker `/sessions`, `/use`, and optional `/to` behavior.
5. Update notifications to include session labels when multiple sessions are paired to a chat.
6. Document local multiplexing and the one-authoritative-broker invariant.
