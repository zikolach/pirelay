## Context

PiRelay currently treats image prompt input as direct model-ready image bytes. Defaults accept `image/jpeg`, `image/png`, and `image/webp`; Telegram photos are normalized as JPEG and Telegram image documents are accepted only when their MIME type is in the configured allow-list. The same allow-list is also used in places that validate outbound/latest workspace image delivery, so simply adding `image/gif` to that list would blur two different meanings:

```text
source attachment accepted from messenger ──► bytes safe to pass to Pi model
```

GIF support should instead be a conversion path:

```text
image/gif attachment
        │
        ▼
validate authorization + source size
        │
        ▼
download bytes
        │
        ▼
decode first frame
        │
        ▼
encode static PNG
        │
        ▼
Pi image content: { mimeType: "image/png", data: ... }
```

This change touches shared media behavior, Telegram's mature image path, broker Telegram parity, and potentially Discord/Slack attachment normalization where those adapters already model GIF image attachments.

## Goals / Non-Goals

**Goals:**

- Accept authorized inbound GIF image attachments as Pi image prompts by converting only the first frame.
- Keep JPEG, PNG, and WebP direct image handling unchanged.
- Send converted GIFs to Pi as static model-ready image content, preferably PNG.
- Enforce authorization before media download and enforce configured byte limits before and after conversion.
- Return clear safe errors for corrupt, oversized, unsupported, or conversion-failing GIFs.
- Centralize conversion logic in shared relay/media code so adapter runtimes do not each invent incompatible GIF behavior.

**Non-Goals:**

- Sending animated GIFs, multiple GIF frames, frame timing, or video-like content to Pi.
- Adding HEIC/HEIF, AVIF, TIFF, BMP, SVG, or general image conversion in this change.
- Broadening outbound `/send-image`, `/images`, or generic file delivery to send GIF files as images.
- Persisting inbound GIF bytes or converted image bytes in relay state.
- Relying on downstream model providers to accept raw GIF input.

## Decisions

### Convert GIF to first-frame PNG before prompt injection

Use GIF only as an inbound source format. The prompt content should contain a static `image/png` block.

Rationale:
- PNG is widely accepted by vision-capable model providers and preserves the decoded frame without JPEG artifacts.
- The first-frame behavior is deterministic and easy to explain.
- Raw GIF model support is inconsistent and would not satisfy the requested first-frame semantics.

Alternatives considered:
- **Pass raw GIF through**: minimal code, but provider support is uncertain and animated GIF semantics are undefined.
- **Convert to JPEG**: smaller in some cases, but introduces lossy artifacts and transparency/background decisions.
- **Extract all frames**: more complete for animations, but significantly increases prompt size, UX ambiguity, and risk.

### Keep direct allowed MIME types separate from convertible inbound formats

The existing direct image MIME allow-list should continue to represent model-ready/static image formats. GIF should be treated as a convertible inbound format rather than only another entry in `allowedImageMimeTypes`.

Rationale:
- Existing outbound image/file validation uses allowed image MIME types as a delivery allow-list.
- Treating GIF as direct would risk raw GIF being sent through paths that cannot convert or that expect static image bytes.
- Error messages can accurately say "JPEG/PNG/WebP directly; GIF as first frame".

Implementation can start with a small fixed convertible set containing `image/gif`, or introduce a config field if the implementation finds that user control is needed. Either way, the behavioral contract is separation of direct model-ready formats from convertible source formats.

### Use a shared conversion helper

Create shared media functionality that accepts downloaded image bytes and source MIME metadata, returning either direct image content or a converted static image result.

Rationale:
- Telegram has both adapter-runtime and broker process paths.
- Discord and Slack already have normalized attachment concepts and should not duplicate decoding rules.
- Tests can cover conversion and size behavior once at the shared helper layer.

The helper should report:
- output MIME type
- output bytes/base64
- byte size
- safe filename extension
- source conversion metadata for diagnostics if needed, without storing bytes

### Prefer a small pure-JavaScript decoder/encoder over native conversion

A pure JavaScript GIF decoder plus PNG encoder is preferable to a native dependency such as `sharp` for this focused change, unless implementation proves the pure-JS path is insufficient.

Rationale:
- PiRelay is a Pi package loaded via JITI and installed in varied local environments.
- Native image packages add install/platform friction and larger transitive surface.
- Only first-frame GIF decoding and PNG encoding are needed.

Potential dependency choices should be evaluated during implementation. If adding dependencies, keep them runtime dependencies, document the reason, and cover corrupted/large inputs with tests.

### Enforce limits before and after conversion

The source GIF must satisfy the configured inbound image byte limit before decoding. The converted PNG must also satisfy inbound/model-safe bounds before prompt injection.

Rationale:
- Small compressed GIFs can decode to large frames.
- Conversion can increase byte size.
- Existing media safety expectations require bounded transfer and prompt payloads.

## Risks / Trade-offs

- **Dependency install friction** → Prefer pure JS libraries; add only the minimal runtime dependencies needed and validate package behavior in tests.
- **GIF decompression/memory bombs** → Check source bytes before decode, validate frame dimensions where decoder exposes them, and check converted bytes before injection.
- **Adapter parity expands scope** → Implement shared conversion first and wire Telegram/broker paths explicitly; add Discord/Slack tests where their current media prompt paths can exercise GIF without live network calls.
- **User confusion about animations** → Documentation and error/help text must say GIF uses the first frame only.
- **Conflating inbound and outbound formats** → Keep outbound `/send-image` behavior unchanged unless a future change explicitly adds GIF file delivery.

## Migration Plan

1. Add or identify shared media helpers for direct-vs-convertible image handling.
2. Add first-frame GIF conversion with bounded output and unit tests using small fixture GIFs.
3. Wire Telegram runtime and broker inbound image download paths to run conversion after authorization and download.
4. Wire Discord/Slack normalized image paths if existing media prompt plumbing supports the same shared helper.
5. Update docs, testing guidance, and unsupported-image messages.
6. Validate with `npm run typecheck`, `npm test`, and `openspec validate add-gif-first-frame-image-input --strict`.

Rollback is straightforward: remove GIF from the convertible inbound set or disable the conversion branch; existing JPEG/PNG/WebP behavior remains unchanged.
