## 1. Conversion Design and Dependencies

- [x] 1.1 Choose the GIF first-frame decoder/PNG encoder approach and document the dependency rationale in package metadata or implementation comments.
- [x] 1.2 Add any required runtime dependencies without introducing unused or native-only packages unless justified.
- [x] 1.3 Add small valid, corrupt, and oversized/edge-case GIF fixtures or fixture generators for tests.

## 2. Shared Media Conversion

- [x] 2.1 Add shared helpers that classify direct model-ready image MIME types separately from convertible inbound image MIME types.
- [x] 2.2 Implement GIF first-frame decoding and PNG encoding with source-byte, dimensions, and converted-byte safety checks.
- [x] 2.3 Ensure converted image metadata uses a safe PNG filename, `image/png` MIME type, base64 payload, and bounded byte size.
- [x] 2.4 Add unit tests for direct JPEG/PNG/WebP pass-through, GIF first-frame conversion, corrupt GIF rejection, and pre/post-conversion size failures.

## 3. Messenger Runtime Integration

- [x] 3.1 Wire Telegram runtime inbound image download to convert authorized GIF documents before building Pi image prompt content.
- [x] 3.2 Wire Telegram broker process inbound image download to preserve broker/runtime parity for GIF documents.
- [x] 3.3 Wire Discord and Slack media prompt paths to use the shared direct-or-convertible image helper where their normalized attachment flows support inbound images.
- [x] 3.4 Update unsupported-image messages so users see JPEG/PNG/WebP direct support and GIF first-frame conversion support accurately.

## 4. Configuration and Documentation

- [x] 4.1 Preserve existing `allowedImageMimeTypes` semantics for direct/static image formats and add any required convertible-format defaults without broadening outbound file delivery.
- [x] 4.2 Update README and config docs to describe GIF first-frame conversion and media size limits.
- [x] 4.3 Update testing docs with Telegram GIF smoke coverage and negative cases for corrupt/oversized GIFs.

## 5. Tests and Validation

- [x] 5.1 Add Telegram runtime tests for authorized GIF prompt delivery, image-only fallback text, caption preservation, model-without-image rejection, and conversion failure.
- [x] 5.2 Add broker parity tests for Telegram GIF documents.
- [x] 5.3 Add Discord/Slack adapter or runtime tests for GIF normalization/conversion where supported by current media prompt plumbing.
- [x] 5.4 Add regression tests proving JPEG, PNG, WebP, `/images`, `/send-image`, and remote `send-file` behavior remain unchanged.
- [x] 5.5 Run `npm run typecheck`.
- [x] 5.6 Run `npm test`.
- [x] 5.7 Run `openspec validate add-gif-first-frame-image-input --strict`.
