## Context

The image bridge established the core pattern for authorized Telegram media: parse metadata without downloading, authorize first, enforce MIME/size limits, download, validate bytes, then inject multimodal content or send safe output. Voice and documents can reuse this pattern, but add extraction/transcription complexity.

## Goals / Non-Goals

**Goals:**
- Let authorized users send voice notes as prompts through transcription.
- Let authorized users send bounded documents/logs/specs for Pi to inspect.
- Make media processing explicit, configurable, and safe by default.
- Preserve busy routing and broker parity.

**Non-Goals:**
- Supporting every Telegram file type.
- Automatically browsing arbitrary workspace files.
- Sending raw large document contents to Telegram unless explicitly requested through existing output mechanisms.
- Building a full document management system.

## Decisions

1. **Transcription is optional and configured.**
   If no transcription backend is configured, voice messages are rejected with setup guidance rather than silently ignored.

2. **Documents use extraction when safe, references when needed.**
   Small text-like documents can be injected as text content. Larger or binary-supported documents may be staged as bounded temporary file references if Pi supports that input shape; otherwise reject with guidance.

3. **Reuse image bridge authorization order.**
   Do not download media before binding, authorization, paused/offline checks, and basic metadata validation pass.

4. **Separate inbound and extraction limits.**
   A file may be within Telegram download size but produce too much extracted text. Enforce both byte and extracted-text limits.

5. **Broker owns Telegram transport; client owns prompt injection.**
   In broker mode, the broker downloads/transcribes/extracts only when safe and sends normalized prompt content to the session client.

## Risks / Trade-offs

- Voice transcription may require secrets or paid APIs; make it opt-in and secret-safe.
- PDFs can contain complex layouts or malicious content; prefer conservative extraction and clear failure messages.
- Injecting large documents can consume context; use previews, size limits, and explicit user guidance.
- MIME sniffing and extensions can disagree; validate both where possible.

## Migration Plan

1. Extend media config with voice/document MIME lists and size/extraction limits.
2. Add Telegram parsing for voice/audio/document categories without early download.
3. Implement optional transcription and bounded document extraction adapters.
4. Normalize generated text/file-reference prompt content for in-process and broker runtimes.
5. Add tests and documentation with privacy warnings.
