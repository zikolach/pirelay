# Communication diagnostics

PiRelay communication diagnostics are an opt-in local troubleshooting log for runtime, broker, adapter, and final-output extraction decisions. They are useful when a remote run ends with a generic message such as:

```text
The agent finished without a final assistant response.
```

That message means PiRelay received an `agent_end` event but could not extract non-empty final assistant text from the event messages. Diagnostics help distinguish an upstream empty agent/LLM result from a PiRelay parsing, routing, broker, or messenger-delivery issue.

## Enable temporarily

Diagnostics are disabled by default. Enable them only while reproducing an issue:

```json
{
  "communicationDiagnostics": {
    "enabled": true,
    "maxFileBytes": 2097152,
    "maxFiles": 5,
    "includeContentPreview": false
  }
}
```

You can also use environment variables for a temporary run:

```bash
PI_RELAY_COMMUNICATION_DIAGNOSTICS=1 pi
```

Optional overrides:

```bash
PI_RELAY_DIAGNOSTICS_LOG_PATH=/tmp/pirelay-communication.jsonl
PI_RELAY_DIAGNOSTICS_MAX_BYTES=2097152
PI_RELAY_DIAGNOSTICS_MAX_FILES=5
PI_RELAY_DIAGNOSTICS_INCLUDE_CONTENT_PREVIEW=0
PI_RELAY_DIAGNOSTICS_PREVIEW_CHARS=240
```

By default the log is written under:

```text
~/.pi/agent/pirelay/logs/communication.jsonl
```

The log directory is created with local-user-only permissions, and the active log file is written as `0600` where the platform supports it.

## Inspect status

From local Pi, run:

```text
/relay diagnostics
/relay doctor
```

The local status shows whether diagnostics are enabled, the log path, retention settings, latest write status, and whether content previews are enabled. Remote Telegram, Discord, and Slack commands do not automatically upload diagnostic logs.

## Investigate missing final assistant responses

1. Enable diagnostics.
2. Reproduce the failing remote turn.
3. Open the JSONL log locally.
4. Find the `runtime` event named `agent_end.final_extraction`.
5. Inspect fields such as:
   - `details.messageCount`
   - `details.roleHistogram`
   - `details.assistantMessageCount`
   - `details.assistantContentShapes`
   - `details.assistantTextBlockCount`
   - `details.assistantTextLengthTotal`
   - `details.finalTextFound`
   - `details.missingReason`
   - `details.selectedStatus`

Example metadata-only event:

```json
{"component":"runtime","event":"agent_end.final_extraction","outcome":"no-non-empty-assistant-text","details":{"messageCount":3,"roleHistogram":{"user":1,"assistant":1,"toolResult":1},"assistantContentShapes":["array:tool_use,text"],"finalTextFound":false,"missingReason":"no-non-empty-assistant-text","selectedStatus":"failed"}}
```

Interpretation:

- `assistantMessageCount: 0` usually means the agent ended without any assistant message in the final event payload.
- `assistantContentShapes` with tool-only blocks or empty text means PiRelay saw assistant content, but no non-empty text block to deliver.
- `finalTextFound: true` with later delivery errors points away from LLM output and toward routing, broker, or adapter delivery.
- `usedMessageLifecycleFallback: true` means the final `agent_end` payload omitted assistant text, but PiRelay safely completed the turn using non-empty assistant text already observed in a completed assistant `message_end` event.

## Investigate broker and adapter communication

Look for events such as:

- `broker` / `socket.connect`
- `broker` / `client.request`
- `broker` / `route.register`
- `broker` / `send_to_bound_chat`
- `telegram` / `ingress.message`
- `telegram` / `command`
- `broker` / `notification.send`
- `discord` or `slack` / `ingress`
- `discord` or `slack` / `notification.send`

Use `sessionKey`, `sessionId`, `sessionLabel`, `turnId`, `messenger`, `instanceId`, `conversationId`, and `userId` fields to correlate events. Treat conversation and user IDs as local troubleshooting data.

## Content safety

Default diagnostics are metadata-only. They should not include raw prompts, full assistant responses, hidden prompts, raw tool arguments, command text, media bytes, file contents, bot tokens, signing secrets, OAuth tokens, pairing links/codes, or approval secret material.

`includeContentPreview` is off by default. If you enable it, PiRelay may write short, redacted snippets for extraction/routing troubleshooting. Review logs locally before sharing excerpts.

Before sharing a log excerpt:

1. Confirm it contains only the minimal relevant JSONL lines.
2. Remove or hash chat/user IDs if they are not needed.
3. Search for tokens, pairing codes, private URLs, customer data, hidden prompts, and tool inputs.
4. Prefer sharing `agent_end.final_extraction` metadata instead of full logs.
