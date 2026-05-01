## Context

PiRelay currently mixes several layers in the Telegram runtime and broker:

```
Telegram update parsing
  -> authorization/session routing
  -> media validation/download
  -> command/action parsing
  -> guided answer handling
  -> prompt delivery
  -> completion/output formatting
  -> Telegram response transport
```

As PiRelay grows toward multiple messengers and audio accessibility, several features should be reusable across channels instead of reimplemented in each adapter. A middleware layer gives these features a stable plug-in point.

## Goals / Non-Goals

**Goals:**
- Define a channel-neutral middleware pipeline for inbound and outbound relay interactions.
- Let features such as audio accessibility, approvals, progress, documents, redaction, and translation plug in cleanly.
- Keep channel adapters focused on platform transport and identity details.
- Keep relay core focused on Pi session routing, session state, and delivery semantics.
- Preserve existing Telegram behavior during refactor.

**Non-Goals:**
- Implementing audio accessibility itself in this change.
- Implementing Discord, Slack, Signal, or other adapters in this change.
- Replacing Pi extension APIs or local TUI behavior.
- Letting middleware bypass authorization, redaction, or configured privacy boundaries.

## Architecture Sketch

```
             ┌──────────────────┐
             │ Channel adapter  │  Telegram/Discord/Slack/etc.
             └────────┬─────────┘
                      │ normalized inbound event
                      ▼
┌────────────────────────────────────────────────────────┐
│              Interaction Middleware Pipeline            │
├────────────────────────────────────────────────────────┤
│  inbound preprocessors                                  │
│    - media normalization                                │
│    - STT/transcription later                            │
│    - redaction/policy checks                            │
│                                                        │
│  intent/action resolvers                                │
│    - slash/text commands                                │
│    - guided answer choices                              │
│    - approval decisions later                           │
│                                                        │
│  delivery hooks                                         │
│    - prompt shaping                                     │
│    - busy-mode selection                                │
│    - confirmation requirements                          │
│                                                        │
│  outbound postprocessors                                │
│    - summaries                                          │
│    - accessible rendering later                         │
│    - chunk/document/image transforms                    │
└────────────────────────┬───────────────────────────────┘
                         │ normalized relay action/output
                         ▼
                  ┌────────────┐
                  │ Relay core │  session routing + Pi delivery
                  └────────────┘
```

## Decisions

1. **Middleware uses normalized envelopes.**
   Define internal envelope types such as `RelayInboundEvent`, `RelayIntent`, `RelayAction`, `RelayDeliveryRequest`, and `RelayOutboundEvent`. Channel-specific metadata can be attached under a bounded adapter metadata field.

2. **Authorization remains early and mandatory.**
   Middleware must not download files, transcribe audio, expose output, or inject prompts before route binding and user authorization are established. The pipeline should make the authorized identity and selected route explicit.

3. **Middleware is ordered and capability-aware.**
   Each middleware declares which phases it participates in, required capabilities, ordering hints, and whether failure is fatal or recoverable. Example: redaction should run before outbound speech synthesis; media download should run before document extraction.

4. **Middleware can produce responses without Pi delivery.**
   Commands such as status, repeat, help, approval decisions, unsupported-media errors, or accessibility readback may be handled entirely by middleware/core and should not be injected into the model.

5. **Safety boundaries are part of the interface.**
   Middleware output must carry safety classification such as safe text, redacted text, secret-sensitive content, media references, or requires-confirmation. Outbound renderers must respect those classifications.

6. **Broker parity is designed in.**
   Broker mode should carry normalized envelope/action data over IPC so middleware behavior is consistent whether Telegram polling happens in-process or in the singleton broker.

7. **Telegram behavior is characterized before refactor.**
   Existing Telegram tests should become behavior locks. The middleware refactor should not change user-visible Telegram behavior except where explicitly documented.

## Middleware Examples

| Middleware | Inbound role | Outbound role |
|---|---|---|
| Image media | validate/download images | expose latest image files |
| Document media | extract/stage documents | send validated documents |
| Audio accessibility | transcribe voice commands | render TTS summaries |
| Approval gates | resolve approve/deny intents | emit approval prompts |
| Progress dashboard | normalize progress events | coalesce/rate-limit updates |
| Redaction/policy | classify/sanitize content | prevent unsafe delivery |
| Translation | translate inbound prompts | translate outbound summaries |

## Risks / Trade-offs

- Over-abstraction can slow development; keep interfaces practical and driven by existing Telegram behavior plus near-term audio/accessibility needs.
- Middleware ordering bugs could create privacy issues; require tests for authorization-before-download, redaction-before-TTS, and stale-action rejection.
- Broker IPC versioning becomes more important when normalized envelopes evolve.
- Some features may need adapter-specific escape hatches; allow metadata without leaking it into core semantics.

## Migration Plan

1. Add normalized envelope, middleware phase, capability, and result types.
2. Add a pipeline runner with deterministic ordering, error handling, and audit/debug tracing.
3. Move existing Telegram command/action/media/output shaping into built-in middleware modules incrementally.
4. Update in-process runtime to call the pipeline for inbound and outbound interactions.
5. Update broker runtime/process to carry normalized pipeline inputs/outputs over IPC.
6. Add documentation for writing future middleware such as accessible audio control.
7. Validate Telegram behavior with existing and new characterization tests.
