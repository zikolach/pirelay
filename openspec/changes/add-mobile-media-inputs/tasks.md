## 1. Configuration and media types

- [ ] 1.1 Add voice/audio/document MIME allow-lists and byte/extraction limits.
- [ ] 1.2 Add transcription backend configuration with secret-safe handling.
- [ ] 1.3 Add reusable MIME, filename, size, and extraction-limit helpers.

## 2. Telegram transport

- [ ] 2.1 Parse voice, audio, and supported document metadata without downloading files early.
- [ ] 2.2 Download authorized media with pre-download and post-download validation.
- [ ] 2.3 Implement optional transcription and bounded document extraction adapters.

## 3. Runtime delivery

- [ ] 3.1 Normalize voice transcripts and document content/references into Pi prompt content.
- [ ] 3.2 Preserve idle, busy default, `/steer`, and `/followup` delivery modes for media prompts.
- [ ] 3.3 Ensure unauthorized, paused, offline, unsupported, oversized, and failed-processing cases do not inject prompts.

## 4. Broker parity

- [ ] 4.1 Extend broker IPC payloads for voice/document prompt content.
- [ ] 4.2 Mirror media parsing, download, transcription/extraction, and delivery behavior in broker runtime.

## 5. Tests and docs

- [ ] 5.1 Add tests for voice parsing, transcription success/failure, document extraction, size limits, unsupported documents, and no unauthorized downloads.
- [ ] 5.2 Add runtime and broker parity tests for idle, busy, paused, offline, and explicit delivery modes.
- [ ] 5.3 Update README, config docs, testing docs, and Telegram tunnel skill docs.
- [ ] 5.4 Run typecheck and the full test suite.
