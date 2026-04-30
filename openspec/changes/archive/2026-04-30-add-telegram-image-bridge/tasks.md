## 1. Types and Configuration

- [x] 1.1 Add image content types for inbound Telegram file references, downloaded Telegram images, and outbound latest-turn images.
- [x] 1.2 Update `SessionRouteActions.sendUserMessage` to accept text or Pi content arrays and add a route action for retrieving latest images.
- [x] 1.3 Add bounded image configuration defaults and environment/config parsing for inbound size, outbound size, max latest images, and accepted MIME types.
- [x] 1.4 Add utility helpers for image MIME validation, base64 byte-size calculation, safe image filenames, and image-capable model checks.

## 2. Telegram API Image Transport

- [x] 2.1 Extend Telegram update parsing to capture text captions, photo metadata, supported image document metadata, and unsupported document metadata without downloading files.
- [x] 2.2 Implement Telegram `getFile` download support for authorized image attachments with pre-download and post-download size validation.
- [x] 2.3 Implement outbound image document sending with safe filenames, MIME types, retry behavior, and size-limit handling.
- [x] 2.4 Add unit tests for photo parsing, image document parsing, unsupported document handling, download validation, and outbound document payloads.

## 3. In-Process Runtime Behavior

- [x] 3.1 Refactor authorized text handling into message handling that supports text-only, image-only, and text-plus-image prompts.
- [x] 3.2 Ensure image files are downloaded only after binding, user authorization, paused-state, and offline-state checks pass.
- [x] 3.3 Preserve idle, busy default, `/steer`, and `/followup` delivery modes for image-bearing prompts.
- [x] 3.4 Reject image-bearing prompts when the current model lacks image input support without injecting text-only fallbacks.
- [x] 3.5 Add `/images` command and current-turn inline callback handling for latest image retrieval.
- [x] 3.6 Add runtime tests for authorized image prompt delivery, unauthorized no-download behavior, busy delivery, model rejection, and `/images` retrieval.

## 4. Latest Turn Image Tracking

- [x] 4.1 Capture supported image blocks from tool-result messages for the active turn and clear the collection at agent start.
- [x] 4.2 Associate bounded latest-turn images with the assistant turn id at agent completion.
- [x] 4.3 Exclude input images from latest-image retrieval unless they are separately emitted as tool-result images.
- [x] 4.4 Update completion notifications to indicate image availability and attach a retrieval action when latest images exist.
- [x] 4.5 Add tests covering latest-turn image capture, limits, skipped oversized images, and stale retrieval actions.

## 5. Broker Runtime Parity

- [x] 5.1 Update broker IPC request/response payloads so `deliverPrompt` can carry multimodal Pi content arrays.
- [x] 5.2 Add broker-to-client `getLatestImages` handling that fetches images only when Telegram requests them.
- [x] 5.3 Mirror Telegram image parsing, authorized download, prompt delivery, `/images`, and callback behavior in `broker.js`.
- [x] 5.4 Add broker parity tests for image prompt delivery, latest-image retrieval, offline sessions, and stale callback rejection.

## 6. Documentation and Validation

- [x] 6.1 Update README and Telegram tunnel skill docs with image prompt usage, `/images`, limits, privacy notes, and model requirements.
- [x] 6.2 Run typecheck and the full test suite.
- [x] 6.3 Manually smoke-test a Telegram photo, image document, `/steer` caption with image, unsupported document rejection, non-vision model rejection, and latest image retrieval.

## 7. Natural Telegram Image UX

- [x] 7.1 Add latest-turn image file candidate types and route actions for validating/loading safe workspace image files on demand.
- [x] 7.2 Detect obvious local image file references in latest assistant/tool-result text and stage bounded latest-turn candidates without reading bytes eagerly.
- [x] 7.3 Extend `/images` and image inline callbacks to include validated latest-turn file candidates alongside captured image content blocks.
- [x] 7.4 Add an explicit Telegram command such as `/send-image <relative-path>` for sending a validated workspace image file without broad file browsing.
- [x] 7.5 Improve empty and validation-failure messages so users understand why a saved image path is not available and what to do next.
- [x] 7.6 Mirror file-candidate retrieval and explicit image-path sending in broker runtime IPC.
- [x] 7.7 Add tests for path extraction, workspace/symlink traversal rejection, MIME/size validation, `/images` file-candidate delivery, `/send-image`, broker parity, and empty-state messaging.
- [x] 7.8 Update README and Telegram tunnel skill docs with the natural image retrieval flow and privacy boundary.
