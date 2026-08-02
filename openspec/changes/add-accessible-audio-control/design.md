## Context

A simple “voice note becomes text prompt” feature helps mobile users, but it does not fully serve visually impaired users. Accessible audio control needs a full interaction loop:

```
audio input -> transcript -> intent/prompt -> Pi session or relay action
Pi output/status/action -> accessible summary -> speech audio + text transcript
```

PiRelay already has several pieces that audio mode can reuse: guided answer metadata, full-output retrieval, redaction patterns, image/document privacy boundaries, session status, and planned approval/progress/dashboard proposals. The cleanest implementation is as middleware that can sit between any channel adapter and the relay core.

## Goals / Non-Goals

**Goals:**
- Make PiRelay usable in audio-first workflows for visually impaired users.
- Support voice input for prompts and common relay commands.
- Support spoken summaries and readback for outputs, choices, approvals, status, and recent activity.
- Preserve a text transcript of what was understood and what was spoken.
- Apply strong redaction, confirmation, and opt-in rules before speech output or sensitive actions.
- Work first with Telegram voice/audio if needed, but keep the design channel-neutral.

**Non-Goals:**
- Replacing screen readers or OS accessibility tools.
- Guaranteeing perfect transcription or command recognition in noisy environments.
- Reading arbitrary raw logs, secrets, hidden prompts, or full transcripts aloud by default.
- Implementing a specific STT/TTS provider as the only supported backend.
- Implementing production support before the middleware/adapter architecture is ready, unless scoped as a Telegram-only MVP.

## Decisions

1. **Audio control is a mode, not just media ingestion.**
   Treat audio as an accessibility interaction mode with commands, confirmations, spoken output, and readback controls. Voice-note transcription alone belongs to generic media handling, but accessible audio owns the end-to-end UX.

2. **STT and TTS providers are pluggable.**
   Support provider adapters for local commands, local models, or remote APIs. Provider secrets must be loaded from config/environment and never stored in session history.

3. **Every audio input gets an auditable transcript.**
   After transcription, PiRelay should send or store a text transcript such as “Heard: …” before injecting or acting, especially for commands and sensitive flows.

4. **Use a small deterministic voice command grammar before LLM interpretation.**
   Recognize common commands like status, repeat, read last, read choices, option one, custom answer, abort, approve, deny, slower, faster, quiet, and verbose. Ambiguous phrases should ask for confirmation rather than guessing.

5. **Spoken output is rendered, not raw-read.**
   Convert assistant output into an audio-friendly form. Summarize long prose, announce code/diff/log sections by type and size, read file paths carefully, convert tables to row summaries, and clearly enumerate choices.

6. **Redaction happens before TTS.**
   Speech synthesis must only receive content classified as safe for spoken output after redaction. Hidden prompts, tool internals, raw secrets, and unsafe media metadata are excluded.

7. **Sensitive voice actions require confirmation.**
   Actions such as abort, approval, push/publish approval, or destructive command approval should require a clear confirmation phrase. Example: “Say approve push to continue.”

8. **Channel-neutral with graceful degradation.**
   If a channel can receive audio but not send audio, send text transcripts. If it can send audio but not buttons, use spoken/text command fallbacks. If it supports neither, expose equivalent text commands.

## Voice Command Grammar Sketch

| Phrase examples | Intent |
|---|---|
| “status”, “what is happening” | session status / progress summary |
| “read last”, “repeat answer” | spoken latest assistant output summary |
| “read choices”, “what are my options” | spoken guided answer choices |
| “option one”, “choose B” | guided answer selection |
| “custom answer …” | custom guided answer |
| “abort”, “stop the run” | abort request, usually confirmation-gated |
| “approve”, “deny”, “approve push” | approval-gate decision |
| “slower”, “faster”, “shorter”, “more detail” | audio preference adjustment |
| “send as text”, “show transcript” | text fallback |

## Audio Rendering Sketch

```
Assistant output
  -> redaction/classification
  -> structure detection
  -> audio summary plan
  -> TTS text
  -> audio document/voice response + text transcript
```

Rendering rules should be conservative:
- summarize long code blocks instead of reading every token by default;
- announce filenames and paths, with “spell path” available on request;
- explain table dimensions and read important rows;
- announce test failures and errors in a concise form;
- enumerate choices with stable option numbers/letters;
- avoid reading secrets, raw diffs, or large logs aloud unless explicitly requested and classified safe.

## Risks / Trade-offs

- Accessibility UX is sensitive; poor recognition or unsafe speech can harm trust. Start with conservative commands and visible transcripts.
- Remote STT/TTS providers may send user audio/text to third parties. Make provider choice explicit and document privacy implications.
- TTS audio persists in messenger history, which can expose information to anyone with device/chat access. Require opt-in and redaction.
- Voice approvals can be spoofed or misheard. Confirmation phrases and transcript acknowledgements reduce risk but do not eliminate it.
- Audio files increase storage and bandwidth usage; enforce size, duration, and retention limits.

## Migration Plan

1. Implement middleware/adapter architecture foundations.
2. Add audio config and provider interfaces for STT/TTS with no default remote provider enabled.
3. Add Telegram voice/audio MVP for authorized input and spoken/text output if channel-neutral adapter work is not complete yet.
4. Add deterministic voice command parsing and confirmation state.
5. Add audio rendering for status, completion summary, guided choices, and approvals.
6. Add readback/repeat controls and text transcript fallbacks.
7. Extend to other channel adapters as they become available.
