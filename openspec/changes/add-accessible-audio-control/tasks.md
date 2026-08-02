## 1. Architecture and configuration

- [ ] 1.1 Define audio mode preferences, STT/TTS provider configuration, audio limits, confidence thresholds, and retention settings.
- [ ] 1.2 Add secret-safe provider interfaces for speech-to-text and text-to-speech backends.
- [ ] 1.3 Define normalized audio input, transcript, spoken output, audio command intent, confirmation state, and transcript fallback types.
- [ ] 1.4 Align audio types and phases with the relay middleware and channel adapter architecture.

## 2. Speech input pipeline

- [ ] 2.1 Parse authorized channel audio/voice attachments without downloading before authorization.
- [ ] 2.2 Download and validate audio files using configured MIME, size, and duration limits.
- [ ] 2.3 Transcribe authorized audio through the configured STT provider and surface an auditable “heard” transcript.
- [ ] 2.4 Handle unavailable STT, transcription failure, low confidence, unsupported audio, oversized audio, paused sessions, offline sessions, and unauthorized users without injecting prompts.

## 3. Voice command grammar

- [ ] 3.1 Implement deterministic parsing for status, read last, repeat, read choices, option selection, custom answer, abort, approve, deny, slower/faster, more detail, and transcript fallback phrases.
- [ ] 3.2 Route recognized commands to relay actions without forwarding raw command phrases to the model.
- [ ] 3.3 Add confirmation flow for ambiguous or sensitive spoken commands.
- [ ] 3.4 Preserve normal prompt delivery for transcripts that are not recognized as relay commands.

## 4. Spoken output rendering

- [ ] 4.1 Implement safe audio rendering for completion summaries, status, progress summaries, guided choices, approval prompts, and readback requests.
- [ ] 4.2 Add structure-aware rendering for code blocks, diffs, logs, stack traces, Markdown tables, file paths, and test failures.
- [ ] 4.3 Add redaction-before-TTS and hidden-content exclusion for all spoken output.
- [ ] 4.4 Add detail controls such as shorter, more detail, repeat, spell path, and show transcript.

## 5. Text-to-speech delivery

- [ ] 5.1 Synthesize safe spoken text through the configured TTS provider with byte/duration limits.
- [ ] 5.2 Send audio responses through supported channel adapters and accessible text fallbacks when audio sending is unavailable or fails.
- [ ] 5.3 Store bounded spoken transcript metadata for repeat/readback while respecting retention settings.

## 6. Runtime and broker parity

- [ ] 6.1 Implement audio mode behavior in the in-process runtime or middleware pipeline.
- [ ] 6.2 Mirror audio input, transcript, command, spoken output, TTS, and fallback behavior in broker runtime IPC.
- [ ] 6.3 Validate stale, offline, paused, revoked, unauthorized, and multi-session cases.

## 7. Tests and documentation

- [ ] 7.1 Add unit tests for voice command parsing, confidence/ambiguity handling, confirmation phrases, and prompt-vs-command routing.
- [ ] 7.2 Add tests for audio rendering of summaries, choices, code, diffs, logs, tables, paths, redaction, and hidden-content exclusion.
- [ ] 7.3 Add runtime and broker tests for STT/TTS success/failure, transcript fallback, unauthorized no-download behavior, and channel capability degradation.
- [ ] 7.4 Update README, config docs, testing docs, and accessibility-focused usage documentation.
- [ ] 7.5 Run typecheck and the full test suite.
